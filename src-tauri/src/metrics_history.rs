//! Background sampler: once a minute, snapshots RAM/CPU/TPS for every
//! *running* server and appends a row to `metric_samples`, so a chart can
//! show usage over the last 24h/7d/30d — not just the live-right-now
//! numbers `perf.rs` already gives the console's health strip.
//!
//! Deliberately coarse: one sample per server every 60s, not more often —
//! a multi-day chart doesn't need per-second resolution, and each sample
//! does a real `sysinfo` refresh plus one blocking RCON round trip per
//! server, so this is a background thread actually doing work, not
//! something to run needlessly often (the exact complaint a much less
//! accurate critique made about a *different*, already-lightweight part of
//! this app a few batches ago).

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};

use crate::adapter::ServerStatus;
use crate::db::Db;
use crate::process::ProcessManager;
use crate::rcon::RconPool;

const TICK: Duration = Duration::from_secs(60);
/// 30 days of minute-resolution samples — pruned on every tick, not on a
/// separate schedule.
const RETENTION_SECS: i64 = 30 * 86_400;

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub struct MetricsSampler {
    app: AppHandle,
}

impl MetricsSampler {
    pub fn new(app: AppHandle) -> Arc<Self> {
        Arc::new(Self { app })
    }

    pub fn start(self: Arc<Self>) {
        std::thread::spawn(move || loop {
            std::thread::sleep(TICK);
            self.tick();
        });
    }

    fn tick(&self) {
        let Some(db) = self.app.try_state::<Db>() else { return };
        let Some(procs) = self.app.try_state::<ProcessManager>() else { return };
        let Some(pool) = self.app.try_state::<RconPool>() else { return };
        let Ok(servers) = db.list_servers() else { return };
        let ts = now();

        for rec in servers {
            let snap = procs.snapshot(&rec.id);
            if snap.status != ServerStatus::Running {
                continue;
            }
            let Some(pid) = snap.pid else { continue };

            let (ram_mb, cpu_pct) = crate::perf::process_sample(pid);
            // TPS is opt-in on this same tick, not a separate poller —
            // silently skipped (not an error) if RCON isn't set up, same
            // as the rest of this app treats an unconfigured RCON.
            let tps = crate::commands::rcon_with(&pool, &rec, |c| {
                Ok(crate::perf::tps_over_rcon(c).0)
            })
            .ok()
            .flatten();

            let _ = db.insert_metric_sample(&rec.id, ts, ram_mb, cpu_pct, tps);
        }

        let _ = db.prune_metric_samples(ts - RETENTION_SECS);
    }
}
