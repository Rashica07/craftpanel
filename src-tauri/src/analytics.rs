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

/// One time bucket's concurrent-player count — for a "peak hours" chart.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConcurrentPoint {
    /// bucket start, unix epoch
    pub ts: i64,
    pub count: u32,
}

/// Bucketed concurrent-player counts from `since` to now. Reuses the exact
/// same log sources and join/leave parsing as `player_history` — just
/// aggregated as open intervals instead of per-player totals, since the
/// underlying data (Minecraft's own rotated logs) is identical either way.
pub fn concurrent_series(
    server_dir: &str,
    server_online: bool,
    since: i64,
    bucket_secs: i64,
) -> Vec<ConcurrentPoint> {
    if bucket_secs <= 0 {
        return Vec::new();
    }
    // Coarsen automatically rather than trust the caller's bucket size —
    // `since = 0` with a small bucket would otherwise mean iterating
    // millions of empty buckets between the Unix epoch and now.
    let end = now();
    let bucket_secs = {
        let span = (end - since).max(bucket_secs);
        const MAX_BUCKETS: i64 = 3000;
        if span / bucket_secs > MAX_BUCKETS { span / MAX_BUCKETS + 1 } else { bucket_secs }
    };
    let logs = Path::new(server_dir).join("logs");
    let mut open: HashMap<String, i64> = HashMap::new();
    let mut intervals: Vec<(i64, i64)> = Vec::new();
    let mut last_line_ts = 0i64;

    for src in collect_sources(&logs) {
        let Some(text) = read_text(&src) else { continue };
        let mut day = 0i64;
        let mut prev_secs = -1i64;
        for line in text.lines() {
            let Some(secs) = hms(line) else { continue };
            if prev_secs >= 0 && secs + 3600 < prev_secs {
                day += 1;
            }
            prev_secs = secs;
            let ts = src.base_epoch + day * 86400 + secs;
            last_line_ts = last_line_ts.max(ts);
            let Some(rest) = line.split("]: ").nth(1) else { continue };
            if let Some(name) = rest.strip_suffix(" joined the game") {
                if valid_name(name) {
                    open.insert(name.to_string(), ts);
                }
            } else if let Some(name) = rest.strip_suffix(" left the game") {
                if valid_name(name) {
                    if let Some(joined) = open.remove(name) {
                        intervals.push((joined, ts));
                    }
                }
            }
        }
    }
    // Sessions still "open" (no "left the game" line) at the end of the
    // logs: if the server's actually running right now, they're genuinely
    // still online — count them through `now`. Otherwise this is almost
    // certainly an ungraceful shutdown; count them only through the last
    // timestamp actually seen in the logs, same as `player_history` does.
    let tail = if server_online { end } else { last_line_ts };
    for (_, joined) in open {
        intervals.push((joined, tail.max(joined)));
    }

    bucketize(&intervals, since, end, bucket_secs)
}

/// The pure part of `concurrent_series`: how many `[join, leave)` intervals
/// overlap each bucket from `start` (rounded down to a bucket boundary) to
/// `end`. Split out specifically so this can be tested with plain
/// synthetic epoch numbers — no wall clock, no log parsing, so it can't be
/// flaky around a UTC day boundary the way anchoring a test to a fixed
/// clock-time log line would be.
fn bucketize(intervals: &[(i64, i64)], since: i64, end: i64, bucket_secs: i64) -> Vec<ConcurrentPoint> {
    let start = (since / bucket_secs) * bucket_secs;
    let mut out = Vec::new();
    let mut t = start;
    while t <= end {
        let bucket_end = t + bucket_secs;
        let count = intervals
            .iter()
            .filter(|(j, l)| *j < bucket_end && *l > t)
            .count() as u32;
        out.push(ConcurrentPoint { ts: t, count });
        t = bucket_end;
    }
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
    fn bucketize_counts_overlapping_intervals() {
        // Alice [0,3600), Bob [1800,10800), Charlie [8100,9900) — plain
        // synthetic epoch seconds, no wall clock involved, so this can't be
        // flaky around a UTC day boundary the way anchoring to a fixed
        // clock-time log line would be.
        let intervals = vec![(0i64, 3600i64), (1800, 10800), (8100, 9900)];
        let points = bucketize(&intervals, 0, 10800, 3600);
        assert_eq!(points.len(), 4, "buckets at 0, 3600, 7200, 10800");
        assert_eq!(points[0].count, 2, "[0,3600): Alice + Bob overlap");
        assert_eq!(points[1].count, 1, "[3600,7200): only Bob");
        assert_eq!(points[2].count, 2, "[7200,10800): Bob + Charlie overlap");
        assert_eq!(points[3].count, 0, "[10800,14400): Bob's leave at exactly 10800 doesn't count as still online");
    }

    #[test]
    fn concurrent_series_counts_overlap() {
        // Log lines use clock-times computed from *now*, a few seconds in
        // the past — not a fixed string like "01:00:00" — specifically so
        // this test can't fail depending on what time of day it happens to
        // run (a fixed clock-time is only "a few hours ago" most of the
        // time; near a UTC day boundary it can read as hours in the future
        // instead, which is exactly what broke the first version of this
        // test). Real log parsing end to end; `bucketize` above already
        // covers the actual overlap-counting math with zero clock
        // dependency, so this only needs to confirm the two paths connect.
        fn clock(secs_ago: i64) -> String {
            let s = (now() - secs_ago).rem_euclid(86400);
            format!("{:02}:{:02}:{:02}", s / 3600, (s % 3600) / 60, s % 60)
        }
        let log = format!(
            "[{}] [Server thread/INFO]: Alice joined the game\n\
             [{}] [Server thread/INFO]: Bob joined the game\n\
             [{}] [Server thread/INFO]: Alice left the game\n\
             [{}] [Server thread/INFO]: Bob left the game\n",
            clock(20),
            clock(15),
            clock(10),
            clock(5),
        );
        let d = write_srv("concurrent", &log);
        let since = now() - 3600;
        let points = concurrent_series(&d.to_string_lossy(), false, since, 3600);
        assert!(!points.is_empty());
        assert!(
            points.iter().any(|p| p.count >= 2),
            "Alice + Bob's overlapping sessions should show up somewhere: {points:?}"
        );
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn concurrent_series_never_returns_absurd_bucket_counts() {
        // since = the Unix epoch, bucket_secs = 1s — without the auto-
        // coarsening safeguard this would try to allocate ~1.7 billion
        // buckets between 1970 and now.
        let d = write_srv("safety", "");
        let points = concurrent_series(&d.to_string_lossy(), false, 0, 1);
        assert!(points.len() <= 3001, "got {} buckets, safeguard should cap this", points.len());
        let _ = fs::remove_dir_all(&d);
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
