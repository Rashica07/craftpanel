//! Anti-cheat: (1) advisor — know the common anti-cheats per loader, spot when
//! a reachable server has none; (2) suspicion — cheap signals scraped from the
//! logs (movement kicks, flight, anti-cheat plugin flags, rapid re-joins).
//!
//! Advisory only. Never touches `online-mode`.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::Path;

use serde::Serialize;

use crate::adapter::ServerType;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    pub name: String,
    /// modrinth slug for one-click install via the Browse tab
    pub slug: String,
    pub blurb: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Advice {
    /// anti-cheats we detected in mods/ or plugins/
    pub installed: Vec<String>,
    pub recommended: Vec<Recommendation>,
    /// the server's port is reachable from this machine (≈ exposed)
    pub public: bool,
    /// public + no anti-cheat installed
    pub warn: bool,
    pub supported: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suspicion {
    pub name: String,
    pub flags: u32,
    pub rejoins: u32,
    /// a few example log lines
    pub samples: Vec<String>,
}

/// (display name, jar/plugin name fragments to match, modrinth slug, blurb)
fn catalogue(t: ServerType) -> Vec<(&'static str, &'static [&'static str], &'static str, &'static str)> {
    match t {
        ServerType::Paper | ServerType::Spigot => vec![
            ("GrimAC", &["grim"], "grimac", "Modern, low-false-positive. The usual pick for Paper."),
            ("Vulcan", &["vulcan"], "", "Paid, very thorough (not on Modrinth)."),
            ("NoCheatPlus", &["nocheatplus", "ncp"], "", "Classic, free, still maintained forks."),
            ("Spartan", &["spartan"], "", "Paid, plug-and-play."),
        ],
        ServerType::Fabric | ServerType::Forge => vec![
            ("Vulcan (Fabric)", &["vulcan"], "", "Server-side checks for Fabric."),
            ("PandaAntiCheat", &["panda", "pandaanticheat"], "", "Lightweight Fabric anti-cheat."),
            ("NoCheatPlus (Fabric)", &["nocheat"], "", "Fabric port."),
        ],
        // Vanilla has no plugin/mod loader to install an anti-cheat into;
        // Bedrock has no Modrinth mod ecosystem in this sense at all (see
        // bedrock.rs) — neither gets a catalogue.
        ServerType::Vanilla | ServerType::Bedrock => vec![],
    }
}

fn known_names<'a>(t: ServerType) -> Vec<&'a str> {
    catalogue(t).iter().flat_map(|(_, frags, _, _)| frags.iter().copied()).collect()
}

fn list_jars(dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    for sub in ["mods", "mods-disabled", "plugins"] {
        if let Ok(rd) = fs::read_dir(dir.join(sub)) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_ascii_lowercase();
                if n.ends_with(".jar") {
                    out.push(n);
                }
            }
        }
    }
    out
}

pub fn advise(server_dir: &str, server_type: ServerType, public: bool) -> Advice {
    let dir = Path::new(server_dir);
    let jars = list_jars(dir);
    let known = known_names(server_type);

    let installed: Vec<String> = catalogue(server_type)
        .iter()
        .filter(|(_, frags, _, _)| {
            frags.iter().any(|f| jars.iter().any(|j| j.contains(f)))
        })
        .map(|(name, _, _, _)| name.to_string())
        .collect();
    let _ = known;

    let recommended: Vec<Recommendation> = if installed.is_empty() {
        catalogue(server_type)
            .into_iter()
            .filter(|(_, _, slug, _)| !slug.is_empty())
            .map(|(name, _, slug, blurb)| Recommendation {
                name: name.to_string(),
                slug: slug.to_string(),
                blurb,
            })
            .collect()
    } else {
        Vec::new()
    };

    Advice {
        supported: !matches!(server_type, ServerType::Vanilla),
        warn: public && installed.is_empty() && !matches!(server_type, ServerType::Vanilla),
        public,
        installed,
        recommended,
    }
}

// --- suspicion from logs -----------------------------------------------------

fn recent_log_text(dir: &Path) -> String {
    let logs = dir.join("logs");
    let mut text = String::new();
    // newest few rotated files, oldest-first, then latest.log
    let mut gz: Vec<_> = fs::read_dir(&logs)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.file_name().to_string_lossy().ends_with(".log.gz"))
        .collect();
    gz.sort_by_key(|e| e.file_name());
    for e in gz.iter().rev().take(4).rev() {
        if let Ok(bytes) = fs::read(e.path()) {
            let mut s = String::new();
            if flate2::read::GzDecoder::new(&bytes[..]).read_to_string(&mut s).is_ok() {
                text.push_str(&s);
            }
        }
    }
    if let Ok(s) = fs::read_to_string(logs.join("latest.log")) {
        text.push_str(&s);
    }
    text
}

