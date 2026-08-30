//! Stage 4 — `mods/` folder management for Fabric / Forge / NeoForge servers.
//!
//! Enable/disable = move a jar between `mods/` and `mods-disabled/`. Removing a
//! jar moves it to `.craftpanel-trash/` rather than deleting it outright.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::adapter::ServerType;

const MODS: &str = "mods";
const DISABLED: &str = "mods-disabled";
const TRASH: &str = ".craftpanel-trash";

#[derive(Debug, Clone, Serialize)]
pub struct ModFile {
    pub name: String,
    pub size: u64,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModList {
    /// This loader loads from a `mods/` folder at all.
    pub supported: bool,
    pub mods: Vec<ModFile>,
    /// Fabric/Quilt: the Fabric API jar is present.
    pub fabric_api_present: bool,
    /// Offline-auth "cracked protection" mods we recognise (EasyAuth, …).
    pub auth_mods: Vec<String>,
    pub warnings: Vec<String>,
}

fn loader_uses_mods(t: ServerType) -> bool {
    matches!(t, ServerType::Fabric | ServerType::Forge)
}

fn safe_jar_name(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('/')
        && !name.contains('\\')
        && name != "."
        && name != ".."
        && name.to_ascii_lowercase().ends_with(".jar")
}

fn read_jars(dir: &Path, enabled: bool) -> Vec<ModFile> {
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            let Ok(name) = e.file_name().into_string() else { continue };
            if !name.to_ascii_lowercase().ends_with(".jar") {
                continue;
            }
            let size = e.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(ModFile { name, size, enabled });
        }
    }
    out.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
    out
}

const AUTH_MOD_KEYS: &[&str] = &[
    "easyauth", "simpleauth", "simplelogin", "authme", "fabricauth", "openlogin",
    "nlogin", "ultimateauth", "dynmap-auth", "loginsecurity", "authmevelocity",
];

pub fn list(server_dir: &str, server_type: ServerType) -> ModList {
    let dir = Path::new(server_dir);
    if !loader_uses_mods(server_type) {
        return ModList {
            supported: false,
            mods: Vec::new(),
            fabric_api_present: false,
            auth_mods: Vec::new(),
            warnings: vec![format!(
                "{} servers use plugins, not a mods/ folder.",
                server_type.label()
            )],
        };
    }

    let mut mods = read_jars(&dir.join(MODS), true);
    mods.extend(read_jars(&dir.join(DISABLED), false));

    let lower: Vec<String> = mods.iter().map(|m| m.name.to_ascii_lowercase()).collect();
    let fabric_api_present = lower.iter().any(|n| {
        (n.contains("fabric-api") || n.contains("fabric_api") || n.contains("qsl")
            || n.contains("quilted-fabric-api"))
            && mods
                .iter()
                .find(|m| m.name.to_ascii_lowercase() == *n)
                .map(|m| m.enabled)
                .unwrap_or(false)
    });

    let auth_mods: Vec<String> = mods
        .iter()
        .filter(|m| {
            let l = m.name.to_ascii_lowercase();
            AUTH_MOD_KEYS.iter().any(|k| l.contains(k))
        })
        .map(|m| m.name.clone())
        .collect();

    let mut warnings = Vec::new();
    if server_type == ServerType::Fabric && !fabric_api_present && !mods.is_empty() {
        warnings.push(
            "No Fabric API jar detected in mods/. Most Fabric mods need it — add fabric-api."
                .to_string(),
        );
    }

    ModList { supported: true, mods, fabric_api_present, auth_mods, warnings }
}

pub fn set_enabled(server_dir: &str, name: &str, enable: bool) -> Result<(), String> {
    if !safe_jar_name(name) {
        return Err("Invalid mod filename.".into());
    }
    let dir = Path::new(server_dir);
    let (from, to) = if enable {
        (dir.join(DISABLED).join(name), dir.join(MODS).join(name))
    } else {
        (dir.join(MODS).join(name), dir.join(DISABLED).join(name))
    };
    if !from.is_file() {
        return Err(format!("{name} isn't where expected."));
    }
    fs::create_dir_all(to.parent().unwrap()).map_err(|e| e.to_string())?;
    move_file(&from, &to)
}

