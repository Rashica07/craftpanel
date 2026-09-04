mod adapter;
mod admin;
mod analytics;
mod anticheat;
mod attribution;
mod backups;
mod bedrock;
mod branding;
mod clone;
mod commands;
mod crashreports;
mod crossplay;
mod curseforge;
mod db;
mod doctor;
mod external;
mod files;
mod java;
mod javainstall;
mod mgmt;
mod metrics_history;
mod minecraft;
mod lock;
mod modrinth;
mod mods;
mod net;
mod perf;
mod pluginconfig;
mod power;
mod process;
mod properties;
mod provision;
mod rcon;
mod remote_api;
mod resourcepack;
mod schedule;
mod session;
mod settings;
mod share;
mod snapshots;
mod system;
mod tunnel;
mod updater;
mod worlds;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, RunEvent, WindowEvent,
};

use db::Db;
use process::ProcessManager;
use rcon::RconPool;
use tunnel::TunnelManager;

/// Stable per-device id, exposed to commands.
pub struct DeviceId(pub String);

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Quit: stop tunnels, and either stop servers or leave them running
/// (the "keep servers running when I quit" pref).
fn on_quit(app: &tauri::AppHandle) {
    if let Some(t) = app.try_state::<std::sync::Arc<TunnelManager>>() {
        t.stop_all();
    }
    let keep = app
        .try_state::<Db>()
        .map(|db| commands::read_app_settings(&db).keep_servers_on_quit)
        .unwrap_or(false);
    if let Some(pm) = app.try_state::<ProcessManager>() {
        let dirs = server_dirs(app);
        if keep {
            pm.release_leases_only(&dirs);
        } else {
            pm.shutdown_and_release(&dirs);
        }
    }
}

