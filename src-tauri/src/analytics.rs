//! Player history from the server logs — first/last seen, session count, total
//! playtime, last IP. Offline-mode safe: everything is keyed on the **name**.
//!
//! Parses `logs/latest.log` plus rotated `logs/YYYY-MM-DD-N.log[.gz]`. Line
//! timestamps are only `HH:MM:SS`, so the date comes from the filename (or the
//! file mtime for `latest.log`), rolling forward when the clock wraps midnight.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerStat {
    pub name: String,
    pub first_seen: i64,
    pub last_seen: i64,
    pub sessions: u32,
    pub total_secs: i64,
    pub last_ip: Option<String>,
    pub online: bool,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Days since the Unix epoch for a civil date (Howard Hinnant's algorithm).
fn civil_to_days(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

struct LogSrc {
    /// sort key (older first)
    order: (i64, i64),
    base_epoch: i64,
    gz: bool,
    path: std::path::PathBuf,
}

fn collect_sources(logs: &Path) -> Vec<LogSrc> {
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(logs) else {
        return out;
    };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let path = e.path();
        if name == "latest.log" {
            let base = e
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| (d.as_secs() as i64 / 86400) * 86400)
                .unwrap_or_else(|| (now() / 86400) * 86400);
            out.push(LogSrc { order: (i64::MAX, 0), base_epoch: base, gz: false, path });
            continue;
        }
        // YYYY-MM-DD-N.log or .log.gz
        let stem = name.trim_end_matches(".gz").trim_end_matches(".log");
        let parts: Vec<&str> = stem.split('-').collect();
        if parts.len() == 4 {
            if let (Ok(y), Ok(mo), Ok(d), Ok(n)) = (
                parts[0].parse::<i64>(),
                parts[1].parse::<i64>(),
                parts[2].parse::<i64>(),
                parts[3].parse::<i64>(),
            ) {
                let base = civil_to_days(y, mo, d) * 86400;
                out.push(LogSrc {
                    order: (base, n),
                    base_epoch: base,
                    gz: name.ends_with(".gz"),
                    path,
                });
            }
        }
    }
    out.sort_by_key(|s| s.order);
    out
}

fn read_text(src: &LogSrc) -> Option<String> {
    let bytes = fs::read(&src.path).ok()?;
    if src.gz {
        let mut s = String::new();
        flate2::read::GzDecoder::new(&bytes[..]).read_to_string(&mut s).ok()?;
        Some(s)
    } else {
        Some(String::from_utf8_lossy(&bytes).into_owned())
    }
}

