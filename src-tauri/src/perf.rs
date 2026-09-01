//! Live health: the JVM's RAM + CPU, and TPS / MSPT pulled over RCON.
//!
//! TPS isn't in vanilla RCON, so we try a sequence of commands and parse
//! whichever the server understands: `/tick query` (vanilla 1.21+),
//! `/tps` (Paper/Purpur/Spigot), `/spark tps`, `/forge tps`.

use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use sysinfo::{Pid, ProcessesToUpdate, System};

use crate::rcon::RconClient;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PerfSample {
    /// resident memory of the server JVM, MB
    pub ram_mb: Option<u32>,
    /// CPU usage of the JVM, percent (can exceed 100 on multi-core)
    pub cpu_pct: Option<f32>,
    /// ticks per second (20 is perfect)
    pub tps: Option<f32>,
    /// milliseconds per tick (< 50 is healthy)
    pub mspt: Option<f32>,
    /// where tps/mspt came from, for the UI
    pub source: Option<String>,
}

/// One `System` shared across every call, for the lifetime of the app.
///
/// A single `System::new()` per call (as this used to do, sleeping ~220ms
/// between two refreshes inside the same call) reliably reported CPU as a
/// flat 0% on macOS — confirmed by reading sysinfo 0.32's actual macOS
/// source: a process's `old_stime`/`old_utime` (its previous CPU-time
/// baseline) start at 0 when the process is first seen by a `System`, and
/// only get seeded with a real value the *next* time it's refreshed —
/// meaning `compute_cpu_usage`'s "do we have a real baseline yet?" check
/// still fails on that second call, and a fresh `System` per call means
/// every single call *is* that process's first and second appearance.
/// Real percentages only ever showed up on a third refresh in testing.
///
/// Keeping one `System` alive across calls fixes this properly instead of
/// papering over it with a third in-call sleep: whatever pid a caller asks
/// about builds up a real baseline across normal poll cycles (this is
/// already polled every few seconds by the frontend), and each call here
/// does one refresh with no blocking sleep at all. The trade a caller makes
/// is that the very first read of a pid this app has never sampled before
/// legitimately comes back as 0% — expected sysinfo behavior, not a bug,
/// and it self-corrects on the next poll a few seconds later.
fn shared_system() -> &'static Mutex<System> {
    static SYS: OnceLock<Mutex<System>> = OnceLock::new();
    SYS.get_or_init(|| Mutex::new(System::new()))
}

pub fn process_sample(pid: u32) -> (Option<u32>, Option<f32>) {
    let p = Pid::from_u32(pid);
    let mut sys = shared_system().lock().unwrap_or_else(|e| e.into_inner());
    sys.refresh_processes(ProcessesToUpdate::Some(&[p]), true);
    match sys.process(p) {
        Some(proc) => (
            Some((proc.memory() / 1024 / 1024) as u32),
            Some(proc.cpu_usage()),
        ),
        None => (None, None),
    }
}

/// First run of digits/./- in the string parsed as f32 ("2.5ms" -> 2.5).
fn first_num(s: &str) -> Option<f32> {
    let mut tok = String::new();
    for c in s.chars() {
        if c.is_ascii_digit() || c == '.' || (c == '-' && tok.is_empty()) {
            tok.push(c);
        } else if !tok.is_empty() {
            break;
        }
    }
    tok.trim_matches('.').parse().ok()
}

/// number after the first ':' — for "TPS ... 1m, 5m, 15m: 19.98, 20, 20"
fn num_after_colon(s: &str) -> Option<f32> {
    s.split_once(':').and_then(|(_, r)| first_num(r))
}