/// Server folders from the DB — for lease release + session cleanup on quit.
fn server_dirs(app: &tauri::AppHandle) -> Vec<String> {
    app.try_state::<Db>()
        .and_then(|db| db.list_servers().ok())
        .map(|servers| servers.into_iter().map(|s| s.path).collect())
        .unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db = Db::open(&dir.join("craftpanel.db"))
                .map_err(|e| format!("failed to open database: {e}"))?;
            let device_id = share::device_id(&dir);
            let procs = ProcessManager::new(app.handle().clone(), device_id.clone());

            // re-adopt servers this app launched before a restart / crash, so
            // they show as "Running (reattached)" and not "external"
            if let Ok(servers) = db.list_servers() {
                procs.adopt_all(&servers);
            }

            let tunnel = TunnelManager::new(app.handle().clone(), &dir);

            app.manage(lock::Lock::new(&dir));
            app.manage(db);
            app.manage(DeviceId(device_id));
            app.manage(procs);
            app.manage(tunnel);
            app.manage(RconPool::new());

            // local/remote management API for the Android companion app —
            // stays off unless the user already opted in from a previous run
            let remote_api = remote_api::RemoteApi::new(&dir);
            if remote_api.status().enabled {
                if let Err(e) = remote_api.start(app.handle().clone()) {
                    eprintln!("remote api: failed to auto-start: {e}");
                }
            }
            app.manage(remote_api);

            // automation engine (auto-restart, daily restart, timed commands)
            let offset = time::OffsetDateTime::now_local()
                .map(|d| d.offset().whole_seconds())
                .unwrap_or(0);
            schedule::Scheduler::new(app.handle().clone(), offset).start();

            // background sampler for RAM/CPU/TPS history graphs
            metrics_history::MetricsSampler::new(app.handle().clone()).start();

            let power = power::PowerKeeper::new();
            if commands::read_app_settings(&app.state::<Db>()).stay_awake_on_power {
                if let Err(e) = power.set_enabled(true) {
                    eprintln!("stay-awake-on-power: {e}");
                }
            }
            app.manage(power);

            // --- tray icon: closing the window while a server runs hides here ---
            let show_i = MenuItem::with_id(app, "show", "Show CraftPanel", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit CraftPanel", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("CraftPanel")
                .menu(&menu);
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => {
                        on_quit(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            // standard native menu bar (App / Edit / View / Window / Help on macOS)
            // — gives proper Cmd-C/V/Q/W/H and the About item
            if let Ok(menu) = Menu::default(app.handle()) {
                let _ = app.set_menu(menu);
            }

            if let Some(win) = app.get_webview_window("main") {
                let win2 = win.clone();
                win.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        let app = win2.app_handle();
                        let running = app
                            .try_state::<ProcessManager>()
                            .map(|pm| pm.any_active())
                            .unwrap_or(false);
                        if running {
                            // keep servers alive — hide to the tray instead
                            api.prevent_close();
                            let _ = win2.hide();
                        }
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::detect_server,
            commands::detect_java,
            commands::java_offerable_for,
            commands::java_install_status,
            commands::install_java,
            commands::set_server_java_path,
            commands::add_server,
            commands::list_servers,
            commands::remove_server,
            commands::system_info,
            commands::default_servers_dir,
            commands::start_server,
            commands::stop_server,
            commands::stop_on_port,
            commands::kill_server,
            commands::send_console,
            commands::accept_eula,
            commands::console_lines,
            commands::server_runtime,
            commands::all_runtimes,
            commands::set_server_ram,
            commands::set_keep_awake,
            commands::check_external,
            commands::eula_state,
            commands::rcon_settings,
            commands::rcon_setup,
            commands::rcon_players,
            commands::rcon_command,
            commands::rcon_player_action,
            commands::loader_versions,
            commands::create_server,
            commands::change_server_version,
            commands::clone_server,
            commands::modpack_search,
            commands::modpack_info,
            commands::create_server_from_modpack,
            commands::get_settings,
            commands::apply_settings,
            commands::list_mods,
            commands::set_mod_enabled,
            commands::remove_mod,
            commands::import_mods,
            commands::backup_now,
            commands::list_backups,
            commands::delete_backup,
            commands::restore_backup,
            commands::get_backups_config,
            commands::set_backups_keep,
            commands::snapshot_now,
            commands::list_snapshots,
            commands::restore_snapshot,
            commands::delete_snapshot,
            commands::fs_list,
            commands::fs_read,
            commands::fs_write,
            commands::fs_mkdir,
            commands::fs_rename,
            commands::fs_delete,
            commands::fs_import,
            commands::fs_export,
            commands::tail_log,
            commands::admin_lists,
            commands::player_history,
            commands::player_activity,
            commands::metrics_history,
            commands::plugin_config_views,
            commands::set_plugin_config,
            commands::lock_status,
            commands::lock_set,
            commands::lock_check,
            commands::lock_clear,
            commands::server_icon_status,
            commands::set_server_icon,
            commands::clear_server_icon,
            commands::net_info,
            commands::tunnel_start,
            commands::tunnel_stop,
            commands::tunnel_status,
            commands::set_tunnel_address,
            commands::upnp_forward,
            commands::upnp_remove,
            commands::qr_svg,
            commands::get_schedule,
            commands::set_schedule,
            commands::server_perf,
            commands::latest_crash,
            commands::list_crashes,
            commands::get_jvm_args,
            commands::set_jvm_args,
            commands::modrinth_search,
            commands::modrinth_supported_versions,
            commands::modrinth_install,
            commands::modrinth_install_resourcepack,
            commands::modrinth_gallery,
            commands::modrinth_installed,
            commands::modrinth_check_updates,
            commands::modrinth_update,
            commands::modrinth_remove,
            commands::curseforge_search,
            commands::curseforge_install,
            commands::curseforge_installed,
            commands::curseforge_check_updates,
            commands::curseforge_update,
            commands::curseforge_remove,
            commands::anticheat_advice,
            commands::anticheat_suspicion,
            commands::mgmt_status,
            commands::mgmt_enable,
            commands::mgmt_disable,
            commands::app_settings_get,
            commands::app_settings_set,
            commands::check_update,
            commands::install_update,
            commands::app_install_id,
            commands::doctor_check,
            commands::crossplay_status,
            commands::crossplay_enable,
            commands::crossplay_disable,
            commands::crossplay_forward,
            commands::list_worlds,
            commands::world_set_active,
            commands::world_create,
            commands::world_rename,
            commands::world_delete,
            commands::get_resource_pack,
            commands::set_resource_pack,
            commands::clear_resource_pack,
            commands::share_server,
            commands::unshare_server,
            commands::join_shared,
            commands::share_status,
            remote_api::remote_api_status,
            remote_api::remote_api_set_enabled,
            remote_api::remote_api_regenerate_token,
            remote_api::remote_api_pair_payload,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if let RunEvent::ExitRequested { .. } = event {
                on_quit(app);
            }
        });
}
