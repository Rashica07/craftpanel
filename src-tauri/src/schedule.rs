//! Per-server automation: auto-restart on crash (bounded + backoff), a daily
//! restart with an in-game countdown, timed RCON commands, and a backup on stop.
//!
//! Config is JSON in the `settings` table under `schedule.<id>`. A single
//! background thread ticks every 15 s and acts on every server.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::adapter::ServerStatus;
use crate::db::Db;
use crate::process::ProcessManager;

const TICK: Duration = Duration::from_secs(15);
/// a crash counter resets after this long without a crash
const CRASH_WINDOW_SECS: i64 = 900;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Schedule {
    pub restart_on_crash: bool,
    /// give up after this many crash-restarts inside the window (default 3)
    pub max_crash_restarts: u32,
    /// "HH:MM" local — start the server once a day at this time, if it
    /// isn't already running. Pair with the app-level "stay awake on
    /// power" setting so the Mac is actually up to notice.
    pub scheduled_start: Option<String>,
    /// "HH:MM" local — restart once a day at this time
    pub daily_restart: Option<String>,
    /// seconds of in-game warning before the daily restart (default 60)
    pub restart_warning_secs: u32,
    pub timed_commands: Vec<TimedCommand>,
    /// take a backup (trigger = "scheduled") every time the server stops cleanly
    pub backup_on_stop: bool,
    /// also take a backup every N hours while the server is running, on top
    /// of (not instead of) `backup_on_stop` — a server that never stops
    /// otherwise never gets backed up. `None`/`0` = off.
    pub interval_backup_hours: Option<u32>,
    /// push every backup this schedule takes (either trigger) to R2, once
    /// it's uploaded locally. Silently skipped if R2 isn't configured —
    /// this is a bonus on top of local backups, never a hard requirement.
    pub cloud_backup: bool,
    /// minutes between automatic hardlink "Time Machine" snapshots while the
    /// server is running — cheap, frequent rollback points, distinct from
    /// the full zip `Backup`s above. `None`/`0` = off. Floored at 5 min.
    pub snapshot_interval_mins: Option<u32>,
    /// keep every snapshot from within this many hours (default 24 if unset/0)
    pub snapshot_keep_recent_hours: u32,
    /// beyond the recent window, thin to one snapshot per day for this many
    /// days (default 30 if unset/0)
    pub snapshot_keep_daily_days: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimedCommand {
    /// "HH:MM" local
    pub at: String,
    pub command: String,
}

impl Schedule {
    fn is_default(&self) -> bool {
        !self.restart_on_crash
            && self.scheduled_start.is_none()
            && self.daily_restart.is_none()
            && self.timed_commands.is_empty()
            && !self.backup_on_stop
            && self.interval_backup_hours.unwrap_or(0) == 0
            && !self.cloud_backup
            && self.snapshot_interval_mins.unwrap_or(0) == 0
    }
    fn max_restarts(&self) -> u32 {
        if self.max_crash_restarts == 0 { 3 } else { self.max_crash_restarts }
    }
    fn warning(&self) -> u32 {
        if self.restart_warning_secs == 0 { 60 } else { self.restart_warning_secs }
    }
    pub(crate) fn snapshot_recent_hours(&self) -> u32 {
        if self.snapshot_keep_recent_hours == 0 { 24 } else { self.snapshot_keep_recent_hours }
    }
    pub(crate) fn snapshot_daily_days(&self) -> u32 {
        if self.snapshot_keep_daily_days == 0 { 30 } else { self.snapshot_keep_daily_days }
    }
}

pub fn key(id: &str) -> String {
    format!("schedule.{id}")
}

pub fn read(db: &Db, id: &str) -> Schedule {
    db.get_setting(&key(id))
        .ok()
        .flatten()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn write(db: &Db, id: &str, sch: &Schedule) -> Result<(), String> {
    for tc in &sch.timed_commands {
        parse_hhmm(&tc.at).ok_or_else(|| format!("bad time '{}': use HH:MM", tc.at))?;
    }
    if let Some(t) = &sch.daily_restart {
        if !t.is_empty() {
            parse_hhmm(t).ok_or_else(|| format!("bad time '{t}': use HH:MM"))?;
        }
    }
    let json = serde_json::to_string(sch).map_err(|e| e.to_string())?;
    db.set_setting(&key(id), &json).map_err(|e| e.to_string())
}

fn parse_hhmm(s: &str) -> Option<(u8, u8)> {
    let (h, m) = s.trim().split_once(':')?;
    let h: u8 = h.parse().ok()?;
    let m: u8 = m.parse().ok()?;
    (h < 24 && m < 60).then_some((h, m))
}

// --- the engine ------------------------------------------------------------

#[derive(Default)]
struct DayState {
    /// yyyy-ordinal we last did the daily restart / each timed command
    daily_done: Option<i64>,
    /// yyyy-ordinal we last did the scheduled start
    start_done: Option<i64>,
    cmd_done: HashMap<String, i64>,
    /// crash-restart bookkeeping
    crash_count: u32,
    last_crash_seen: i64,
    /// we've already announced "gave up"
    gave_up: bool,
    /// daily-restart 1-minute warning already sent for this day-key
    warned: Option<i64>,
    /// last status we saw, to catch the running -> stopped transition
    last_status: Option<ServerStatus>,
    /// unix epoch of the last interval backup — 0 means "never" (also true
    /// right after an app restart, since this is in-memory only, same as
    /// every other tracker in this struct)
    last_interval_backup: i64,
    /// unix epoch of the last Time Machine snapshot — 0 means "never"
    last_snapshot: i64,
}

pub struct Scheduler {
    app: AppHandle,
    offset_secs: i32,
    state: Mutex<HashMap<String, DayState>>,
}

impl Scheduler {
    pub fn new(app: AppHandle, offset_secs: i32) -> std::sync::Arc<Self> {
        std::sync::Arc::new(Self { app, offset_secs, state: Mutex::new(HashMap::new()) })
    }

    pub fn start(self: std::sync::Arc<Self>) {
        std::thread::spawn(move || loop {
            std::thread::sleep(TICK);
            self.tick();
        });
    }

    fn now(&self) -> time::OffsetDateTime {
        let off = time::UtcOffset::from_whole_seconds(self.offset_secs)
            .unwrap_or(time::UtcOffset::UTC);
        time::OffsetDateTime::now_utc().to_offset(off)
    }

    /// minutes-since-midnight + a stable per-day key
    fn clock(&self) -> (i64, i64) {
        let n = self.now();
        let mins = n.hour() as i64 * 60 + n.minute() as i64;
        let day = n.to_julian_day() as i64;
        (mins, day)
    }

    fn console(&self, id: &str, msg: &str) {
        let _ = self.app.emit(
            "server:log",
            serde_json::json!({ "server_id": id, "seq": 0, "stream": "system",
                                "text": format!("[scheduler] {msg}") }),
        );
    }

    /// Take a local backup, prune locally, then — if `cloud_backup` is on
    /// and R2 is configured — push it and prune the remote index too.
    /// Runs on its own thread so a slow zip/upload never blocks the ticker.
    fn run_backup(&self, id: &str, dir: &str, trigger: &str, cloud_backup: bool) {
        let dir = dir.to_string();
        let id = id.to_string();
        let trigger = trigger.to_string();
        let app = self.app.clone();
        std::thread::spawn(move || {
            let p = std::path::Path::new(&dir);
            let keep = app
                .try_state::<Db>()
                .and_then(|db| db.get_setting("backups.keep").ok().flatten())
                .and_then(|s| s.parse::<usize>().ok())
                .unwrap_or(20);
            match crate::backups::backup_now(p, Some(&trigger), "scheduled", &|_| {}) {
                Ok(meta) => {
                    crate::backups::prune(p, keep);
                    let _ = app.emit(
                        "server:log",
                        serde_json::json!({ "server_id": id, "seq": 0, "stream": "system",
                            "text": "[scheduler] scheduled backup done" }),
                    );
                    if cloud_backup {
                        if let Some(cloud) = app.try_state::<std::sync::Arc<crate::cloud::CloudManager>>() {
                            if cloud.is_configured() {
                                match crate::backups::read_zip(p, &meta.id)
                                    .and_then(|bytes| cloud.push_backup(&id, &meta, &bytes, keep))
                                {
                                    Ok(()) => {
                                        let _ = app.emit(
                                            "server:log",
                                            serde_json::json!({ "server_id": id, "seq": 0, "stream": "system",
                                                "text": "[scheduler] pushed backup to the cloud" }),
                                        );
                                    }
                                    Err(e) => {
                                        let _ = app.emit(
                                            "server:log",
                                            serde_json::json!({ "server_id": id, "seq": 0, "stream": "system",
                                                "text": format!("[scheduler] cloud backup push failed: {e}") }),
                                        );
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    let _ = app.emit(
                        "server:log",
                        serde_json::json!({ "server_id": id, "seq": 0, "stream": "system",
                            "text": format!("[scheduler] scheduled backup failed: {e}") }),
                    );
                    notify_discord_backup_failed(&app, &id);
                }
            }
        });
    }

    /// Take a hardlink "Time Machine" snapshot, wrapped in a best-effort
    /// save-off/save-all/save-on pair over stdin so it's less likely to
    /// catch a region file mid-write — same mechanism `timed_commands`/the
    /// daily-restart warning already use (raw stdin, not RCON). If the
    /// server doesn't respond in time the snapshot still runs; this is
    /// strictly an improvement over the zip backups above, which don't
    /// coordinate saves at all, never a regression. Own thread, same
    /// reasoning as `run_backup`.
    fn run_snapshot(&self, id: &str, dir: &str, keep_recent_hours: u32, keep_daily_days: u32) {
        let dir_s = dir.to_string();
        let id = id.to_string();
        let app = self.app.clone();
        std::thread::spawn(move || {
            let p = std::path::Path::new(&dir_s);
            if let Some(procs) = app.try_state::<ProcessManager>() {
                let _ = procs.write_stdin(&id, "save-off");
                let _ = procs.write_stdin(&id, "save-all flush");
            }
            std::thread::sleep(Duration::from_millis(1500));
            let result = crate::snapshots::snapshot_now(p, "scheduled", &|_| {});
            if let Some(procs) = app.try_state::<ProcessManager>() {
                let _ = procs.write_stdin(&id, "save-on");
            }
            match result {
                Ok(_) => {
                    crate::snapshots::prune(p, keep_recent_hours, keep_daily_days);
                    let _ = app.emit(
                        "server:log",
                        serde_json::json!({ "server_id": id, "seq": 0, "stream": "system",
                            "text": "[scheduler] snapshot taken" }),
                    );
                }
                Err(e) => {
                    let _ = app.emit(
                        "server:log",
                        serde_json::json!({ "server_id": id, "seq": 0, "stream": "system",
                            "text": format!("[scheduler] snapshot failed: {e}") }),
                    );
                    notify_discord_snapshot_failed(&app, &id);
                }
            }
        });
    }

    fn tick(&self) {
        let Some(db) = self.app.try_state::<Db>() else { return };
        let Some(procs) = self.app.try_state::<ProcessManager>() else { return };
        let Ok(servers) = db.list_servers() else { return };
        let (mins, day) = self.clock();
        let now_epoch = time::OffsetDateTime::now_utc().unix_timestamp();

        for rec in servers {
            let sch = read(&db, &rec.id);
            if sch.is_default() {
                continue;
            }
            let snap = procs.snapshot(&rec.id);
            let mut st = self.state.lock().unwrap();
            let ds = st.entry(rec.id.clone()).or_default();

            // --- backup on stop (running/stopping -> stopped) ---
            let prev = ds.last_status.replace(snap.status);
            if sch.backup_on_stop
                && matches!(prev, Some(ServerStatus::Running) | Some(ServerStatus::Stopping))
                && snap.status == ServerStatus::Stopped
            {
                drop(st);
                self.console(&rec.id, "server stopped — taking a scheduled backup");
                self.run_backup(&rec.id, &rec.path, "on stop", sch.cloud_backup);
                continue;
            }

            // --- crash auto-restart ---
            if sch.restart_on_crash && snap.status == ServerStatus::Crashed {
                if now_epoch - ds.last_crash_seen > CRASH_WINDOW_SECS {
                    ds.crash_count = 0;
                    ds.gave_up = false;
                }
                // only act once per crash: last_crash_seen far in the past
                if now_epoch - ds.last_crash_seen > 5 {
                    ds.last_crash_seen = now_epoch;
                    if ds.crash_count < sch.max_restarts() {
                        ds.crash_count += 1;
                        let n = ds.crash_count;
                        let max = sch.max_restarts();
                        drop(st);
                        self.console(&rec.id, &format!("server crashed — restarting ({n}/{max})"));
                        std::thread::sleep(Duration::from_secs((5 * n as u64).min(60)));
                        if let Err(e) = procs.start(&rec) {
                            self.console(&rec.id, &format!("auto-restart failed: {e}"));
                        }
                        continue;
                    } else if !ds.gave_up {
                        ds.gave_up = true;
                        drop(st);
                        self.console(
                            &rec.id,
                            &format!(
                                "server crashed {} times in 15 min — auto-restart disabled until it starts cleanly",
                                sch.max_restarts()
                            ),
                        );
                        continue;
                    }
                }
            }

            let running = matches!(
                snap.status,
                ServerStatus::Running | ServerStatus::Starting
            );

            // --- scheduled start (only when it isn't already up) ---
            if !running {
                if let Some((h, m)) = sch.scheduled_start.as_deref().and_then(parse_hhmm) {
                    let target = h as i64 * 60 + m as i64;
                    if mins >= target && mins < target + 2 && ds.start_done != Some(day) {
                        ds.start_done = Some(day);
                        drop(st);
                        self.console(&rec.id, "scheduled start");
                        if let Err(e) = procs.start(&rec) {
                            self.console(&rec.id, &format!("scheduled start failed: {e}"));
                        }
                        continue;
                    }
                }
            }

            // --- interval backup (independent of backup_on_stop) ---
            if running {
                if let Some(hours) = sch.interval_backup_hours.filter(|h| *h > 0) {
                    let interval_secs = hours as i64 * 3600;
                    if now_epoch - ds.last_interval_backup >= interval_secs {
                        ds.last_interval_backup = now_epoch;
                        drop(st);
                        self.console(&rec.id, &format!("scheduled backup (every {hours}h)"));
                        self.run_backup(&rec.id, &rec.path, "scheduled", sch.cloud_backup);
                        continue;
                    }
                }
            }

            // --- Time Machine snapshot (independent of the zip backups above) ---
            if running {
                if let Some(mins) = sch.snapshot_interval_mins.filter(|m| *m > 0) {
                    let interval_secs = mins.max(5) as i64 * 60;
                    if now_epoch - ds.last_snapshot >= interval_secs {
                        ds.last_snapshot = now_epoch;
                        drop(st);
                        self.run_snapshot(
                            &rec.id,
                            &rec.path,
                            sch.snapshot_recent_hours(),
                            sch.snapshot_daily_days(),
                        );
                        continue;
                    }
                }
            }

            // --- daily restart with countdown ---
            if running {
                if let Some((h, m)) = sch.daily_restart.as_deref().and_then(parse_hhmm) {
                    let target = h as i64 * 60 + m as i64;
                    let warn_min = target - (sch.warning() as i64 + 59) / 60;
                    if mins >= warn_min && mins < target && ds.warned != Some(day) {
                        ds.warned = Some(day);
                        drop(st);
                        let _ = procs.write_stdin(
                            &rec.id,
                            &format!("say Scheduled restart in ~{} min", (target - mins).max(1)),
                        );
                        continue;
                    } else if mins >= target && mins < target + 3 && ds.daily_done != Some(day) {
                        ds.daily_done = Some(day);
                        drop(st);
                        self.console(&rec.id, "daily scheduled restart");
                        let _ = procs.write_stdin(&rec.id, "say Restarting now — back in a moment");
                        std::thread::sleep(Duration::from_secs(3));
                        let _ = procs.stop(&rec.id);
                        // wait for it to go down, then bring it back
                        for _ in 0..120 {
                            std::thread::sleep(Duration::from_millis(500));
                            if !procs.is_running(&rec.id) {
                                break;
                            }
                        }
                        let _ = procs.start(&rec);
                        continue;
                    }
                }

                // --- timed commands ---
                for tc in &sch.timed_commands {
                    if let Some((h, m)) = parse_hhmm(&tc.at) {
                        let at = h as i64 * 60 + m as i64;
                        if mins >= at && mins < at + 2 && ds.cmd_done.get(&tc.at) != Some(&day) {
                            ds.cmd_done.insert(tc.at.clone(), day);
                            let cmd = tc.command.clone();
                            drop(st);
                            let _ = procs.write_stdin(&rec.id, &cmd);
                            self.console(&rec.id, &format!("ran timed command: {cmd}"));
                            break;
                        }
                    }
                }
            }
        }
    }
}

/// Only called on backup *failure* — a daily/hourly "backup done" ping for
/// every server gets old fast and trains people to ignore the channel.
/// Failure is rare and actually worth knowing about away from the app.
fn notify_discord_backup_failed(app: &AppHandle, server_id: &str) {
    let Some(db) = app.try_state::<Db>() else { return };
    let url = crate::commands::read_app_settings(&db).discord_webhook_url;
    let url = url.trim();
    if url.is_empty() {
        return;
    }
    let name = db
        .get_server(server_id)
        .ok()
        .flatten()
        .map(|r| r.name)
        .unwrap_or_else(|| server_id.to_string());
    crate::discord::notify(url, format!("🟠 **{name}** scheduled backup failed — check the console."));
}

/// Same reasoning as `notify_discord_backup_failed` — only pings on
/// failure, snapshots are frequent enough that a success ping would be noise.
fn notify_discord_snapshot_failed(app: &AppHandle, server_id: &str) {
    let Some(db) = app.try_state::<Db>() else { return };
    let url = crate::commands::read_app_settings(&db).discord_webhook_url;
    let url = url.trim();
    if url.is_empty() {
        return;
    }
    let name = db
        .get_server(server_id)
        .ok()
        .flatten()
        .map(|r| r.name)
        .unwrap_or_else(|| server_id.to_string());
    crate::discord::notify(url, format!("🟠 **{name}** scheduled snapshot failed — check the console."));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_default_accounts_for_the_new_backup_fields() {
        assert!(Schedule::default().is_default());
        assert!(!Schedule { interval_backup_hours: Some(6), ..Default::default() }.is_default());
        assert!(!Schedule { cloud_backup: true, ..Default::default() }.is_default());
        assert!(!Schedule { scheduled_start: Some("06:00".into()), ..Default::default() }.is_default());
        // 0 hours is the same as "off", same as None
        assert!(Schedule { interval_backup_hours: Some(0), ..Default::default() }.is_default());
        assert!(!Schedule { snapshot_interval_mins: Some(15), ..Default::default() }.is_default());
        assert!(Schedule { snapshot_interval_mins: Some(0), ..Default::default() }.is_default());
    }

    #[test]
    fn snapshot_retention_defaults_apply_only_when_unset() {
        let s = Schedule::default();
        assert_eq!(s.snapshot_recent_hours(), 24);
        assert_eq!(s.snapshot_daily_days(), 30);
        let s = Schedule { snapshot_keep_recent_hours: 6, snapshot_keep_daily_days: 7, ..Default::default() };
        assert_eq!(s.snapshot_recent_hours(), 6);
        assert_eq!(s.snapshot_daily_days(), 7);
    }

    #[test]
    fn parses_times() {
        assert_eq!(parse_hhmm("04:00"), Some((4, 0)));
        assert_eq!(parse_hhmm("23:59"), Some((23, 59)));
        assert_eq!(parse_hhmm("24:00"), None);
        assert_eq!(parse_hhmm("4:5"), Some((4, 5)));
        assert_eq!(parse_hhmm("nope"), None);
    }

    #[test]
    fn schedule_json_roundtrips_and_validates() {
        let file = std::env::temp_dir().join(format!("cp-sch-{:?}.db", std::thread::current().id()));
        let _ = std::fs::remove_file(&file);
        let db = Db::open(&file).unwrap();

        let mut s = Schedule {
            restart_on_crash: true,
            daily_restart: Some("04:30".into()),
            backup_on_stop: true,
            interval_backup_hours: Some(12),
            cloud_backup: true,
            timed_commands: vec![TimedCommand { at: "03:00".into(), command: "save-all".into() }],
            ..Default::default()
        };
        write(&db, "srv1", &s).unwrap();
        let back = read(&db, "srv1");
        assert!(back.restart_on_crash);
        assert_eq!(back.daily_restart.as_deref(), Some("04:30"));
        assert_eq!(back.timed_commands.len(), 1);
        assert_eq!(back.interval_backup_hours, Some(12));
        assert!(back.cloud_backup);

        s.daily_restart = Some("99:99".into());
        assert!(write(&db, "srv1", &s).is_err());

        assert!(read(&db, "never-set").is_default());
        let _ = std::fs::remove_file(&file);
    }
}