fn valid_name(n: &str) -> bool {
    !n.is_empty() && n.len() <= 16 && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

fn hms(line: &str) -> Option<i64> {
    // "[HH:MM:SS] ..."
    let b = line.as_bytes();
    if b.len() < 10 || b[0] != b'[' || b[9] != b']' {
        return None;
    }
    let h: i64 = line.get(1..3)?.parse().ok()?;
    let m: i64 = line.get(4..6)?.parse().ok()?;
    let s: i64 = line.get(7..9)?.parse().ok()?;
    Some(h * 3600 + m * 60 + s)
}

#[derive(Default)]
struct Acc {
    first: i64,
    last: i64,
    sessions: u32,
    total: i64,
    ip: Option<String>,
}

pub fn player_history(server_dir: &str, server_online: bool) -> Vec<PlayerStat> {
    let logs = Path::new(server_dir).join("logs");
    let mut stats: HashMap<String, Acc> = HashMap::new();
    let mut open: HashMap<String, i64> = HashMap::new(); // name -> join epoch
    let mut pending_ip: HashMap<String, String> = HashMap::new();

    for src in collect_sources(&logs) {
        let Some(text) = read_text(&src) else { continue };
        let mut day = 0i64;
        let mut prev_secs = -1i64;

        for line in text.lines() {
            let Some(secs) = hms(line) else { continue };
            if prev_secs >= 0 && secs + 3600 < prev_secs {
                day += 1; // clock wrapped past midnight in this file
            }
            prev_secs = secs;
            let ts = src.base_epoch + day * 86400 + secs;

            let Some(rest) = line.split("]: ").nth(1) else { continue };

            if let Some(name) = rest.strip_suffix(" joined the game") {
                if !valid_name(name) {
                    continue;
                }
                open.insert(name.to_string(), ts);
                let a = stats.entry(name.to_string()).or_default();
                if a.first == 0 {
                    a.first = ts;
                }
                a.last = a.last.max(ts);
                if let Some(ip) = pending_ip.remove(name) {
                    a.ip = Some(ip);
                }
            } else if let Some(name) = rest.strip_suffix(" left the game") {
                if !valid_name(name) {
                    continue;
                }
                let a = stats.entry(name.to_string()).or_default();
                if let Some(joined) = open.remove(name) {
                    a.total += (ts - joined).max(0);
                    a.sessions += 1;
                }
                a.last = a.last.max(ts);
                if a.first == 0 {
                    a.first = ts;
                }
            } else if let Some(idx) = rest.find("[/") {
                // "<name>[/1.2.3.4:5678] logged in with ..."
                if !rest.contains(" logged in with ") {
                    continue;
                }
                let name = &rest[..idx];
                if !valid_name(name) {
                    continue;
                }
                if let Some(end) = rest[idx + 2..].find(']') {
                    let addr = &rest[idx + 2..idx + 2 + end];
                    let ip = addr.rsplit_once(':').map(|(h, _)| h).unwrap_or(addr);
                    pending_ip.insert(name.to_string(), ip.to_string());
                }
            }
        }
    }

    // sessions still open at the end of the logs
    let still_open: std::collections::HashSet<String> = open.keys().cloned().collect();
    for (name, joined) in open {
        let a = stats.entry(name).or_default();
        let end = if server_online { now() } else { a.last.max(joined) };
        a.total += (end - joined).max(0);
        a.sessions += 1;
        a.last = a.last.max(end);
    }

    let mut out: Vec<PlayerStat> = stats
        .into_iter()
        .map(|(name, a)| PlayerStat {
            online: server_online && still_open.contains(&name),
            name,
            first_seen: a.first,
            last_seen: a.last,
            sessions: a.sessions,
            total_secs: a.total,
            last_ip: a.ip,
        })
        .collect();
    out.sort_by(|a, b| b.last_seen.cmp(&a.last_seen));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_srv(tag: &str, latest: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("cp-an-{tag}-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("logs")).unwrap();
        fs::write(d.join("logs/latest.log"), latest).unwrap();
        d
    }

    #[test]
    fn civil_epoch_matches_known_dates() {
        assert_eq!(civil_to_days(1970, 1, 1), 0);
        assert_eq!(civil_to_days(2000, 1, 1), 10_957); // well-known
        assert_eq!(civil_to_days(2001, 1, 1), 11_323);
    }

    #[test]
    fn parses_sessions_and_ip() {
        let log = "\
[10:00:00] [Server thread/INFO]: Steve[/1.2.3.4:5555] logged in with entity id 1 at (0,0,0)
[10:00:01] [Server thread/INFO]: Steve joined the game
[10:30:01] [Server thread/INFO]: Steve left the game
[11:00:00] [Server thread/INFO]: Alex joined the game
";
        let d = write_srv("basic", log);
        let h = player_history(&d.to_string_lossy(), false);
        let steve = h.iter().find(|p| p.name == "Steve").unwrap();
        assert_eq!(steve.sessions, 1);
        assert_eq!(steve.total_secs, 1800);
        assert_eq!(steve.last_ip.as_deref(), Some("1.2.3.4"));
        // Alex never left; server offline -> session closed at join, 0s but counted
        let alex = h.iter().find(|p| p.name == "Alex").unwrap();
        assert_eq!(alex.sessions, 1);
        // ordering: Alex (11:00) after Steve (10:30) -> Alex first
        assert_eq!(h[0].name, "Alex");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn reads_rotated_gzip_across_two_files() {
        use flate2::{write::GzEncoder, Compression};
        use std::io::Write;
        let d = write_srv("rot", "");
        let gz = |body: &str| {
            let mut e = GzEncoder::new(Vec::new(), Compression::fast());
            e.write_all(body.as_bytes()).unwrap();
            e.finish().unwrap()
        };
        fs::write(
            d.join("logs/2026-08-29-1.log.gz"),
            gz("[08:00:00] [Server thread/INFO]: Bob joined the game\n"),
        )
        .unwrap();
        fs::write(
            d.join("logs/2026-08-29-2.log.gz"),
            gz("[09:00:00] [Server thread/INFO]: Bob left the game\n"),
        )
        .unwrap();

        let h = player_history(&d.to_string_lossy(), false);
        let bob = h.iter().find(|p| p.name == "Bob").unwrap();
        assert_eq!(bob.sessions, 1);
        assert_eq!(bob.total_secs, 3600);
        let _ = fs::remove_dir_all(&d);
    }

    /// `CP_TEST_SERVER=~/Documents/MCServ cargo test real_logs -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn real_logs() {
        let s = std::env::var("CP_TEST_SERVER").expect("set CP_TEST_SERVER");
        let h = player_history(&s, false);
        println!("{} players", h.len());
        for p in h.iter().take(15) {
            println!(
                "  {:16} sessions={:<3} played={:>6}s last_ip={:?} first={} last={}",
                p.name, p.sessions, p.total_secs, p.last_ip, p.first_seen, p.last_seen
            );
        }
        assert!(!h.is_empty());
        assert!(h.iter().all(|p| p.first_seen > 0 && p.last_seen >= p.first_seen));
    }

    #[test]
    fn ignores_non_player_lines() {
        let log = "[10:00:00] [Server thread/INFO]: Preparing spawn area joined the game\n";
        let d = write_srv("noise", log);
        let h = player_history(&d.to_string_lossy(), false);
        assert!(h.iter().all(|p| p.name != "Preparing spawn area"));
        let _ = fs::remove_dir_all(&d);
    }
}
