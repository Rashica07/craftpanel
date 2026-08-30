//! Minecraft implementation of [`ServerAdapter`].

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};

use crate::adapter::{ServerAdapter, ServerConfig, ServerStatus, ServerType};

pub struct MinecraftAdapter;

/// Result of scanning a folder: the flavour plus any extra facts the UI shows
/// in the "confirm" step of the Add Server flow.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MinecraftDetection {
    pub server_type: ServerType,
    /// Jar or run-script the launcher should invoke, relative to the folder.
    pub launch_target: String,
    /// Best-effort Minecraft version string (e.g. "1.20.4"), if we can find one.
    pub mc_version: Option<String>,
    /// Files we matched on, for display / debugging.
    pub evidence: Vec<String>,
}

impl MinecraftAdapter {
    /// Full scan used by the Add Server flow.
    pub fn inspect(path: &Path) -> Option<MinecraftDetection> {
        let entries = list_files(path);
        let has = |name: &str| entries.iter().any(|e| e.eq_ignore_ascii_case(name));
        let find_glob = |prefix: &str, suffix: &str| -> Option<String> {
            entries.iter().find(|e| {
                let l = e.to_ascii_lowercase();
                l.starts_with(prefix) && l.ends_with(suffix)
            }).cloned()
        };

        let mut evidence = Vec::new();

        // --- Fabric / Quilt --------------------------------------------------
        // Any one of these markers is enough. A Fabric server keeps the vanilla
        // `server.jar` right next to its launcher, so this MUST win over the
        // generic `server.jar` check further down.
        {
            // The jar you actually run, in rough order of preference.
            let launch_jar = if has("fabric-server-launch.jar") {
                Some("fabric-server-launch.jar".to_string())
            } else if has("quilt-server-launch.jar") {
                Some("quilt-server-launch.jar".to_string())
            } else {
                // covers fabric-server-launcher.jar, fabric-server-mc.<ver>-...jar, etc.
                find_glob("fabric-server", ".jar")
                    .or_else(|| find_glob("quilt-server", ".jar"))
            };

            let props = has("fabric-server-launcher.properties");
            let fabric_dir = path.join(".fabric").is_dir() || path.join(".quilt").is_dir();
            let fabric_libs = path.join("libraries/net/fabricmc").is_dir()
                || path.join("libraries/org/quiltmc").is_dir();

            if launch_jar.is_some() || props || fabric_dir || fabric_libs {
                if let Some(j) = &launch_jar {
                    evidence.push(j.clone());
                }
                if props {
                    evidence.push("fabric-server-launcher.properties".into());
                }
                if fabric_dir {
                    evidence.push(".fabric/".into());
                }
                if fabric_libs {
                    evidence.push("libraries/net/fabricmc".into());
                }
                // Fall back to the conventional launcher name if we only saw
                // side-markers (dir / props / libs) but no obvious jar.
                let launch_target =
                    launch_jar.unwrap_or_else(|| "fabric-server-launch.jar".to_string());
                return Some(MinecraftDetection {
                    server_type: ServerType::Fabric,
                    launch_target,
                    mc_version: detect_version(path, &entries),
                    evidence,
                });
            }
        }

        // --- Forge / NeoForge ------------------------------------------------
        let has_forge_run = has("run.sh") || has("run.bat");
        let forge_jar = find_glob("forge-", ".jar").or_else(|| find_glob("neoforge-", ".jar"));
        let has_forge_libs = path.join("libraries/net/minecraftforge").is_dir()
            || path.join("libraries/net/neoforged").is_dir();
        if has_forge_run || forge_jar.is_some() || has_forge_libs {
            let launch_target = if has("run.sh") {
                "run.sh".into()
            } else if has("run.bat") {
                "run.bat".into()
            } else {
                forge_jar.clone().unwrap_or_else(|| "run.sh".into())
            };
            if has_forge_run {
                evidence.push("run script".into());
            }
            if let Some(j) = &forge_jar {
                evidence.push(j.clone());
            }
            if has_forge_libs {
                evidence.push("libraries/net/minecraftforge".into());
            }
            return Some(MinecraftDetection {
                server_type: ServerType::Forge,
                launch_target,
                mc_version: detect_version(path, &entries),
                evidence,
            });
        }

        // --- Paper --------------------------------------------------------
        if let Some(jar) = jar_matching(&entries, "paper") {
            evidence.push(jar.clone());
            return Some(MinecraftDetection {
                server_type: ServerType::Paper,
                launch_target: jar,
                mc_version: detect_version(path, &entries),
                evidence,
            });
        }

        // --- Spigot / Bukkit / CraftBukkit ------------------------------
        for key in ["spigot", "craftbukkit", "bukkit"] {
            if let Some(jar) = jar_matching(&entries, key) {
                evidence.push(jar.clone());
                return Some(MinecraftDetection {
                    server_type: ServerType::Spigot,
                    launch_target: jar,
                    mc_version: detect_version(path, &entries),
                    evidence,
                });
            }
        }

        // --- Vanilla / generic ----------------------------------------------
        if has("server.jar") {
            evidence.push("server.jar".into());
            return Some(MinecraftDetection {
                server_type: ServerType::Vanilla,
                launch_target: "server.jar".into(),
                mc_version: detect_version(path, &entries),
                evidence,
            });
        }
        // Last resort: a lone jar that isn't obviously a mod/plugin.
        let jars: Vec<&String> = entries
            .iter()
            .filter(|e| e.to_ascii_lowercase().ends_with(".jar"))
            .collect();
        if jars.len() == 1 {
            evidence.push(jars[0].clone());
            return Some(MinecraftDetection {
                server_type: ServerType::Vanilla,
                launch_target: jars[0].clone(),
                mc_version: detect_version(path, &entries),
                evidence,
            });
        }

        None
    }
}

