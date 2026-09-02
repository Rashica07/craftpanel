//! Tauri command surface for Stage 1: detection + server list CRUD.

use std::path::Path;
use std::sync::Arc;

use serde::Serialize;
use tauri::{Emitter, Manager, State};

use crate::adapter::ServerType;
use crate::admin::{self, AdminLists};
use crate::analytics::{self, PlayerStat};
use crate::anticheat::{self, Advice, Suspicion};
use crate::mgmt::{self, MgmtStatus};
use crate::backups::{self, Backup};
use crate::branding;
use crate::crashreports::{self, CrashReport};
use crate::crossplay::{self, CrossplayStatus};
use crate::db::{self, Db, NewServer, ServerRecord};
use crate::modrinth::{self, InstallResult, InstalledEntry, SearchResult};
use crate::perf::{self, PerfSample};
use crate::pluginconfig;
use crate::files::{self, FileView, Listing};
use crate::net::{self, NetInfo};
use crate::schedule::{self, Schedule};
use crate::snapshots::{self, Snapshot};
use crate::tunnel::{TunnelManager, TunnelStatus};
use crate::worlds::{self, WorldInfo};
use crate::external::{self, ExternalStatus};
use crate::java::{self, JavaInfo};
use crate::minecraft::MinecraftAdapter;
use crate::mods::{self, ModList};
use crate::process::{LogLine, ProcSnapshot, ProcessManager};
use crate::properties::Properties;
use crate::provision::{self, CreateSpec, Loader, VersionInfo};
use crate::rcon::{self, RconClient, RconPool};
use crate::resourcepack::{self, ResourcePackConfig};
use crate::cloud::CloudManager;
use crate::r2::R2Config;
use crate::settings::{self, ServerSettings};
use crate::share::{self, ShareInfo, ShareView};
use crate::sync::CloudStatus;
use crate::system::{self, SystemInfo};
use crate::DeviceId;

/// What the Add Server flow shows on the "confirm" screen.
#[derive(Debug, Serialize)]
pub struct DetectionResult {
    pub path: String,
    pub detected: bool,
    pub server_type: Option<ServerType>,
    pub server_type_label: Option<String>,
    pub launch_target: Option<String>,
    pub mc_version: Option<String>,
    pub evidence: Vec<String>,
    pub java: Option<JavaInfo>,
    pub warnings: Vec<String>,
}

#[tauri::command]
pub fn detect_server(path: String) -> DetectionResult {
    let p = Path::new(&path);
    let java = java::probe(None);
    let mut warnings = Vec::new();

    if !p.is_dir() {
        warnings.push("That path is not a folder.".to_string());
        return DetectionResult {
            path,
            detected: false,
            server_type: None,
            server_type_label: None,
            launch_target: None,
            mc_version: None,
            evidence: Vec::new(),
            java,
            warnings,
        };
    }

    match MinecraftAdapter::inspect(p) {
        Some(d) => {
            if java.is_none() {
                warnings.push(
                    "No Java runtime found on PATH. Install a JDK (Temurin 17, 21, or 25) before starting this server."
                        .to_string(),
                );
            }
            if let (Some(j), Some(v)) = (&java, &d.mc_version) {
                if let Some(w) = java::compatibility_warning(j, Some(v)) {
                    warnings.push(w);
                }
            }
            if d.mc_version.is_none() {
                warnings.push(
                    "Couldn't determine the Minecraft version automatically — set it manually if Java looks mismatched."
                        .to_string(),
                );
            }
            DetectionResult {
                path,
                detected: true,
                server_type: Some(d.server_type),
                server_type_label: Some(d.server_type.label().to_string()),
                launch_target: Some(d.launch_target),
                mc_version: d.mc_version,
                evidence: d.evidence,
                java,
                warnings,
            }
        }
        None => match crate::bedrock::inspect(p) {
            // A Bedrock server needs no `java` at all — don't warn about it
            // missing just because this folder happens to be Bedrock.
            Some(d) => DetectionResult {
                path,
                detected: true,
                server_type: Some(ServerType::Bedrock),
                server_type_label: Some(ServerType::Bedrock.label().to_string()),
                launch_target: Some(d.launch_target.clone()),
                mc_version: None,
                evidence: vec![d.launch_target],
                java: None,
                warnings,
            },
            None => {
                warnings.push(
                    "No Minecraft server detected here. Expected something like \
                     fabric-server-launch.jar, a Forge run script, paper.jar, spigot.jar, \
                     server.jar, or bedrock_server."
                        .to_string(),
                );
                DetectionResult {
                    path,
                    detected: false,
                    server_type: None,
                    server_type_label: None,
                    launch_target: None,
                    mc_version: None,
                    evidence: Vec::new(),
                    java,
                    warnings,
                }
            }
        },
    }
}

/// Probe an arbitrary `java` executable (or PATH default when `path` is None).
#[tauri::command]
pub fn detect_java(path: Option<String>) -> Option<JavaInfo> {
    java::probe(path.as_deref())
}

/// Which bundled Java version (17, 21, or 25) a Minecraft version needs, or
/// `None` if it needs one CraftPanel doesn't offer to auto-install (very old
/// MC needing Java 8, or the narrow 1.17-only Java 16 case).
#[tauri::command]
pub fn java_offerable_for(mc_version: String) -> Option<u8> {
    crate::javainstall::offerable_feature(java::required_java_for_mc(&mc_version))
}

/// Already installed? Doesn't touch the network — just checks disk.
#[tauri::command]
pub fn java_install_status(app: tauri::AppHandle, feature: u8) -> Result<Option<JavaInfo>, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(crate::javainstall::installed_path(&dir, feature)
        .and_then(|p| java::probe(p.to_str())))
}

/// Downloads, checksum-verifies, and extracts a Java runtime — see
/// `javainstall.rs` for the full flow. Emits `java-install:progress` as it
/// goes, same shape as `provision:progress`.
#[tauri::command]
pub fn install_java(app: tauri::AppHandle, feature: u8) -> Result<JavaInfo, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let app2 = app.clone();
    crate::javainstall::install(&dir, feature, &move |p| {
        let _ = app2.emit("java-install:progress", &p);
    })
}