pub fn tps_over_rcon(client: &mut RconClient) -> (Option<f32>, Option<f32>, Option<String>) {
    // vanilla 1.21+: "Target tick rate: 20.0 per second.\nAverage time per tick: 1.2ms ..."
    if let Ok(out) = client.command("tick query") {
        let l = out.to_ascii_lowercase();
        if l.contains("tick rate") || l.contains("per tick") {
            let mspt = out
                .lines()
                .find(|x| x.to_ascii_lowercase().contains("per tick"))
                .and_then(num_after_colon);
            let tps = out
                .lines()
                .find(|x| x.to_ascii_lowercase().contains("tick rate"))
                .and_then(num_after_colon)
                .or_else(|| mspt.map(|m| (1000.0 / m).min(20.0)));
            if tps.is_some() || mspt.is_some() {
                return (tps, mspt, Some("vanilla /tick".into()));
            }
        }
    }
    // Paper / Purpur / Spigot: "TPS from last 1m, 5m, 15m: *20.0, 20.0, 20.0"
    if let Ok(out) = client.command("tps") {
        if out.to_ascii_lowercase().contains("tps") {
            let tps = num_after_colon(&strip_color(&out));
            let mspt = client
                .command("mspt")
                .ok()
                .and_then(|m| num_after_colon(&strip_color(&m)).or_else(|| first_num(&strip_color(&m))));
            if tps.is_some() {
                return (tps, mspt, Some("/tps".into()));
            }
        }
    }
    // spark: "TPS from last 5s, 10s, 1m, 5m, 15m:  20, 20, 20, 20, 20"
    if let Ok(out) = client.command("spark tps") {
        if out.to_ascii_lowercase().contains("tps") {
            let tps = num_after_colon(&strip_color(&out));
            if tps.is_some() {
                return (tps, None, Some("spark".into()));
            }
        }
    }
    (None, None, None)
}

fn strip_color(s: &str) -> String {
    // Minecraft § colour codes
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\u{a7}' {
            chars.next();
        } else {
            out.push(c);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn parses_vanilla_tick_output() {
        let out = "Target tick rate: 20.0 per second.\nAverage time per tick: 2.5ms (Target: 50.0ms)";
        let mspt = out
            .lines()
            .find(|x| x.contains("per tick"))
            .and_then(num_after_colon);
        assert_eq!(mspt, Some(2.5));
        let tps = out
            .lines()
            .find(|x| x.contains("tick rate"))
            .and_then(num_after_colon);
        assert_eq!(tps, Some(20.0));
    }

    #[test]
    fn parses_paper_tps_line() {
        let out = "§6TPS from last 1m, 5m, 15m: §a19.98, §a20.0, §a20.0";
        assert_eq!(num_after_colon(&strip_color(out)), Some(19.98));
    }

    #[test]
    fn own_process_reports_memory() {
        let (ram, _cpu) = process_sample(std::process::id());
        assert!(ram.map(|m| m > 0).unwrap_or(false));
    }

    /// The real macOS bug this session found and fixed: a process this
    /// app has never sampled before legitimately reads 0% CPU on its
    /// *first* sample (sysinfo has no prior baseline for it yet) — but a
    /// second sample, once it's had real CPU time to measure a delta
    /// against, must show a real, nonzero value for a genuinely busy
    /// process. The old implementation (`System::new()` + two refreshes
    /// inside one call) failed this — it needed a third refresh before
    /// ever showing anything but 0, confirmed by reading sysinfo's own
    /// macOS source. `process_sample` now shares one `System` across
    /// calls specifically so the *second* real call already works.
    #[test]
    fn second_sample_of_a_busy_process_is_nonzero() {
        let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stop2 = stop.clone();
        let handle = std::thread::spawn(move || {
            let mut x: u64 = 0;
            while !stop2.load(std::sync::atomic::Ordering::Relaxed) {
                x = x.wrapping_add(1).wrapping_mul(3);
            }
            x
        });

        let pid = std::process::id();
        let (_, first) = process_sample(pid); // cold start — allowed to be 0
        std::thread::sleep(Duration::from_millis(250));
        let (_, second) = process_sample(pid);

        stop.store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = handle.join();

        let _ = first;
        assert!(
            second.unwrap_or(0.0) > 1.0,
            "expected real cpu usage on the second sample of a busy process, got {:?}",
            second
        );
    }
}