impl ServerAdapter for MinecraftAdapter {
    fn detect(path: &Path) -> Option<ServerType> {
        MinecraftAdapter::inspect(path).map(|d| d.server_type)
    }

    fn start_command(&self, config: &ServerConfig) -> Command {
        // Real launch wiring lands in Stage 2; this is the canonical shape.
        let mut cmd = Command::new(&config.java_path);
        cmd.current_dir(&config.path)
            .arg(format!("-Xms{}M", config.ram_mb))
            .arg(format!("-Xmx{}M", config.ram_mb))
            .arg("-jar")
            .arg(&config.launch_target)
            .arg("nogui");
        cmd
    }

    fn parse_status(&self, output: &str) -> ServerStatus {
        let o = output.to_ascii_lowercase();
        if o.contains("done (") && o.contains("for help") {
            ServerStatus::Running
        } else if o.contains("starting minecraft server") || o.contains("loading properties") {
            ServerStatus::Starting
        } else if o.contains("stopping the server") || o.contains("stopping server") {
            ServerStatus::Stopping
        } else if o.contains("exception in server tick loop") || o.contains("failed to start") {
            ServerStatus::Crashed
        } else {
            ServerStatus::Unknown
        }
    }
}

// --- helpers ---------------------------------------------------------------

fn list_files(path: &Path) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(path) {
        for entry in rd.flatten() {
            if let Ok(name) = entry.file_name().into_string() {
                out.push(name);
            }
        }
    }
    out
}

/// A jar whose filename contains `key` but that isn't a plugin sitting in a
/// subfolder (we only ever scan the top level, so that's already guaranteed).
fn jar_matching(entries: &[String], key: &str) -> Option<String> {
    entries
        .iter()
        .find(|e| {
            let l = e.to_ascii_lowercase();
            l.ends_with(".jar") && l.contains(key)
        })
        .cloned()
}