pub fn import(server_dir: &str, sources: &[String]) -> Result<Vec<String>, String> {
    let mods_dir = Path::new(server_dir).join(MODS);
    fs::create_dir_all(&mods_dir).map_err(|e| e.to_string())?;
    let mut added = Vec::new();
    for src in sources {
        let src = Path::new(src);
        let name = src
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or("bad source path")?;
        if !name.to_ascii_lowercase().ends_with(".jar") {
            return Err(format!("{name} isn't a .jar"));
        }
        fs::copy(src, mods_dir.join(name)).map_err(|e| format!("{name}: {e}"))?;
        added.push(name.to_string());
    }
    Ok(added)
}

pub fn remove(server_dir: &str, name: &str) -> Result<(), String> {
    if !safe_jar_name(name) {
        return Err("Invalid mod filename.".into());
    }
    let dir = Path::new(server_dir);
    let trash = dir.join(TRASH);
    fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    for base in [MODS, DISABLED] {
        let p = dir.join(base).join(name);
        if p.is_file() {
            return move_file(&p, &trash.join(name));
        }
    }
    Err(format!("{name} not found."))
}

fn move_file(from: &Path, to: &PathBuf) -> Result<(), String> {
    if to.exists() {
        let _ = fs::remove_file(to);
    }
    match fs::rename(from, to) {
        Ok(()) => Ok(()),
        // cross-device (rare): copy then delete
        Err(_) => {
            fs::copy(from, to).map_err(|e| e.to_string())?;
            fs::remove_file(from).map_err(|e| e.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(n: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("cp-mods-{n}-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn lists_and_toggles() {
        let d = tmp("toggle");
        fs::create_dir_all(d.join("mods")).unwrap();
        fs::write(d.join("mods/lithium.jar"), b"x").unwrap();
        fs::write(d.join("mods/fabric-api-0.100.jar"), b"x").unwrap();

        let l = list(&d.to_string_lossy(), ServerType::Fabric);
        assert!(l.supported);
        assert_eq!(l.mods.len(), 2);
        assert!(l.fabric_api_present);

        set_enabled(&d.to_string_lossy(), "lithium.jar", false).unwrap();
        assert!(d.join("mods-disabled/lithium.jar").is_file());
        assert!(!d.join("mods/lithium.jar").exists());

        let l2 = list(&d.to_string_lossy(), ServerType::Fabric);
        let lith = l2.mods.iter().find(|m| m.name == "lithium.jar").unwrap();
        assert!(!lith.enabled);
    }

    #[test]
    fn detects_auth_mods_and_missing_fabric_api() {
        let d = tmp("auth");
        fs::create_dir_all(d.join("mods")).unwrap();
        fs::write(d.join("mods/EasyAuth-3.0.jar"), b"x").unwrap();
        fs::write(d.join("mods/some-mod.jar"), b"x").unwrap();

        let l = list(&d.to_string_lossy(), ServerType::Fabric);
        assert_eq!(l.auth_mods, vec!["EasyAuth-3.0.jar"]);
        assert!(!l.fabric_api_present);
        assert!(l.warnings.iter().any(|w| w.contains("Fabric API")));
    }

    #[test]
    fn paper_is_unsupported() {
        let d = tmp("paper");
        let l = list(&d.to_string_lossy(), ServerType::Paper);
        assert!(!l.supported);
    }

    #[test]
    fn remove_moves_to_trash() {
        let d = tmp("rm");
        fs::create_dir_all(d.join("mods")).unwrap();
        fs::write(d.join("mods/bad.jar"), b"x").unwrap();
        remove(&d.to_string_lossy(), "bad.jar").unwrap();
        assert!(!d.join("mods/bad.jar").exists());
        assert!(d.join(".craftpanel-trash/bad.jar").is_file());
    }

    #[test]
    fn rejects_path_traversal() {
        let d = tmp("evil");
        assert!(set_enabled(&d.to_string_lossy(), "../../etc/passwd", false).is_err());
        assert!(remove(&d.to_string_lossy(), "..").is_err());
    }
}
