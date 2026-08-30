//! Live health: the JVM's RAM + CPU, and TPS / MSPT pulled over RCON.
//!
//! TPS isn't in vanilla RCON, so we try a sequence of commands and parse
//! whichever the server understands: `/tick query` (vanilla 1.21+),
//! `/tps` (Paper/Purpur/Spigot), `/spark tps`, `/forge tps`.

use std::time::Duration;

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

pub fn process_sample(pid: u32) -> (Option<u32>, Option<f32>) {
    let mut sys = System::new();
    let p = Pid::from_u32(pid);
    sys.refresh_processes(ProcessesToUpdate::Some(&[p]), true);
    std::thread::sleep(Duration::from_millis(220));
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
}