/// Best-effort Minecraft version discovery.
fn detect_version(path: &Path, entries: &[String]) -> Option<String> {
    // 1. Paper/Purpur write a version_history.json with "git-Paper-... (MC: 1.20.4)".
    if let Ok(text) = fs::read_to_string(path.join("version_history.json")) {
        if let Some(v) = extract_mc_paren(&text) {
            return Some(v);
        }
    }
    // 2. Fabric's launcher properties.
    if let Ok(text) = fs::read_to_string(path.join("fabric-server-launcher.properties")) {
        for line in text.lines() {
            if let Some(rest) = line.strip_prefix("serverJar=") {
                if let Some(v) = extract_version_token(rest) {
                    return Some(v);
                }
            }
        }
    }
    // 3. A jar filename that carries the version, e.g. minecraft_server.1.20.4.jar
    for e in entries {
        if let Some(v) = extract_version_token(e) {
            return Some(v);
        }
    }
    // 4. Forge libraries dir: libraries/net/minecraft/server/<mcver>-<forgever>/
    let server_libs: PathBuf = path.join("libraries/net/minecraft/server");
    if let Ok(rd) = fs::read_dir(server_libs) {
        for entry in rd.flatten() {
            if let Ok(name) = entry.file_name().into_string() {
                if let Some(v) = extract_version_token(&name) {
                    return Some(v);
                }
            }
        }
    }
    // 5. Fabric/Vanilla keep the real server jar under versions/<ver>/server-<ver>.jar
    if let Ok(rd) = fs::read_dir(path.join("versions")) {
        for entry in rd.flatten() {
            if let Ok(name) = entry.file_name().into_string() {
                if is_version_string(&name) {
                    return Some(name);
                }
            }
        }
    }
    None
}

/// A `versions/<name>/` directory whose name is a Minecraft version.
fn is_version_string(s: &str) -> bool {
    is_mc_version(s)
}

fn extract_mc_paren(text: &str) -> Option<String> {
    let idx = text.find("(MC:")?;
    let tail = &text[idx + 4..];
    let end = tail.find(')')?;
    let v = tail[..end].trim().to_string();
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

/// Pull a Minecraft version token out of an arbitrary string.
///
/// Handles both schemes: the classic `1.x` / `1.x.y` and the year-based scheme
/// Mojang moved to in 2026 (`26.0`, `26.2`, `27.1`, …). Won't match a bare
/// integer or a `0.x` — needs a plausible MC major (1, or 20–99).
fn extract_version_token(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        // start of a numeric run
        if bytes[i].is_ascii_digit() && (i == 0 || !bytes[i - 1].is_ascii_digit()) {
            let start = i;
            let mut j = i;
            while j < bytes.len() && (bytes[j].is_ascii_digit() || bytes[j] == b'.') {
                j += 1;
            }
            let tok = s[start..j].trim_end_matches('.').to_string();
            if is_mc_version(&tok) {
                return Some(tok);
            }
            i = j;
        } else {
            i += 1;
        }
    }
    None
}