fn valid_name(n: &str) -> bool {
    !n.is_empty() && n.len() <= 16 && n.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub fn suspicion(server_dir: &str) -> Vec<Suspicion> {
    let text = recent_log_text(Path::new(server_dir));
    let mut by_name: HashMap<String, Suspicion> = HashMap::new();
    // name -> last "joined" line number, to detect rapid re-joins
    let mut last_join: HashMap<String, usize> = HashMap::new();

    let flag_markers = [
        "moved too quickly",
        "moved wrongly",
        "floating too long",
        "flying is not enabled",
        "was kicked for",
    ];
    let ac_tags = ["[grim", "[vulcan", "[nocheatplus", "[ncp]", "[spartan", "[matrix", "[themis", "anticheat"];

    for (i, raw) in text.lines().enumerate() {
        let line = raw.to_string();
        let l = line.to_ascii_lowercase();
        let Some(msg) = line.split("]: ").nth(1) else { continue };

        // name for "moved too quickly" style is at the start of the message
        let first = msg.split_whitespace().next().unwrap_or("");
        let hit_flag = flag_markers.iter().any(|m| l.contains(m));
        let hit_ac = ac_tags.iter().any(|t| l.contains(t))
            && (l.contains("flag") || l.contains("fail") || l.contains("violation") || l.contains("cheat"));

        if hit_flag && valid_name(first) {
            let s = by_name.entry(first.to_string()).or_insert_with(|| Suspicion {
                name: first.to_string(),
                flags: 0,
                rejoins: 0,
                samples: Vec::new(),
            });
            s.flags += 1;
            if s.samples.len() < 4 {
                s.samples.push(line.trim().to_string());
            }
        } else if hit_ac {
            // AC plugin lines: find a valid-looking name token anywhere
            if let Some(name) = msg.split_whitespace().find(|t| valid_name(t) && t.len() >= 3) {
                let s = by_name.entry(name.to_string()).or_insert_with(|| Suspicion {
                    name: name.to_string(),
                    flags: 0,
                    rejoins: 0,
                    samples: Vec::new(),
                });
                s.flags += 1;
                if s.samples.len() < 4 {
                    s.samples.push(line.trim().to_string());
                }
            }
        }

        if let Some(name) = msg.strip_suffix(" joined the game") {
            if valid_name(name) {
                if let Some(&prev) = last_join.get(name) {
                    if i - prev < 6 {
                        by_name
                            .entry(name.to_string())
                            .or_insert_with(|| Suspicion {
                                name: name.to_string(),
                                flags: 0,
                                rejoins: 0,
                                samples: Vec::new(),
                            })
                            .rejoins += 1;
                    }
                }
                last_join.insert(name.to_string(), i);
            }
        }
    }

    let mut out: Vec<Suspicion> =
        by_name.into_values().filter(|s| s.flags > 0 || s.rejoins >= 2).collect();
    out.sort_by(|a, b| (b.flags + b.rejoins).cmp(&(a.flags + a.rejoins)));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advises_when_public_and_unprotected() {
        let d = std::env::temp_dir().join(format!("cp-ac-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("plugins")).unwrap();
        let a = advise(&d.to_string_lossy(), ServerType::Paper, true);
        assert!(a.warn);
        assert!(a.recommended.iter().any(|r| r.slug == "grimac"));

        fs::write(d.join("plugins/GrimAC-2.3.jar"), b"x").unwrap();
        let a2 = advise(&d.to_string_lossy(), ServerType::Paper, true);
        assert!(!a2.warn);
        assert_eq!(a2.installed, vec!["GrimAC"]);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn suspicion_counts_movement_flags_and_rejoins() {
        let d = std::env::temp_dir().join(format!("cp-acs-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("logs")).unwrap();
        let log = "\
[10:00:00] [Server thread/WARN]: Hacker123 moved too quickly! -12.0,0.0,3.4
[10:00:01] [Server thread/WARN]: Hacker123 moved wrongly!
[10:00:02] [Server thread/INFO]: [GrimAC] Hacker123 flagged Simulation (A) VL: 12
[10:05:00] [Server thread/INFO]: Bob joined the game
[10:05:01] [Server thread/INFO]: Bob left the game
[10:05:02] [Server thread/INFO]: Bob joined the game
[10:05:03] [Server thread/INFO]: Bob left the game
[10:05:04] [Server thread/INFO]: Bob joined the game
";
        fs::write(d.join("logs/latest.log"), log).unwrap();
        let s = suspicion(&d.to_string_lossy());
        let h = s.iter().find(|x| x.name == "Hacker123").unwrap();
        assert_eq!(h.flags, 3);
        assert!(!h.samples.is_empty());
        let b = s.iter().find(|x| x.name == "Bob");
        assert!(b.map(|x| x.rejoins >= 2).unwrap_or(false));
        let _ = fs::remove_dir_all(&d);
    }
}
