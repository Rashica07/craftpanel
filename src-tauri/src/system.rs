//! Host system facts the UI needs — currently just memory, for the RAM slider.

use serde::Serialize;
use sysinfo::System;

#[derive(Debug, Clone, Serialize)]
pub struct SystemInfo {
    /// Total physical RAM in megabytes.
    pub total_ram_mb: u32,
    /// Currently available RAM in megabytes.
    pub available_ram_mb: u32,
    /// A sane upper bound to offer on the allocation slider: leave headroom for
    /// the OS and everything else (75% of total, capped 1 GB below total).
    pub suggested_max_mb: u32,
    pub cpu_count: u32,
}

pub fn info() -> SystemInfo {
    let mut sys = System::new();
    sys.refresh_memory();

    let total_mb = (sys.total_memory() / 1024 / 1024) as u32;
    let avail_mb = (sys.available_memory() / 1024 / 1024) as u32;

    let three_quarters = (total_mb as f64 * 0.75) as u32;
    let leave_1gb = total_mb.saturating_sub(1024);
    let suggested = three_quarters.min(leave_1gb).max(1024);

    SystemInfo {
        total_ram_mb: total_mb,
        available_ram_mb: avail_mb,
        suggested_max_mb: suggested,
        cpu_count: std::thread::available_parallelism()
            .map(|n| n.get() as u32)
            .unwrap_or(1),
    }
}