/// `1.x[.y]` (classic) or `<20..=99>.x[.y]` (year scheme).
fn is_mc_version(tok: &str) -> bool {
    let parts: Vec<&str> = tok.split('.').collect();
    if !(2..=3).contains(&parts.len()) {
        return false;
    }
    if !parts.iter().all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit())) {
        return false;
    }
    match parts[0].parse::<u32>() {
        Ok(1) => true,
        Ok(major @ 20..=99) => major != 0,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("cp-test-{}-{:?}", name, std::thread::current().id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn detects_fabric() {
        let d = tmp("fabric");
        fs::write(d.join("fabric-server-launch.jar"), b"").unwrap();
        fs::write(d.join("server.jar"), b"").unwrap();
        let got = MinecraftAdapter::inspect(&d).unwrap();
        assert_eq!(got.server_type, ServerType::Fabric);
        assert_eq!(got.launch_target, "fabric-server-launch.jar");
    }

    #[test]
    fn fabric_wins_over_bundled_vanilla_jar() {
        // modern Fabric: versioned launcher jar + the vanilla server.jar it wraps,
        // and NO fabric-server-launch.jar. Must not be misread as Vanilla.
        let d = tmp("fabric-modern");
        fs::write(d.join("fabric-server-mc.1.21.1-loader.0.16.5-launcher.1.0.1.jar"), b"").unwrap();
        fs::write(d.join("server.jar"), b"").unwrap();
        let got = MinecraftAdapter::inspect(&d).unwrap();
        assert_eq!(got.server_type, ServerType::Fabric);
        assert!(got.launch_target.starts_with("fabric-server-mc"));
        assert_eq!(got.mc_version.as_deref(), Some("1.21.1"));
    }

    #[test]
    fn fabric_detected_from_side_markers_only() {
        let d = tmp("fabric-markers");
        fs::create_dir_all(d.join(".fabric")).unwrap();
        fs::write(d.join("fabric-server-launcher.properties"), b"serverJar=server.jar").unwrap();
        fs::write(d.join("server.jar"), b"").unwrap();
        let got = MinecraftAdapter::inspect(&d).unwrap();
        assert_eq!(got.server_type, ServerType::Fabric);
    }

    #[test]
    fn version_from_versions_dir_new_scheme() {
        let d = tmp("fabric-newver");
        fs::write(d.join("fabric-server-launch.jar"), b"").unwrap();
        fs::create_dir_all(d.join("versions/26.2")).unwrap();
        fs::write(d.join("versions/26.2/server-26.2.jar"), b"").unwrap();
        let got = MinecraftAdapter::inspect(&d).unwrap();
        assert_eq!(got.server_type, ServerType::Fabric);
        assert_eq!(got.mc_version.as_deref(), Some("26.2"));
    }

    #[test]
    fn detects_forge_by_run_script() {
        let d = tmp("forge");
        fs::write(d.join("run.sh"), b"").unwrap();
        let got = MinecraftAdapter::inspect(&d).unwrap();
        assert_eq!(got.server_type, ServerType::Forge);
    }

    #[test]
    fn detects_paper_and_version_from_history() {
        let d = tmp("paper");
        fs::write(d.join("paper-1.21.1-40.jar"), b"").unwrap();
        fs::write(
            d.join("version_history.json"),
            br#"{"currentVersion":"git-Paper-40 (MC: 1.21.1)"}"#,
        )
        .unwrap();
        let got = MinecraftAdapter::inspect(&d).unwrap();
        assert_eq!(got.server_type, ServerType::Paper);
        assert_eq!(got.mc_version.as_deref(), Some("1.21.1"));
    }

    #[test]
    fn detects_vanilla_and_returns_none_when_empty() {
        let d = tmp("vanilla");
        fs::write(d.join("server.jar"), b"").unwrap();
        assert_eq!(
            MinecraftAdapter::inspect(&d).unwrap().server_type,
            ServerType::Vanilla
        );

        let e = tmp("empty");
        assert!(MinecraftAdapter::inspect(&e).is_none());
    }

    #[test]
    fn extracts_version_tokens_both_schemes() {
        assert_eq!(
            extract_version_token("minecraft_server.1.20.4.jar").as_deref(),
            Some("1.20.4")
        );
        assert_eq!(extract_version_token("server-26.2.jar").as_deref(), Some("26.2"));
        assert_eq!(extract_version_token("paper-1.8.9-R0.1.jar").as_deref(), Some("1.8.9"));
        assert_eq!(extract_version_token("paper.jar"), None);
        // a lone loader build number must not be mistaken for a MC version
        assert_eq!(extract_version_token("fabric-loader-0.16.5.jar"), None);
        assert_eq!(extract_version_token("something-3.4.jar"), None);
    }

    #[test]
    fn version_from_versions_dir_old_scheme() {
        let d = tmp("fabric-oldver");
        fs::write(d.join("fabric-server-launch.jar"), b"").unwrap();
        fs::create_dir_all(d.join("versions/1.18.2")).unwrap();
        let got = MinecraftAdapter::inspect(&d).unwrap();
        assert_eq!(got.mc_version.as_deref(), Some("1.18.2"));
    }

    #[test]
    fn parse_status_reads_console() {
        let a = MinecraftAdapter;
        assert_eq!(
            a.parse_status("[12:00:00] [Server thread/INFO]: Done (12.345s)! For help, type \"help\""),
            ServerStatus::Running
        );
        assert_eq!(
            a.parse_status("[12:00:00] [Server thread/INFO]: Stopping the server"),
            ServerStatus::Stopping
        );
    }
}
