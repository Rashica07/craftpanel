//! Premium: performance alerts. Piggybacks on `metrics_history.rs`'s
//! existing once-a-minute sample rather than running its own poller —
//! every sample already has exactly what's needed (RAM, TPS), so this is
//! just "does this one look bad," plus a per-condition cooldown so a
//! server stuck over a threshold doesn't fire a fresh alert every minute.
//!
//! Delivery is a dedicated `premium:alert` event, not the existing
//! `server:log` stream — `server:log` only reaches you if that server's
//! console tab happens to be open (confirmed: `schedule.rs`'s own
//! crash/restart notices work exactly that way already), which defeats
//! the point of an *alert*. `App.tsx` listens globally and toasts it
//! regardless of which server or tab is in front.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use sysinfo::Disks;
use tauri::{AppHandle, Emitter};

use crate::db::ServerRecord;

const TPS_WARN: f32 = 15.0;
const RAM_WARN_FRACTION: f32 = 0.9;
/// Matches doctor.rs's own `MIN_FREE_GB` — same "this is getting tight"
/// bar, just checked continuously here instead of on-demand.
const DISK_WARN_GB: u64 = 2;
const COOLDOWN_SECS: i64 = 15 * 60;

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// One per app run, owned by `MetricsSampler` — tracks the last time each
/// (server, condition) pair fired, so a server that's been low on TPS for
/// an hour gets one alert every 15 minutes, not 60 of them.
#[derive(Default)]
pub struct AlertState {
    last_fired: Mutex<HashMap<(String, &'static str), i64>>,
}

impl AlertState {
    fn should_fire(&self, server_id: &str, kind: &'static str) -> bool {
        let mut m = self.last_fired.lock().unwrap();
        let key = (server_id.to_string(), kind);
        let t = now();
        let fire = m.get(&key).is_none_or(|last| t - last >= COOLDOWN_SECS);
        if fire {
            m.insert(key, t);
        }
        fire
    }
}

fn disk_free_gb(path: &Path) -> Option<u64> {
    let disks = Disks::new_with_refreshed_list();
    disks
        .iter()
        .filter(|d| path.starts_with(d.mount_point()))
        .max_by_key(|d| d.mount_point().as_os_str().len())
        .map(|d| d.available_space() / 1_073_741_824)
}

fn emit(app: &AppHandle, rec: &ServerRecord, kind: &str, message: String) {
    let _ = app.emit(
        "premium:alert",
        serde_json::json!({
            "serverId": rec.id,
            "serverName": rec.name,
            "kind": kind,
            "message": message,
        }),
    );
}

/// Call once per running server per metrics tick. The caller (only
/// `metrics_history.rs` today) is responsible for checking
/// `premium::is_active` first — this function doesn't gate itself, so a
/// unit test can exercise the threshold logic without a `Db` at all.
pub fn check(app: &AppHandle, state: &AlertState, rec: &ServerRecord, ram_mb: Option<u32>, tps: Option<f32>) {
    if let Some(t) = tps {
        if t < TPS_WARN && state.should_fire(&rec.id, "low_tps") {
            emit(app, rec, "lowTps", format!("{} — TPS dropped to {:.1}", rec.name, t));
        }
    }
    if let Some(mb) = ram_mb {
        if rec.ram_mb > 0 {
            let frac = mb as f32 / rec.ram_mb as f32;
            if frac > RAM_WARN_FRACTION && state.should_fire(&rec.id, "high_ram") {
                emit(
                    app,
                    rec,
                    "highRam",
                    format!("{} — using {:.0}% of its {} MB allocation", rec.name, frac * 100.0, rec.ram_mb),
                );
            }
        }
    }
    if let Some(gb) = disk_free_gb(Path::new(&rec.path)) {
        if gb < DISK_WARN_GB && state.should_fire(&rec.id, "low_disk") {
            emit(app, rec, "lowDisk", format!("{} — only {gb} GB free on disk", rec.name));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fires_once_then_respects_the_cooldown() {
        let state = AlertState::default();
        assert!(state.should_fire("srv1", "low_tps"), "first time should always fire");
        assert!(!state.should_fire("srv1", "low_tps"), "immediate repeat should be suppressed");
    }

    #[test]
    fn different_servers_and_kinds_dont_share_a_cooldown() {
        let state = AlertState::default();
        assert!(state.should_fire("srv1", "low_tps"));
        assert!(state.should_fire("srv2", "low_tps"), "different server, same kind");
        assert!(state.should_fire("srv1", "high_ram"), "same server, different kind");
    }
}
