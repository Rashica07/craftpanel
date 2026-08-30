//! Bedrock cross-play: one-click Geyser + Floodgate so players on the Bedrock
//! edition (phone / console / Windows 10 store) can join a Java server, no Java
//! account needed. Downloads from GeyserMC's own build API.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::adapter::ServerType;

const GEYSER_API: &str = "https://download.geysermc.org/v2/projects";
const DEFAULT_BEDROCK_PORT: u16 = 19132;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossplayStatus {
    /// this loader can run Geyser as a plugin/mod
    pub compatible: bool,
    pub geyser: bool,
    pub floodgate: bool,
    /// UDP port Bedrock players connect on
    pub bedrock_port: u16,
    /// where the jars go: "plugins" or "mods"
    pub folder: &'static str,
}

/// GeyserMC artifact name for this loader.
fn platform(t: ServerType) -> Option<&'static str> {
    match t {
        ServerType::Paper | ServerType::Spigot => Some("spigot"),
        ServerType::Fabric => Some("fabric"),
        // NeoForge is stored as Forge in the DB; Geyser has a neoforge build.
        ServerType::Forge => Some("neoforge"),
        // Vanilla has no plugin loader to install Geyser into. A native
        // Bedrock server doesn't need a Bedrock *bridge* — it already speaks
        // Bedrock — so this panel simply doesn't apply and isn't shown for
        // one (see ServerDetail's tab list).
        ServerType::Vanilla | ServerType::Bedrock => None,
    }
}

fn folder(t: ServerType) -> &'static str {
    if matches!(t, ServerType::Paper | ServerType::Spigot) {
        "plugins"
    } else {
        "mods"
    }
}

fn jars(dir: &Path, t: ServerType) -> Vec<String> {
    let mut out = Vec::new();
    for sub in [folder(t), "mods", "plugins", "mods-disabled"] {
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

fn bedrock_port(dir: &Path) -> u16 {
    // Geyser writes config/Geyser-*/config.yml with `port: 19132` under `bedrock:`
    for base in ["plugins/Geyser-Spigot", "config/Geyser-Fabric", "config/geyser-neoforge"] {
        let cfg = dir.join(base).join("config.yml");
        if let Ok(text) = fs::read_to_string(&cfg) {
            let mut in_bedrock = false;
            for line in text.lines() {
                let t = line.trim_start();
                if t.starts_with("bedrock:") {
                    in_bedrock = true;
                } else if in_bedrock {
                    if let Some(p) = t.strip_prefix("port:") {
                        if let Ok(n) = p.trim().parse() {
                            return n;
                        }
                    }
                    if !line.starts_with(' ') && !t.is_empty() {
                        in_bedrock = false;
                    }
                }
            }
        }
    }
    DEFAULT_BEDROCK_PORT
}

pub fn status(server_dir: &str, t: ServerType) -> CrossplayStatus {
    let dir = Path::new(server_dir);
    let js = jars(dir, t);
    CrossplayStatus {
        compatible: platform(t).is_some(),
        geyser: js.iter().any(|j| j.contains("geyser")),
        floodgate: js.iter().any(|j| j.contains("floodgate")),
        bedrock_port: bedrock_port(dir),
        folder: folder(t),
    }
}

fn download(project: &str, artifact: &str, dest: &Path, name: &str) -> Result<(), String> {
    let url =
        format!("{GEYSER_API}/{project}/versions/latest/builds/latest/downloads/{artifact}");
    let mut bytes = Vec::new();
    ureq::get(&url)
        .set("User-Agent", "CraftPanel")
        .timeout(std::time::Duration::from_secs(120))
        .call()
        .map_err(|e| format!("{project} download failed: {e}"))?
        .into_reader()
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() < 100_000 {
        return Err(format!("{project} download looks wrong ({} bytes)", bytes.len()));
    }
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    fs::write(dest.join(name), &bytes).map_err(|e| e.to_string())
}

pub fn enable(server_dir: &str, t: ServerType) -> Result<CrossplayStatus, String> {
    let artifact = platform(t).ok_or(
        "Bedrock cross-play needs Paper, Spigot, Fabric or NeoForge — vanilla/Forge can't run Geyser.",
    )?;
    let dir = Path::new(server_dir);
    let dest: PathBuf = dir.join(folder(t));

    download("geyser", artifact, &dest, &format!("Geyser-{artifact}.jar"))?;
    // Floodgate isn't published for the "spigot" artifact on every channel; try,
    // but don't fail the whole thing if only Geyser lands.
    let fg = download("floodgate", artifact, &dest, &format!("floodgate-{artifact}.jar"));

    // Fabric Geyser needs the Fabric API
    if matches!(t, ServerType::Fabric) {
        let _ = crate::modrinth::install(server_dir, t, "fabric-api", "mod", None);
    }

    let mut st = status(server_dir, t);
    if fg.is_err() && !st.floodgate {
        // surface it but keep Geyser
        return Err(format!(
            "Geyser installed. Floodgate couldn't be fetched automatically ({}). \
             Grab it from geysermc.org and drop it in {}/.",
            fg.unwrap_err(),
            st.folder
        ));
    }
    st = status(server_dir, t);
    Ok(st)
}

pub fn disable(server_dir: &str, t: ServerType) -> Result<(), String> {
    let dir = Path::new(server_dir);
    let trash = dir.join(".craftpanel-trash");
    let _ = fs::create_dir_all(&trash);
    for sub in [folder(t), "mods", "plugins"] {
        if let Ok(rd) = fs::read_dir(dir.join(sub)) {
            for e in rd.flatten() {
                let n = e.file_name().to_string_lossy().to_ascii_lowercase();
                if n.ends_with(".jar") && (n.contains("geyser") || n.contains("floodgate")) {
                    let _ = fs::rename(e.path(), trash.join(e.file_name()));
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_and_folder() {
        assert_eq!(platform(ServerType::Paper), Some("spigot"));
        assert_eq!(platform(ServerType::Fabric), Some("fabric"));
        assert_eq!(platform(ServerType::Vanilla), None);
        assert_eq!(folder(ServerType::Paper), "plugins");
        assert_eq!(folder(ServerType::Fabric), "mods");
    }

    #[test]
    fn status_detects_jars_and_reads_port() {
        let d = std::env::temp_dir().join(format!("cp-xp-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("plugins")).unwrap();
        fs::write(d.join("plugins/Geyser-Spigot.jar"), vec![0u8; 200]).unwrap();
        fs::create_dir_all(d.join("plugins/Geyser-Spigot")).unwrap();
        fs::write(
            d.join("plugins/Geyser-Spigot/config.yml"),
            "bedrock:\n  address: 0.0.0.0\n  port: 19144\n",
        )
        .unwrap();

        let s = status(&d.to_string_lossy(), ServerType::Paper);
        assert!(s.compatible && s.geyser && !s.floodgate);
        assert_eq!(s.bedrock_port, 19144);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    #[ignore]
    fn live_enable_paper() {
        let d = std::env::temp_dir().join("cp-xp-live");
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        let s = enable(&d.to_string_lossy(), ServerType::Paper).unwrap();
        assert!(s.geyser);
        assert!(d.join("plugins/Geyser-spigot.jar").is_file());
        let _ = fs::remove_dir_all(&d);
    }
}