/// Point one server at a specific `java` executable — e.g. the one
/// `install_java` just installed.
#[tauri::command]
pub fn set_server_java_path(db: State<Db>, id: String, java_path: String) -> Result<(), String> {
    db.update_java_path(&id, &java_path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_server(db: State<Db>, server: NewServer) -> Result<ServerRecord, String> {
    let rec = db.insert_server(server).map_err(|e| e.to_string())?;
    crate::attribution::stamp(&db, &rec.path, "added");
    Ok(rec)
}

#[tauri::command]
pub fn list_servers(db: State<Db>) -> Result<Vec<ServerRecord>, String> {
    db.list_servers().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_server(
    db: State<Db>,
    procs: State<ProcessManager>,
    id: String,
) -> Result<(), String> {
    if procs.is_running(&id) {
        return Err("Stop the server before removing it.".into());
    }
    db.delete_server(&id).map_err(|e| e.to_string())
}

// --- Stage 2: process management -----------------------------------------

#[tauri::command]
pub fn system_info() -> SystemInfo {
    system::info()
}

/// Where a new server goes if you don't pick a folder yourself —
/// `~/Documents/CraftPanel Servers`, created on first use. Every "New
/// server" / "Quick start" flow pre-fills this so most people never have to
/// deal with a folder picker at all, while still being free to change it
/// per server.
#[tauri::command]
pub fn default_servers_dir(app: tauri::AppHandle) -> Result<String, String> {
    let docs = app
        .path()
        .document_dir()
        .map_err(|e| format!("couldn't find your Documents folder: {e}"))?;
    let dir = docs.join("CraftPanel Servers");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

fn load(db: &State<Db>, id: &str) -> Result<ServerRecord, String> {
    db.get_server(id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Server not found.".to_string())
}

#[tauri::command]
pub fn check_external(db: State<Db>, id: String) -> Result<ExternalStatus, String> {
    let rec = load(&db, &id)?;
    Ok(external::probe(&rec.path))
}

#[tauri::command]
pub fn eula_state(db: State<Db>, id: String) -> Result<bool, String> {
    let rec = load(&db, &id)?;
    Ok(crate::process::eula_accepted(std::path::Path::new(&rec.path), rec.server_type))
}

/// Sentinel the frontend checks for to show the one-time EULA prompt.
pub const EULA_REQUIRED: &str = "EULA_REQUIRED";

#[tauri::command]
pub fn start_server(
    db: State<Db>,
    procs: State<ProcessManager>,
    id: String,
    force: Option<bool>,
    accept_eula: Option<bool>,
) -> Result<ProcSnapshot, String> {
    let rec = load(&db, &id)?;

    // EULA pre-flight — accept it up front rather than letting the server bail.
    if !crate::process::eula_accepted(std::path::Path::new(&rec.path), rec.server_type) {
        if accept_eula.unwrap_or(false) {
            procs.accept_eula(&rec)?;
        } else {
            return Err(EULA_REQUIRED.to_string());
        }
    }

    let forced = force.unwrap_or(false);
    if !forced {
        let ext = external::probe(&rec.path);
        if ext.looks_running() {
            return Err(format!(
                "Something is already listening on port {}. The server may already be \
                 running outside CraftPanel — start anyway only if you're sure.",
                ext.port
            ));
        }
    }
    if forced {
        procs.start_forced(&rec)
    } else {
        procs.start(&rec)
    }
}

#[tauri::command]
pub fn stop_server(
    procs: State<ProcessManager>,
    pool: State<RconPool>,
    id: String,
) -> Result<(), String> {
    pool.drop_conn(&id);
    procs.stop(&id)
}

/// Recover from an orphaned server: kill whatever JVM is holding this server's
/// port when CraftPanel can't see it as its own (e.g. a first-boot that got
/// force-quit). Only touches processes whose command line looks like a JVM.
#[tauri::command]
pub fn stop_on_port(db: State<Db>, procs: State<ProcessManager>, id: String) -> Result<(), String> {
    let rec = load(&db, &id)?;
    if procs.is_running(&id) {
        return Err("CraftPanel is managing this server — use Stop.".into());
    }
    let dir = std::path::Path::new(&rec.path);
    let port = external::port_of(dir);
    let pids = external::port_pids(port);
    if pids.is_empty() {
        return Err(format!("Nothing is listening on port {port} to stop."));
    }
    let mut killed = 0;
    let mut skipped = Vec::new();
    for pid in &pids {
        if crate::session::server_alive(*pid) {
            crate::session::terminate(*pid);
            killed += 1;
        } else {
            skipped.push(*pid);
        }
    }
    // give them a moment, then force any that ignored SIGTERM
    for _ in 0..20 {
        std::thread::sleep(std::time::Duration::from_millis(500));
        if external::port_pids(port).is_empty() {
            break;
        }
    }
    for pid in external::port_pids(port) {
        if crate::session::server_alive(pid) {
            crate::session::force_kill(pid);
        }
    }
    crate::session::clear(dir);
    if killed == 0 && !skipped.is_empty() {
        return Err(format!(
            "The process on port {port} (pid {}) doesn't look like a Minecraft server — not touching it.",
            skipped[0]
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn kill_server(
    procs: State<ProcessManager>,
    pool: State<RconPool>,
    id: String,
) -> Result<(), String> {
    pool.drop_conn(&id);
    procs.kill(&id)
}

#[tauri::command]
pub fn send_console(
    procs: State<ProcessManager>,
    id: String,
    line: String,
) -> Result<(), String> {
    procs.write_stdin(&id, line.trim_end())
}

#[tauri::command]
pub fn accept_eula(
    db: State<Db>,
    procs: State<ProcessManager>,
    id: String,
) -> Result<(), String> {
    let rec = load(&db, &id)?;
    procs.accept_eula(&rec)
}

#[tauri::command]
pub fn console_lines(procs: State<ProcessManager>, id: String) -> Vec<LogLine> {
    procs.console(&id)
}

#[tauri::command]
pub fn server_runtime(procs: State<ProcessManager>, id: String) -> ProcSnapshot {
    procs.snapshot(&id)
}

#[tauri::command]
pub fn all_runtimes(procs: State<ProcessManager>) -> Vec<ProcSnapshot> {
    procs.all_snapshots()
}

#[tauri::command]
pub fn set_server_ram(
    db: State<Db>,
    procs: State<ProcessManager>,
    id: String,
    ram_mb: u32,
) -> Result<(), String> {
    if procs.is_running(&id) {
        return Err("Change RAM while the server is stopped.".into());
    }
    let ram_mb = ram_mb.clamp(512, 65536);
    db.update_server_ram(&id, ram_mb).map_err(|e| e.to_string())
}

/// Toggle "keep this machine awake while the server runs". Takes effect on the
/// next start.
#[tauri::command]
pub fn set_keep_awake(db: State<Db>, id: String, keep_awake: bool) -> Result<(), String> {
    db.set_keep_awake(&id, keep_awake).map_err(|e| e.to_string())
}

// --- Stage 3: RCON ------------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RconSettings {
    pub enabled: bool,
    pub port: u16,
    pub has_password: bool,
    pub broadcast_to_ops: bool,
    /// server.properties is present at all.
    pub properties_present: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RconSetupResult {
    pub changed: Vec<String>,
    pub port: u16,
    pub restart_required: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerList {
    pub online: u32,
    pub max: u32,
    pub players: Vec<String>,
}

pub(crate) fn rcon_endpoint(rec: &ServerRecord) -> Result<(u16, String), String> {
    let props = Properties::load(std::path::Path::new(&rec.path));
    if !props.existed() {
        return Err("This server has no server.properties yet — start it once first.".into());
    }
    if props.get_or("enable-rcon", "false") != "true" {
        return Err("RCON isn't enabled for this server. Run RCON setup first.".into());
    }
    let port: u16 = props
        .get_or("rcon.port", "25575")
        .parse()
        .map_err(|_| "rcon.port in server.properties isn't a number".to_string())?;
    let password = props.get("rcon.password").unwrap_or_default();
    if password.is_empty() {
        return Err("rcon.password is blank — run RCON setup to generate one.".into());
    }
    Ok((port, password))
}

/// Run one RCON command through the pooled (kept-alive) connection.
fn rcon_run(pool: &RconPool, rec: &ServerRecord, cmd: &str) -> Result<String, String> {
    let (port, password) = rcon_endpoint(rec)?;
    pool.run(&rec.id, "127.0.0.1", port, &password, |c| c.command(cmd))
        .map_err(|e| e.to_string())
}

/// Run a closure (possibly several commands) through the pooled connection.
pub(crate) fn rcon_with<T>(
    pool: &RconPool,
    rec: &ServerRecord,
    f: impl Fn(&mut RconClient) -> rcon::Result<T>,
) -> Result<T, String> {
    let (port, password) = rcon_endpoint(rec)?;
    pool.run(&rec.id, "127.0.0.1", port, &password, f)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rcon_settings(db: State<Db>, id: String) -> Result<RconSettings, String> {
    let rec = load(&db, &id)?;
    let props = Properties::load(std::path::Path::new(&rec.path));
    Ok(RconSettings {
        enabled: props.get_or("enable-rcon", "false") == "true",
        port: props.get_or("rcon.port", "25575").parse().unwrap_or(25575),
        has_password: !props.get("rcon.password").unwrap_or_default().is_empty(),
        broadcast_to_ops: props.get_or("broadcast-rcon-to-ops", "true") == "true",
        properties_present: props.existed(),
    })
}

/// Enable RCON in server.properties. Only ever writes the four RCON keys —
/// never `online-mode` or anything else.
#[tauri::command]
pub fn rcon_setup(
    db: State<Db>,
    procs: State<ProcessManager>,
    id: String,
) -> Result<RconSetupResult, String> {
    let rec = load(&db, &id)?;
    let dir = std::path::Path::new(&rec.path);
    let mut props = Properties::load(dir);
    if !props.existed() {
        return Err(
            "No server.properties yet. Start the server once so it generates its config, then enable RCON."
                .into(),
        );
    }

    let mut changed = Vec::new();
    if props.set("enable-rcon", "true") {
        changed.push("enable-rcon=true".into());
    }
    let port = props.get_or("rcon.port", "");
    if port.is_empty() || port.parse::<u16>().is_err() {
        props.set("rcon.port", "25575");
        changed.push("rcon.port=25575".into());
    }
    if props.get("rcon.password").unwrap_or_default().is_empty() {
        let pw = gen_password();
        props.set("rcon.password", &pw);
        changed.push("rcon.password=(generated)".into());
    }
    if props.set("broadcast-rcon-to-ops", "true") {
        changed.push("broadcast-rcon-to-ops=true".into());
    }

    props.save().map_err(|e| e.to_string())?;

    let final_port = props.get_or("rcon.port", "25575").parse().unwrap_or(25575);
    let restart_required = procs.is_running(&id) || external::probe(&rec.path).looks_running();

    Ok(RconSetupResult { changed, port: final_port, restart_required })
}

#[tauri::command]
pub fn rcon_players(
    db: State<Db>,
    pool: State<RconPool>,
    id: String,
) -> Result<PlayerList, String> {
    let rec = load(&db, &id)?;
    let out = rcon_run(&pool, &rec, "list")?;
    let (online, max, players) = rcon::parse_player_list(&out);
    Ok(PlayerList { online, max, players })
}

#[tauri::command]
pub fn rcon_command(
    db: State<Db>,
    pool: State<RconPool>,
    id: String,
    command: String,
) -> Result<String, String> {
    let rec = load(&db, &id)?;
    rcon_run(&pool, &rec, command.trim())
}

/// Typed, validated player operations — all keyed on username (offline-safe).
#[tauri::command]
pub fn rcon_player_action(
    db: State<Db>,
    pool: State<RconPool>,
    id: String,
    action: String,
    player: String,
    arg: Option<String>,
) -> Result<String, String> {
    let rec = load(&db, &id)?;
    let player = player.trim();
    if player.is_empty() || !player.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err("Invalid player name.".into());
    }
    let cmd = match action.as_str() {
        "kick" => match arg.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            Some(reason) if reason.chars().all(safe_reason_char) => {
                format!("kick {player} {reason}")
            }
            Some(_) => return Err("Kick reason has unsupported characters.".into()),
            None => format!("kick {player}"),
        },
        "ban" => format!("ban {player}"),
        "pardon" => format!("pardon {player}"),
        "op" => format!("op {player}"),
        "deop" => format!("deop {player}"),
        "whitelist-add" => format!("whitelist add {player}"),
        "whitelist-remove" => format!("whitelist remove {player}"),
        "gamemode" => {
            let mode = arg.as_deref().unwrap_or("");
            if !["survival", "creative", "adventure", "spectator"].contains(&mode) {
                return Err("Unknown gamemode.".into());
            }
            format!("gamemode {mode} {player}")
        }
        other => return Err(format!("Unknown action: {other}")),
    };
    rcon_run(&pool, &rec, &cmd)
}

fn safe_reason_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || " .,!?_-'".contains(c)
}

// --- Stage 2.5: create a server from scratch ---------------------------------

fn parse_loader(s: &str) -> Result<Loader, String> {
    Ok(match s {
        "vanilla" => Loader::Vanilla,
        "paper" => Loader::Paper,
        "fabric" => Loader::Fabric,
        "neoforge" => Loader::Neoforge,
        "forge" => Loader::Forge,
        "bedrock" => Loader::Bedrock,
        other => return Err(format!("Unknown loader: {other}")),
    })
}

#[tauri::command]
pub fn loader_versions(loader: String) -> Result<Vec<VersionInfo>, String> {
    provision::list_versions(parse_loader(&loader)?)
}

/// A Minecraft port not used by any existing CraftPanel server and free on the
/// OS. Scans 25565..25665.
fn pick_free_port(db: &State<Db>) -> Option<u16> {
    let taken: std::collections::HashSet<u16> = db
        .list_servers()
        .unwrap_or_default()
        .iter()
        .map(|s| external::port_of(std::path::Path::new(&s.path)))
        .collect();
    (25565u16..25665).find(|p| !taken.contains(p) && external::port_free(*p))
}

#[tauri::command]
pub fn create_server(
    app: tauri::AppHandle,
    db: State<Db>,
    procs: State<ProcessManager>,
    spec: CreateSpec,
) -> Result<ServerRecord, String> {
    if std::path::Path::new(&spec.dir).exists()
        && std::fs::read_dir(&spec.dir)
            .map(|mut d| d.next().is_some())
            .unwrap_or(false)
    {
        return Err("Pick an empty or new folder for the server.".into());
    }
    if !spec.accept_eula {
        return Err("You must accept the Minecraft EULA to create a server.".into());
    }

    let app2 = app.clone();
    let created = provision::create(&spec, &move |p| {
        let _ = app2.emit("provision:progress", &p);
    })?;

    // Apply the wizard's starting settings + a unique port (line-preserving,
    // never touches online-mode).
    {
        let dir = std::path::Path::new(&created.dir);
        let mut props = Properties::load(dir);
        if props.existed() {
            let is_bedrock = created.server_type == ServerType::Bedrock;
            if let Some(port) = pick_free_port(&db) {
                props.set("server-port", &port.to_string());
                // Bedrock has no query protocol and no RCON at all — only
                // Java's server.properties has these keys.
                if !is_bedrock {
                    props.set("query.port", &port.to_string());
                    props.set("rcon.port", &(port + 10).to_string());
                }
            }
            // "level-seed" is the same key on both editions.
            if let Some(s) = spec.seed.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                props.set("level-seed", s);
            }
            if let Some(g) = spec.gamemode.as_deref() {
                // Bedrock has no "spectator" game mode.
                let valid: &[&str] = if is_bedrock {
                    &["survival", "creative", "adventure"]
                } else {
                    &["survival", "creative", "adventure", "spectator"]
                };
                if valid.contains(&g) {
                    props.set("gamemode", g);
                }
            }
            if let Some(d) = spec.difficulty.as_deref() {
                if ["peaceful", "easy", "normal", "hard"].contains(&d) {
                    props.set("difficulty", d);
                }
            }
            // Bedrock's equivalent of Java's "motd" is a differently-named
            // key, "server-name" — and it's a single plain string, no
            // §-colour-code formatting like Java's MOTD supports.
            if let Some(m) = spec.motd.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                props.set(if is_bedrock { "server-name" } else { "motd" }, m);
            }
            if let Some(mp) = spec.max_players.filter(|n| (1..=1000).contains(n)) {
                props.set("max-players", &mp.to_string());
            }
            let _ = props.save();
        }
    }

    let rec = db
        .insert_server(NewServer {
            name: spec.name.clone(),
            path: created.dir.clone(),
            server_type: created.server_type,
            launch_target: created.launch_target.clone(),
            mc_version: Some(created.mc_version.clone()),
            java_path: spec.java_path.clone().unwrap_or_else(|| "java".to_string()),
            ram_mb: spec.ram_mb,
        })
        .map_err(|e| e.to_string())?;

    crate::attribution::stamp(&db, &rec.path, "created");

    // seed a fresh idle runtime entry so the sidebar shows it immediately
    let _ = procs.snapshot(&rec.id);
    let _ = app.emit("provision:done", &rec);
    Ok(rec)
}

/// Swaps an existing server's loader/version in place — world, plugins/
/// mods, and configs are untouched (see `provision::change_version`).
/// Vanilla/Paper/Fabric only for now; a real backup is taken first no
/// matter what, since this is real surgery on a server someone already
/// has running worlds in.
#[tauri::command]
pub fn change_server_version(
    app: tauri::AppHandle,
    db: State<Db>,
    procs: State<ProcessManager>,
    id: String,
    loader: String,
    mc_version: String,
    loader_version: Option<String>,
) -> Result<ServerRecord, String> {
    let rec = load(&db, &id)?;
    if procs.is_running(&id) {
        return Err("Stop the server first — this replaces its jar file.".into());
    }
    let loader = parse_loader(&loader)?;

    let dir = std::path::Path::new(&rec.path);
    backups::backup_now(dir, Some("before version/loader change"), "manual", &|_| {})
        .map_err(|e| format!("Backup failed, stopping before touching anything: {e}"))?;

    let app2 = app.clone();
    let created = provision::change_version(&rec, loader, mc_version, loader_version, &move |p| {
        let _ = app2.emit("provision:progress", &p);
    })?;

    db.update_server_version(&id, created.server_type, &created.mc_version, &created.launch_target)
        .map_err(|e| e.to_string())?;

    load(&db, &id)
}

/// Copies a server's world/plugins/mods/configs into a brand-new folder and
/// registers it as its own independent server — same jar/version/loader,
/// a fresh port so it can run alongside the original, no shared state
/// (session lock, cloud-sync code, backup history — see `clone.rs`).
#[tauri::command]
pub fn clone_server(
    db: State<Db>,
    procs: State<ProcessManager>,
    id: String,
    new_name: String,
    new_dir: String,
) -> Result<ServerRecord, String> {
    let rec = load(&db, &id)?;
    if procs.is_running(&id) {
        return Err("Stop the server first — cloning while it's writing to its own files isn't safe.".into());
    }
    let name = new_name.trim();
    if name.is_empty() {
        return Err("Give the clone a name.".into());
    }

    crate::clone::clone_dir(std::path::Path::new(&rec.path), std::path::Path::new(&new_dir))?;

    // fresh port so the clone can run at the same time as the original —
    // same line-preserving Properties path `create_server` uses.
    let dir = std::path::Path::new(&new_dir);
    let mut props = Properties::load(dir);
    if props.existed() {
        if let Some(port) = pick_free_port(&db) {
            props.set("server-port", &port.to_string());
            if rec.server_type != ServerType::Bedrock {
                props.set("query.port", &port.to_string());
                props.set("rcon.port", &(port + 10).to_string());
            }
        }
        props.save().map_err(|e| e.to_string())?;
    }

    let cloned = db
        .insert_server(NewServer {
            name: name.to_string(),
            path: new_dir.clone(),
            server_type: rec.server_type,
            launch_target: rec.launch_target.clone(),
            mc_version: rec.mc_version.clone(),
            java_path: rec.java_path.clone(),
            ram_mb: rec.ram_mb,
        })
        .map_err(|e| e.to_string())?;

    crate::attribution::stamp(&db, &cloned.path, "cloned");
    Ok(cloned)
}

// --- modpacks ---------------------------------------------------------------

/// Search Modrinth modpacks by name — thin wrapper so the wizard doesn't
/// need the full mod/plugin search machinery (loader facets, install
/// tracking) that `modrinth_search` carries.
#[tauri::command]
pub fn modpack_search(query: String) -> Result<Vec<serde_json::Value>, String> {
    let url = format!(
        "https://api.modrinth.com/v2/search?query={}&facets=[[\"project_type:modpack\"]]&limit=20&index={}",
        urlencoding_lite(&query),
        if query.is_empty() { "downloads" } else { "relevance" },
    );
    let resp: serde_json::Value = ureq::get(&url)
        .set("User-Agent", "CraftPanel/0.1 (+https://github.com/) modpack-search")
        .timeout(std::time::Duration::from_secs(20))
        .call()
        .map_err(|e| format!("Modrinth search failed: {e}"))?
        .into_json()
        .map_err(|e| format!("Modrinth returned bad JSON: {e}"))?;
    Ok(resp["hits"].as_array().cloned().unwrap_or_default())
}

/// Extremely small percent-encoder — just enough for a search query string,
/// so this doesn't need to pull in a whole URL crate for one call site.
fn urlencoding_lite(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '~') {
                c.to_string()
            } else {
                format!("%{:02X}", c as u32)
            }
        })
        .collect()
}

#[tauri::command]
pub fn modpack_info(project_id: String) -> Result<provision::ModpackInfo, String> {
    provision::modpack_info(&project_id)
}

#[tauri::command]
pub fn create_server_from_modpack(
    app: tauri::AppHandle,
    db: State<Db>,
    procs: State<ProcessManager>,
    spec: provision::ModpackSpec,
) -> Result<ServerRecord, String> {
    if std::path::Path::new(&spec.dir).exists()
        && std::fs::read_dir(&spec.dir)
            .map(|mut d| d.next().is_some())
            .unwrap_or(false)
    {
        return Err("Pick an empty or new folder for the server.".into());
    }
    if !spec.accept_eula {
        return Err("You must accept the Minecraft EULA to create a server.".into());
    }

    let app2 = app.clone();
    let created = provision::create_from_modpack(&spec, &move |p| {
        let _ = app2.emit("provision:progress", &p);
    })?;

    // Only touch the port — everything else about the pack's config is
    // whatever the pack's overrides/first-boot produced. Two servers can't
    // share a port even if the pack's own server.properties assumes 25565.
    {
        let dir = std::path::Path::new(&created.dir);
        let mut props = Properties::load(dir);
        if props.existed() {
            if let Some(port) = pick_free_port(&db) {
                props.set("server-port", &port.to_string());
                if created.server_type != ServerType::Bedrock {
                    props.set("query.port", &port.to_string());
                    props.set("rcon.port", &(port + 10).to_string());
                }
                let _ = props.save();
            }
        }
    }

    let rec = db
        .insert_server(NewServer {
            name: spec.name.clone(),
            path: created.dir.clone(),
            server_type: created.server_type,
            launch_target: created.launch_target.clone(),
            mc_version: Some(created.mc_version.clone()),
            java_path: spec.java_path.clone().unwrap_or_else(|| "java".to_string()),
            ram_mb: spec.ram_mb,
        })
        .map_err(|e| e.to_string())?;

    crate::attribution::stamp(&db, &rec.path, "created");

    let _ = procs.snapshot(&rec.id);
    let _ = app.emit("provision:done", &rec);
    Ok(rec)
}

// --- Stage 4: settings + mods ----------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub changed: Vec<String>,
    pub restart_required: bool,
}

#[tauri::command]
pub fn get_settings(db: State<Db>, id: String) -> Result<ServerSettings, String> {
    let rec = load(&db, &id)?;
    Ok(settings::read(&rec.path, rec.server_type))
}

#[tauri::command]
pub fn apply_settings(
    db: State<Db>,
    procs: State<ProcessManager>,
    id: String,
    changes: Vec<(String, String)>,
) -> Result<ApplyResult, String> {
    let rec = load(&db, &id)?;
    let changed = settings::apply(&rec.path, &changes)?;
    let restart_required = !changed.is_empty()
        && (procs.is_running(&id) || external::probe(&rec.path).looks_running());
    Ok(ApplyResult { changed, restart_required })
}

#[tauri::command]
pub fn list_mods(db: State<Db>, id: String) -> Result<ModList, String> {
    let rec = load(&db, &id)?;
    Ok(mods::list(&rec.path, rec.server_type))
}

#[tauri::command]
pub fn set_mod_enabled(
    db: State<Db>,
    id: String,
    name: String,
    enable: bool,
) -> Result<(), String> {
    let rec = load(&db, &id)?;
    mods::set_enabled(&rec.path, &name, enable)
}

#[tauri::command]
pub fn remove_mod(db: State<Db>, id: String, name: String) -> Result<(), String> {
    let rec = load(&db, &id)?;
    mods::remove(&rec.path, &name)
}

#[tauri::command]
pub fn import_mods(
    db: State<Db>,
    id: String,
    sources: Vec<String>,
) -> Result<Vec<String>, String> {
    let rec = load(&db, &id)?;
    mods::import(&rec.path, &sources)
}

// --- Stage 6.1: backups ---------------------------------------------------------

const BACKUPS_KEEP_KEY: &str = "backups.keep";
const BACKUPS_KEEP_DEFAULT: u32 = 20;

fn backups_keep(db: &State<Db>) -> u32 {
    db.get_setting(BACKUPS_KEEP_KEY)
        .ok()
        .flatten()
        .and_then(|s| s.parse().ok())
        .unwrap_or(BACKUPS_KEEP_DEFAULT)
}

fn emit_backup_progress(app: &tauri::AppHandle, server_id: &str, message: &str) {
    let _ = app.emit(
        "backup:progress",
        serde_json::json!({ "serverId": server_id, "message": message }),
    );
}

#[tauri::command]
pub fn backup_now(
    app: tauri::AppHandle,
    db: State<Db>,
    id: String,
    label: Option<String>,
) -> Result<Backup, String> {
    let rec = load(&db, &id)?;
    let dir = std::path::Path::new(&rec.path);
    let sid = id.clone();
    let app2 = app.clone();
    let progress = move |msg: &str| emit_backup_progress(&app2, &sid, msg);
    let made = backups::backup_now(dir, label.as_deref(), "manual", &progress)?;
    backups::prune(dir, backups_keep(&db) as usize);
    Ok(made)
}

#[tauri::command]
pub fn list_backups(db: State<Db>, id: String) -> Result<Vec<Backup>, String> {
    let rec = load(&db, &id)?;
    Ok(backups::list(std::path::Path::new(&rec.path)))
}

/// This server's backups already pushed to R2 (via Schedule.cloud_backup),
/// read from that server's remote index — no zips downloaded, no R2 call at
/// all if it isn't configured.
#[tauri::command]
pub fn cloud_backups(
    cloud: State<Arc<CloudManager>>,
    id: String,
) -> Result<Vec<Backup>, String> {
    if !cloud.is_configured() {
        return Ok(Vec::new());
    }
    cloud.cloud_backups(&id)
}

#[tauri::command]
pub fn delete_backup(db: State<Db>, id: String, backup_id: String) -> Result<(), String> {
    let rec = load(&db, &id)?;
    backups::delete(std::path::Path::new(&rec.path), &backup_id)
}

#[tauri::command]
pub fn restore_backup(
    app: tauri::AppHandle,
    db: State<Db>,
    procs: State<ProcessManager>,
    id: String,
    backup_id: String,
) -> Result<(), String> {
    let rec = load(&db, &id)?;
    if procs.is_running(&id) || external::probe(&rec.path).looks_running() {
        return Err("Stop the server before restoring a backup.".into());
    }
    let dir = std::path::Path::new(&rec.path);
    let sid = id.clone();
    let app2 = app.clone();
    let progress = move |msg: &str| emit_backup_progress(&app2, &sid, msg);
    backups::restore(dir, &backup_id, &progress)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupsConfig {
    pub keep: u32,
}

#[tauri::command]
pub fn get_backups_config(db: State<Db>) -> BackupsConfig {
    BackupsConfig { keep: backups_keep(&db) }
}

#[tauri::command]
pub fn set_backups_keep(db: State<Db>, keep: u32) -> Result<(), String> {
    db.set_setting(BACKUPS_KEEP_KEY, &keep.min(1000).to_string())
        .map_err(|e| e.to_string())
}

// --- "Time Machine" snapshots ------------------------------------------------

#[tauri::command]
pub fn snapshot_now(db: State<Db>, id: String) -> Result<Snapshot, String> {
    let rec = load(&db, &id)?;
    let dir = std::path::Path::new(&rec.path);
    let made = snapshots::snapshot_now(dir, "manual", &|_| {})?;
    let sch = schedule::read(&db, &id);
    snapshots::prune(dir, sch.snapshot_recent_hours(), sch.snapshot_daily_days());
    Ok(made)
}

#[tauri::command]
pub fn list_snapshots(db: State<Db>, id: String) -> Result<Vec<Snapshot>, String> {
    let rec = load(&db, &id)?;
    Ok(snapshots::list(std::path::Path::new(&rec.path)))
}

#[tauri::command]
pub fn restore_snapshot(
    app: tauri::AppHandle,
    db: State<Db>,
    procs: State<ProcessManager>,
    id: String,
    snapshot_id: String,
) -> Result<(), String> {
    let rec = load(&db, &id)?;
    if procs.is_running(&id) || external::probe(&rec.path).looks_running() {
        return Err("Stop the server before restoring a snapshot.".into());
    }
    let dir = std::path::Path::new(&rec.path);
    let sid = id.clone();
    let app2 = app.clone();
    let progress = move |msg: &str| emit_backup_progress(&app2, &sid, msg);
    snapshots::restore(dir, &snapshot_id, &progress)
}

#[tauri::command]
pub fn delete_snapshot(db: State<Db>, id: String, snapshot_id: String) -> Result<(), String> {
    let rec = load(&db, &id)?;
    snapshots::delete(std::path::Path::new(&rec.path), &snapshot_id)
}

// --- files + logs ------------------------------------------------------------

#[tauri::command]
pub fn fs_list(db: State<Db>, id: String, path: String) -> Result<Listing, String> {
    let rec = load(&db, &id)?;
    files::list(std::path::Path::new(&rec.path), &path)
}

#[tauri::command]
pub fn fs_read(db: State<Db>, id: String, path: String) -> Result<FileView, String> {
    let rec = load(&db, &id)?;
    files::read(std::path::Path::new(&rec.path), &path)
}

#[tauri::command]
pub fn fs_write(db: State<Db>, id: String, path: String, content: String) -> Result<(), String> {
    let rec = load(&db, &id)?;
    files::write(std::path::Path::new(&rec.path), &path, &content)
}

#[tauri::command]
pub fn fs_mkdir(db: State<Db>, id: String, path: String) -> Result<(), String> {
    let rec = load(&db, &id)?;
    files::mkdir(std::path::Path::new(&rec.path), &path)
}

#[tauri::command]
pub fn fs_rename(db: State<Db>, id: String, from: String, to: String) -> Result<(), String> {
    let rec = load(&db, &id)?;
    files::rename(std::path::Path::new(&rec.path), &from, &to)
}

#[tauri::command]
pub fn fs_delete(db: State<Db>, id: String, path: String) -> Result<(), String> {
    let rec = load(&db, &id)?;
    files::delete(std::path::Path::new(&rec.path), &path)
}

#[tauri::command]
pub fn fs_import(
    db: State<Db>,
    id: String,
    dir: String,
    sources: Vec<String>,
) -> Result<Vec<String>, String> {
    let rec = load(&db, &id)?;
    files::import(std::path::Path::new(&rec.path), &dir, &sources)
}

#[tauri::command]
pub fn fs_export(db: State<Db>, id: String, path: String, dest: String) -> Result<(), String> {
    let rec = load(&db, &id)?;
    files::export(std::path::Path::new(&rec.path), &path, &dest)
}

#[tauri::command]
pub fn tail_log(
    db: State<Db>,
    id: String,
    file: Option<String>,
    lines: Option<u32>,
) -> Result<String, String> {
    let rec = load(&db, &id)?;
    files::tail(
        std::path::Path::new(&rec.path),
        file.as_deref(),
        lines.unwrap_or(400) as usize,
    )
}

#[tauri::command]
pub fn admin_lists(db: State<Db>, id: String) -> Result<AdminLists, String> {
    let rec = load(&db, &id)?;
    Ok(admin::read_lists(&rec.path))
}

#[tauri::command]
pub fn player_history(
    db: State<Db>,
    procs: State<ProcessManager>,
    id: String,
) -> Result<Vec<PlayerStat>, String> {
    let rec = load(&db, &id)?;
    let online = procs.is_running(&id) || external::probe(&rec.path).looks_running();
    Ok(analytics::player_history(&rec.path, online))
}

/// Concurrent-player-count time series — "peak hours", from the same log
/// data `player_history` already parses. `since`/`bucket_secs` in seconds;
/// the frontend passes e.g. 24h/3600s, 7d/21600s (6h), 30d/86400s (1d).
#[tauri::command]
pub fn player_activity(
    db: State<Db>,
    procs: State<ProcessManager>,
    id: String,
    since: i64,
    bucket_secs: i64,
) -> Result<Vec<analytics::ConcurrentPoint>, String> {
    let rec = load(&db, &id)?;
    let online = procs.is_running(&id) || external::probe(&rec.path).looks_running();
    Ok(analytics::concurrent_series(&rec.path, online, since, bucket_secs))
}

/// RAM/CPU/TPS history from the background sampler (`metrics_history.rs`)
/// — one row roughly every 60s while the server was running.
#[tauri::command]
pub fn metrics_history(db: State<Db>, id: String, since: i64) -> Result<Vec<db::MetricPoint>, String> {
    let _ = load(&db, &id)?;
    db.metric_history(&id, since).map_err(|e| e.to_string())
}

/// Every known plugin (EssentialsX/LuckPerms/Geyser) actually installed on
/// this server, with its current values for the handful of settings
/// CraftPanel offers a visual editor for.
#[tauri::command]
pub fn plugin_config_views(db: State<Db>, id: String) -> Result<Vec<pluginconfig::PluginConfigView>, String> {
    let rec = load(&db, &id)?;
    Ok(pluginconfig::detect(&rec.path))
}

// --- local app lock (PIN) --------------------------------------------------

#[tauri::command]
pub fn lock_status(lock: State<crate::lock::Lock>) -> bool {
    lock.is_set()
}

#[tauri::command]
pub fn lock_set(lock: State<crate::lock::Lock>, pin: String) -> Result<(), String> {
    lock.set(&pin)
}

#[tauri::command]
pub fn lock_check(lock: State<crate::lock::Lock>, pin: String) -> bool {
    lock.check(&pin)
}

#[tauri::command]
pub fn lock_clear(lock: State<crate::lock::Lock>, current_pin: String) -> Result<(), String> {
    lock.clear(&current_pin)
}

#[tauri::command]
pub fn set_plugin_config(
    db: State<Db>,
    id: String,
    plugin: String,
    key: String,
    value: String,
) -> Result<(), String> {
    let rec = load(&db, &id)?;
    pluginconfig::set_field(&rec.path, &plugin, &key, &value)
}

// --- branding + worlds -------------------------------------------------------

#[tauri::command]
pub fn server_icon_status(db: State<Db>, id: String) -> Result<bool, String> {
    let rec = load(&db, &id)?;
    Ok(branding::has_icon(std::path::Path::new(&rec.path)))
}

#[tauri::command]
pub fn set_server_icon(db: State<Db>, id: String, source: String) -> Result<(), String> {
    let rec = load(&db, &id)?;
    branding::set_icon(std::path::Path::new(&rec.path), &source)
}

#[tauri::command]
pub fn clear_server_icon(db: State<Db>, id: String) -> Result<(), String> {
    let rec = load(&db, &id)?;
    branding::clear_icon(std::path::Path::new(&rec.path))
}

fn world_guard(db: &State<Db>, procs: &State<ProcessManager>, id: &str) -> Result<ServerRecord, String> {
    let rec = load(db, id)?;
    if procs.is_running(id) || external::probe(&rec.path).looks_running() {
        return Err("Stop the server before changing worlds.".into());
    }
    Ok(rec)
}

#[tauri::command]
pub fn list_worlds(db: State<Db>, id: String) -> Result<WorldInfo, String> {
    let rec = load(&db, &id)?;
    Ok(worlds::list(&rec.path))
}

#[tauri::command]
pub fn world_set_active(
    db: State<Db>,
    procs: State<ProcessManager>,
    id: String,
    name: String,
) -> Result<(), String> {
    let rec = world_guard(&db, &procs, &id)?;
    worlds::set_active(&rec.path, &name)
}

#[tauri::command]
pub fn world_create(
    db: State<Db>,
    procs: State<ProcessManager>,
    id: String,
    name: String,
    seed: Option<String>,
) -> Result<(), String> {
    let rec = world_guard(&db, &procs, &id)?;
    worlds::create(&rec.path, &name, seed.as_deref())
}

#[tauri::command]
pub fn world_rename(
    db: State<Db>,
    procs: State<ProcessManager>,
    id: String,
    from: String,
    to: String,
) -> Result<(), String> {
    let rec = world_guard(&db, &procs, &id)?;
    worlds::rename(&rec.path, &from, &to)
}

#[tauri::command]
pub fn world_delete(
    db: State<Db>,
    procs: State<ProcessManager>,
    id: String,
    name: String,
) -> Result<(), String> {
    let rec = world_guard(&db, &procs, &id)?;
    worlds::delete(&rec.path, &name)
}

// --- resource pack -----------------------------------------------------------

#[tauri::command]
pub fn get_resource_pack(db: State<Db>, id: String) -> Result<ResourcePackConfig, String> {
    let rec = load(&db, &id)?;
    Ok(resourcepack::read(std::path::Path::new(&rec.path)))
}

#[tauri::command]
pub fn set_resource_pack(
    db: State<Db>,
    id: String,
    url: String,
    prompt: String,
    required: bool,
) -> Result<ResourcePackConfig, String> {
    let rec = load(&db, &id)?;
    resourcepack::set_from_url(std::path::Path::new(&rec.path), &url, &prompt, required)
}

#[tauri::command]
pub fn clear_resource_pack(db: State<Db>, id: String) -> Result<(), String> {
    let rec = load(&db, &id)?;
    resourcepack::clear(std::path::Path::new(&rec.path))
}

// --- networking: join address, UPnP, QR --------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinInfo {
    #[serde(flatten)]
    pub net: NetInfo,
    /// a tunnel address the user pasted (playit.gg / bore / ngrok)
    pub tunnel_address: Option<String>,
    /// what we'd tell friends to use, best-first
    pub recommended: Option<String>,
}

fn tunnel_key(id: &str) -> String {
    format!("tunnel.{id}")
}

#[tauri::command]
pub fn net_info(
    db: State<Db>,
    tunnel: State<Arc<TunnelManager>>,
    id: String,
) -> Result<JoinInfo, String> {
    let rec = load(&db, &id)?;
    let net = net::info(&rec.path, rec.server_type.is_bedrock());
    // a running in-app tunnel wins; else the user's saved permanent address
    let live_tunnel = tunnel.status(&id).address;
    let tunnel_address = live_tunnel.clone().or_else(|| {
        db.get_setting(&tunnel_key(&id))
            .ok()
            .flatten()
            .filter(|s| !s.trim().is_empty())
    });
    let recommended = tunnel_address
        .clone()
        .or_else(|| {
            if net.upnp_mapped && !net.likely_cgnat {
                net.public_address.clone()
            } else {
                None
            }
        })
        .or_else(|| net.lan_address.clone());
    Ok(JoinInfo { net, tunnel_address, recommended })
}

#[tauri::command]
pub fn tunnel_start(
    db: State<Db>,
    tunnel: State<Arc<TunnelManager>>,
    id: String,
) -> Result<(), String> {
    let rec = load(&db, &id)?;
    let port = external::port_of(std::path::Path::new(&rec.path));
    tunnel.inner().start(&id, port)
}

#[tauri::command]
pub fn tunnel_stop(tunnel: State<Arc<TunnelManager>>, id: String) {
    tunnel.stop(&id);
}

#[tauri::command]
pub fn tunnel_status(tunnel: State<Arc<TunnelManager>>, id: String) -> TunnelStatus {
    tunnel.status(&id)
}

#[tauri::command]
pub fn set_tunnel_address(db: State<Db>, id: String, address: Option<String>) -> Result<(), String> {
    let v = address.unwrap_or_default();
    let v = v.trim();
    if v.len() > 200 {
        return Err("That address is too long.".into());
    }
    db.set_setting(&tunnel_key(&id), v).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn upnp_forward(db: State<Db>, id: String) -> Result<String, String> {
    let rec = load(&db, &id)?;
    net::upnp_forward(&rec.path, rec.server_type.is_bedrock())
}

#[tauri::command]
pub fn upnp_remove(db: State<Db>, id: String) -> Result<(), String> {
    let rec = load(&db, &id)?;
    net::upnp_remove(&rec.path, rec.server_type.is_bedrock())
}

#[tauri::command]
pub fn qr_svg(text: String) -> Result<String, String> {
    net::qr_svg(&text)
}

// --- Stage 6.2: automation / scheduler --------------------------------------

#[tauri::command]
pub fn get_schedule(db: State<Db>, id: String) -> Result<Schedule, String> {
    load(&db, &id)?;
    Ok(schedule::read(&db, &id))
}

#[tauri::command]
pub fn set_schedule(db: State<Db>, id: String, schedule: Schedule) -> Result<(), String> {
    load(&db, &id)?;
    schedule::write(&db, &id, &schedule)
}

// --- Stage 7: performance, crashes, JVM args -------------------------------

#[tauri::command]
pub fn server_perf(
    db: State<Db>,
    procs: State<ProcessManager>,
    pool: State<RconPool>,
    id: String,
) -> Result<PerfSample, String> {
    let rec = load(&db, &id)?;
    let dir = std::path::Path::new(&rec.path);
    let mut s = PerfSample::default();

    let pid = procs.snapshot(&id).pid.or_else(|| {
        external::port_pids(external::port_of(dir)).into_iter().next()
    });
    if let Some(pid) = pid {
        let (ram, cpu) = perf::process_sample(pid);
        s.ram_mb = ram;
        s.cpu_pct = cpu;
    }

    if procs.is_running(&id) || external::probe(&rec.path).looks_running() {
        if let Ok((tps, mspt, src)) =
            rcon_with(&pool, &rec, |c| Ok(perf::tps_over_rcon(c)))
        {
            s.tps = tps;
            s.mspt = mspt;
            s.source = src;
        }
    }
    Ok(s)
}

#[tauri::command]
pub fn latest_crash(db: State<Db>, id: String) -> Result<Option<CrashReport>, String> {
    let rec = load(&db, &id)?;
    Ok(crashreports::latest(&rec.path))
}

#[tauri::command]
pub fn list_crashes(db: State<Db>, id: String) -> Result<Vec<CrashReport>, String> {
    let rec = load(&db, &id)?;
    Ok(crashreports::list(&rec.path))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JvmInfo {
    pub args: Option<String>,
    pub resolved: String,
    pub aikar: String,
}

/// Aikar's flags (the heap flags come from the RAM slider, so they're omitted).
fn aikar_flags(ram_mb: u32) -> String {
    let big = ram_mb >= 12_288;
    let (new_pct, max_new, region, reserve, ihop) = if big {
        (40, 50, "16M", 15, 20)
    } else {
        (30, 40, "8M", 20, 15)
    };
    format!(
        "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 \
-XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:+AlwaysPreTouch \
-XX:G1NewSizePercent={new_pct} -XX:G1MaxNewSizePercent={max_new} -XX:G1HeapRegionSize={region} \
-XX:G1ReservePercent={reserve} -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4 \
-XX:InitiatingHeapOccupancyPercent={ihop} -XX:G1MixedGCLiveThresholdPercent=90 \
-XX:G1RSetUpdatingPauseTimePercent=5 -XX:SurvivorRatio=32 -XX:+PerfDisableSharedMem \
-XX:MaxTenuringThreshold=1 -Dusing.aikars.flags=https://mcflags.emc.gs -Daikars.new.flags=true"
    )
}

#[tauri::command]
pub fn get_jvm_args(db: State<Db>, id: String) -> Result<JvmInfo, String> {
    let rec = load(&db, &id)?;
    Ok(JvmInfo {
        args: rec.jvm_args.clone(),
        resolved: crate::process::describe_launch(&rec),
        aikar: aikar_flags(rec.ram_mb),
    })
}

#[tauri::command]
pub fn set_jvm_args(
    db: State<Db>,
    procs: State<ProcessManager>,
    id: String,
    args: Option<String>,
) -> Result<bool, String> {
    load(&db, &id)?;
    let v = args.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    db.set_jvm_args(&id, v.as_deref()).map_err(|e| e.to_string())?;
    Ok(procs.is_running(&id))
}

// --- Stage 8: Modrinth content browser ------------------------------------

#[tauri::command]
pub fn modrinth_search(
    db: State<Db>,
    id: String,
    query: String,
    project_type: String,
    category: Option<String>,
    offset: Option<u32>,
) -> Result<SearchResult, String> {
    let rec = load(&db, &id)?;
    modrinth::search(
        &rec.path,
        rec.server_type,
        &query,
        &project_type,
        category.as_deref(),
        rec.mc_version.as_deref(),
        offset.unwrap_or(0),
    )
}

#[tauri::command]
pub fn modrinth_install(
    db: State<Db>,
    id: String,
    project_id: String,
    project_type: String,
) -> Result<InstallResult, String> {
    let rec = load(&db, &id)?;
    modrinth::install(
        &rec.path,
        rec.server_type,
        &project_id,
        &project_type,
        rec.mc_version.as_deref(),
    )
}

#[tauri::command]
pub fn modrinth_install_resourcepack(
    db: State<Db>,
    id: String,
    project_id: String,
    prompt: String,
    required: bool,
) -> Result<ResourcePackConfig, String> {
    let rec = load(&db, &id)?;
    modrinth::install_resourcepack(&rec.path, &project_id, rec.mc_version.as_deref(), &prompt, required)
}

/// Doesn't need a server id — Modrinth's gallery is a plain public GET,
/// nothing here depends on which server is asking.
#[tauri::command]
pub fn modrinth_gallery(project_id: String) -> Result<Vec<String>, String> {
    modrinth::gallery(&project_id)
}

#[tauri::command]
pub fn modrinth_installed(db: State<Db>, id: String) -> Result<Vec<InstalledEntry>, String> {
    let rec = load(&db, &id)?;
    Ok(modrinth::installed(&rec.path))
}

#[tauri::command]
pub fn modrinth_check_updates(db: State<Db>, id: String) -> Result<Vec<InstalledEntry>, String> {
    let rec = load(&db, &id)?;
    modrinth::check_updates(&rec.path, rec.server_type, rec.mc_version.as_deref())
}

#[tauri::command]
pub fn modrinth_update(db: State<Db>, id: String, project_id: String) -> Result<(), String> {
    let rec = load(&db, &id)?;
    modrinth::update_one(&rec.path, rec.server_type, &project_id, rec.mc_version.as_deref())
}

#[tauri::command]
pub fn modrinth_remove(db: State<Db>, id: String, project_id: String) -> Result<(), String> {
    let rec = load(&db, &id)?;
    modrinth::remove_one(&rec.path, rec.server_type, &project_id)
}

// --- Stage 9: anti-cheat + management API ---------------------------------

#[tauri::command]
pub fn anticheat_advice(db: State<Db>, id: String) -> Result<Advice, String> {
    let rec = load(&db, &id)?;
    // "public" = the server is being shared to the internet via a tunnel
    let shared = db
        .get_setting(&format!("tunnel.{id}"))
        .ok()
        .flatten()
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    Ok(anticheat::advise(&rec.path, rec.server_type, shared))
}

#[tauri::command]
pub fn anticheat_suspicion(db: State<Db>, id: String) -> Result<Vec<Suspicion>, String> {
    let rec = load(&db, &id)?;
    Ok(anticheat::suspicion(&rec.path))
}

#[tauri::command]
pub fn mgmt_status(db: State<Db>, id: String) -> Result<MgmtStatus, String> {
    let rec = load(&db, &id)?;
    Ok(mgmt::status(&rec.path, rec.mc_version.as_deref()))
}

#[tauri::command]
pub fn mgmt_enable(
    db: State<Db>,
    procs: State<ProcessManager>,
    id: String,
) -> Result<MgmtStatus, String> {
    let rec = load(&db, &id)?;
    let running = procs.is_running(&id) || external::probe(&rec.path).looks_running();
    let port = crate::external::port_of(std::path::Path::new(&rec.path)).wrapping_add(20);
    let st = mgmt::enable(&rec.path, if port == 0 { 25585 } else { port })?;
    let _ = running;
    Ok(st)
}

#[tauri::command]
pub fn mgmt_disable(db: State<Db>, id: String) -> Result<(), String> {
    let rec = load(&db, &id)?;
    mgmt::disable(&rec.path)
}

// --- Stage 10: app settings + update check --------------------------------

#[derive(Serialize, serde::Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub default_java: String,
    #[serde(default)]
    pub default_ram_mb: u32,
    #[serde(default)]
    pub expert_mode: bool,
    /// closing / quitting CraftPanel leaves running servers alive
    #[serde(default)]
    pub keep_servers_on_quit: bool,
    /// Discord webhook URL — server start/stop/crash and scheduled-backup
    /// notifications post here. Blank = notifications off.
    #[serde(default)]
    pub discord_webhook_url: String,
    /// Keeps the Mac from sleeping while it's on AC power (battery still
    /// sleeps normally) — what makes a per-server scheduled start able to
    /// actually fire instead of sitting there asleep at the target time.
    #[serde(default)]
    pub stay_awake_on_power: bool,
}

const APP_SETTINGS_KEY: &str = "app.settings";

pub fn read_app_settings(db: &Db) -> AppSettings {
    db.get_setting(APP_SETTINGS_KEY)
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn app_settings_get(db: State<Db>) -> AppSettings {
    read_app_settings(&db)
}

#[tauri::command]
pub fn app_settings_set(
    power: State<crate::power::PowerKeeper>,
    db: State<Db>,
    settings: AppSettings,
) -> Result<(), String> {
    power.set_enabled(settings.stay_awake_on_power)?;
    let json = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
    db.set_setting(APP_SETTINGS_KEY, &json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn discord_test_webhook(url: String) -> Result<(), String> {
    let url = url.trim();
    if url.is_empty() {
        return Err("Paste a webhook URL first.".to_string());
    }
    crate::discord::post(url, "👋 CraftPanel is wired up — you'll hear from this channel when a server crashes, stops on its own, or a scheduled backup fails.")
}

#[tauri::command]
pub fn doctor_check(
    app: tauri::AppHandle,
    db: State<Db>,
    cloud: State<Arc<CloudManager>>,
) -> Result<crate::doctor::DoctorReport, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(crate::doctor::run(&db, &cloud, &dir))
}

#[tauri::command]
pub fn check_update() -> crate::updater::UpdateCheck {
    crate::updater::check()
}

#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    crate::updater::install(&app).await
}

/// This install's id — the same value stamped into every server's
/// `.craftpanel-meta.json` (see `attribution.rs`). Surfaced in Settings →
/// About so it's not just a silent dotfile: the person running the app can
/// see exactly what it is and what it's for.
#[tauri::command]
pub fn app_install_id(db: State<Db>) -> String {
    crate::attribution::install_id(&db)
}

// --- Stage 11: Bedrock cross-play (Geyser) --------------------------------

#[tauri::command]
pub fn crossplay_status(db: State<Db>, id: String) -> Result<CrossplayStatus, String> {
    let rec = load(&db, &id)?;
    Ok(crossplay::status(&rec.path, rec.server_type))
}

#[tauri::command]
pub fn crossplay_enable(db: State<Db>, id: String) -> Result<CrossplayStatus, String> {
    let rec = load(&db, &id)?;
    crossplay::enable(&rec.path, rec.server_type)
}

#[tauri::command]
pub fn crossplay_disable(db: State<Db>, id: String) -> Result<(), String> {
    let rec = load(&db, &id)?;
    crossplay::disable(&rec.path, rec.server_type)
}

/// Port-forward Geyser's Bedrock UDP port so Bedrock friends can connect.
#[tauri::command]
pub fn crossplay_forward(db: State<Db>, id: String) -> Result<(), String> {
    let rec = load(&db, &id)?;
    let port = crossplay::status(&rec.path, rec.server_type).bedrock_port;
    net::upnp_forward_port(port, true)
}

// --- multi-device sharing (MVP: synced folder + advisory lease) ------------

#[tauri::command]
pub fn share_server(db: State<Db>, id: String) -> Result<ShareInfo, String> {
    let rec = load(&db, &id)?;
    share::create_share(std::path::Path::new(&rec.path), &rec.name)
}

#[tauri::command]
pub fn unshare_server(
    db: State<Db>,
    device: State<DeviceId>,
    id: String,
) -> Result<(), String> {
    let rec = load(&db, &id)?;
    let dir = std::path::Path::new(&rec.path);
    let v = share::view(dir, &device.0);
    if v.locked && !v.held_by_us {
        return Err("It's in use on another device right now — try again when it's free.".into());
    }
    let _ = std::fs::remove_file(dir.join(share::LEASE_FILE));
    std::fs::remove_file(dir.join(share::SHARE_FILE)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn join_shared(
    db: State<Db>,
    procs: State<ProcessManager>,
    folder: String,
    code: String,
) -> Result<ServerRecord, String> {
    let dir = std::path::Path::new(&folder);
    let info = share::read_share(dir)
        .ok_or("That folder isn't a shared CraftPanel server (no craftpanel-share.json).")?;
    let norm = |s: &str| s.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_uppercase();
    if norm(&info.code) != norm(&code) {
        return Err("Wrong code for this shared server.".into());
    }
    if db.list_servers().unwrap_or_default().iter().any(|s| s.path == folder) {
        return Err("This shared server is already in your list.".into());
    }

    let d = MinecraftAdapter::inspect(dir)
        .ok_or("Couldn't detect a Minecraft server in the shared folder.")?;
    let java = java::probe(None).map(|j| j.path).unwrap_or_else(|| "java".into());

    let rec = db
        .insert_server(NewServer {
            name: info.name,
            path: folder,
            server_type: d.server_type,
            launch_target: d.launch_target,
            mc_version: d.mc_version,
            java_path: java,
            ram_mb: 4096,
        })
        .map_err(|e| e.to_string())?;
    let _ = procs.snapshot(&rec.id);
    Ok(rec)
}

#[tauri::command]
pub fn share_status(
    db: State<Db>,
    device: State<DeviceId>,
    id: String,
) -> Result<ShareView, String> {
    let rec = load(&db, &id)?;
    Ok(share::view(std::path::Path::new(&rec.path), &device.0))
}

// --- cloud sync (R2) -----------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct R2Status {
    pub configured: bool,
    pub config: Option<R2Config>,
}

#[tauri::command]
pub fn r2_config_get(cloud: State<Arc<CloudManager>>) -> R2Status {
    R2Status {
        configured: cloud.is_configured(),
        config: cloud.config_redacted(),
    }
}

#[tauri::command]
pub fn r2_config_set(cloud: State<Arc<CloudManager>>, config: R2Config) -> Result<(), String> {
    cloud.set_config(config)
}

#[tauri::command]
pub fn r2_config_clear(cloud: State<Arc<CloudManager>>) {
    cloud.clear_config();
}

#[tauri::command]
pub fn cloud_share(
    db: State<Db>,
    cloud: State<Arc<CloudManager>>,
    id: String,
) -> Result<String, String> {
    let rec = load(&db, &id)?;
    if rec.sync_code.is_some() {
        return Err("This server is already shared to the cloud.".into());
    }
    let code = cloud.share(&rec)?;
    db.set_sync_code(&id, Some(&code)).map_err(|e| e.to_string())?;
    Ok(code)
}

#[tauri::command]
pub fn cloud_join(
    db: State<Db>,
    procs: State<ProcessManager>,
    cloud: State<Arc<CloudManager>>,
    code: String,
    folder: String,
) -> Result<ServerRecord, String> {
    let dir = std::path::Path::new(&folder);
    if dir.exists()
        && std::fs::read_dir(dir).map(|mut d| d.next().is_some()).unwrap_or(false)
    {
        return Err("Pick an empty folder to download the shared server into.".into());
    }
    let norm = |s: &str| {
        s.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_uppercase()
    };
    let code = norm(&code);
    if db.list_servers().unwrap_or_default().iter().any(|s| s.sync_code.as_deref().map(norm) == Some(code.clone())) {
        return Err("You've already joined this shared server.".into());
    }

    let m = cloud.join(&code, dir)?;
    let java = java::probe(None).map(|j| j.path).unwrap_or_else(|| "java".into());
    let rec = db
        .insert_server(NewServer {
            name: m.name,
            path: folder,
            server_type: m.loader,
            launch_target: m.launch_target,
            mc_version: m.mc_version,
            java_path: java,
            ram_mb: 4096,
        })
        .map_err(|e| e.to_string())?;
    db.set_sync_code(&rec.id, Some(&code)).map_err(|e| e.to_string())?;
    let _ = procs.snapshot(&rec.id);
    let mut rec = rec;
    rec.sync_code = Some(code);
    Ok(rec)
}

#[tauri::command]
pub fn cloud_status(
    db: State<Db>,
    cloud: State<Arc<CloudManager>>,
    id: String,
) -> Result<Option<CloudStatus>, String> {
    let rec = load(&db, &id)?;
    cloud.status(&rec)
}

#[tauri::command]
pub fn cloud_finish(
    db: State<Db>,
    cloud: State<Arc<CloudManager>>,
    id: String,
) -> Result<(), String> {
    let rec = load(&db, &id)?;
    cloud.finish(&rec)
}

#[tauri::command]
pub fn cloud_unshare(
    db: State<Db>,
    cloud: State<Arc<CloudManager>>,
    id: String,
) -> Result<(), String> {
    let rec = load(&db, &id)?;
    cloud.unshare(&rec)?;
    db.set_sync_code(&id, None).map_err(|e| e.to_string())
}

fn gen_password() -> String {
    // Local RCON password; 24 hex chars from two v4 UUIDs is plenty.
    let a = uuid::Uuid::new_v4().simple().to_string();
    let b = uuid::Uuid::new_v4().simple().to_string();
    format!("{a}{b}")[..24].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn detect_server_reports_paper_with_version_and_java_check() {
        let d = std::env::temp_dir().join("cp-cmd-paper");
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("paper-1.21.1.jar"), b"").unwrap();
        fs::write(
            d.join("version_history.json"),
            br#"{"currentVersion":"git-Paper-1 (MC: 1.21.1)"}"#,
        )
        .unwrap();

        let r = detect_server(d.to_string_lossy().to_string());
        assert!(r.detected);
        assert_eq!(r.server_type, Some(ServerType::Paper));
        assert_eq!(r.mc_version.as_deref(), Some("1.21.1"));
        assert_eq!(r.launch_target.as_deref(), Some("paper-1.21.1.jar"));
    }

    #[test]
    fn detect_server_handles_non_folder_and_empty() {
        let r = detect_server("/definitely/not/here".into());
        assert!(!r.detected);
        assert!(!r.warnings.is_empty());
    }
}
