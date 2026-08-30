//! World management. Vanilla loads one overworld (`level-name`) plus its
//! `<name>_nether` / `<name>_the_end` siblings; other saved worlds sit in the
//! folder unused until you switch to them.
//!
//! Switch / rename / delete require the server to be stopped (checked by the
//! command layer). Deletes move to `.craftpanel-trash/`, never erase.

use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::properties::Properties;

const TRASH: &str = ".craftpanel-trash";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct World {
    pub name: String,
    pub active: bool,
    pub size_bytes: u64,
    pub seed: Option<String>,
    pub has_nether: bool,
    pub has_end: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorldInfo {
    pub active: String,
    pub worlds: Vec<World>,
}

fn dir_size(p: &Path) -> u64 {
    walkdir::WalkDir::new(p)
        .into_iter()
        .flatten()
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| e.metadata().ok().map(|m| m.len()))
        .sum()
}

fn is_world_dir(p: &Path) -> bool {
    p.is_dir() && (p.join("level.dat").is_file() || p.join("level.dat_old").is_file())
}

fn read_seed(dir: &Path) -> Option<String> {
    // level.dat is NBT/gzip — not worth a parser here. Fall back to the
    // property that generated it.
    let _ = dir;
    None
}

pub fn list(server_dir: &str) -> WorldInfo {
    let root = Path::new(server_dir);
    let props = Properties::load(root);
    let active = props.get_or("level-name", "world");
    let seed_prop = props.get("level-seed").filter(|s| !s.is_empty());

    let mut worlds = Vec::new();
    if let Ok(rd) = fs::read_dir(root) {
        for e in rd.flatten() {
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name.ends_with("_nether") || name.ends_with("_the_end") {
                continue;
            }
            if !is_world_dir(&p) {
                continue;
            }
            let is_active = name == active;
            worlds.push(World {
                seed: if is_active { seed_prop.clone() } else { read_seed(&p) },
                active: is_active,
                size_bytes: dir_size(&p)
                    + dir_size(&root.join(format!("{name}_nether")))
                    + dir_size(&root.join(format!("{name}_the_end"))),
                has_nether: root.join(format!("{name}_nether")).is_dir(),
                has_end: root.join(format!("{name}_the_end")).is_dir(),
                name,
            });
        }
    }
    // the active world may not exist on disk yet (fresh "create world")
    if !worlds.iter().any(|w| w.active) {
        worlds.push(World {
            name: active.clone(),
            active: true,
            size_bytes: 0,
            seed: seed_prop,
            has_nether: false,
            has_end: false,
        });
    }
    worlds.sort_by(|a, b| b.active.cmp(&a.active).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    WorldInfo { active, worlds }
}

fn safe_name(name: &str) -> Result<&str, String> {
    let n = name.trim();
    if n.is_empty()
        || n == "."
        || n == ".."
        || n.contains(['/', '\\', ':'])
        || n.starts_with('.')
    {
        return Err("That world name isn't allowed.".into());
    }
    Ok(n)
}

/// Point `level-name` at `name` (line-preserving). The server generates it on
/// next start if it doesn't exist yet.
pub fn set_active(server_dir: &str, name: &str) -> Result<(), String> {
    let name = safe_name(name)?;
    let root = Path::new(server_dir);
    let mut props = Properties::load(root);
    if !props.existed() {
        return Err("No server.properties yet — start the server once first.".into());
    }
    props.set("level-name", name);
    props.save().map_err(|e| e.to_string())
}

/// Set a fresh world name (+ optional seed) so the next start generates it.
pub fn create(server_dir: &str, name: &str, seed: Option<&str>) -> Result<(), String> {
    let name = safe_name(name)?;
    let root = Path::new(server_dir);
    if root.join(name).exists() {
        return Err("A world folder with that name already exists — switch to it instead.".into());
    }
    let mut props = Properties::load(root);
    props.set("level-name", name);
    match seed.map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => {
            props.set("level-seed", s);
        }
        None => {
            props.set("level-seed", "");
        }
    }
    props.save().map_err(|e| e.to_string())
}

pub fn rename(server_dir: &str, from: &str, to: &str) -> Result<(), String> {
    let from = safe_name(from)?;
    let to = safe_name(to)?;
    let root = Path::new(server_dir);
    if !root.join(from).is_dir() {
        return Err("That world folder doesn't exist.".into());
    }
    if root.join(to).exists() {
        return Err("A world with the new name already exists.".into());
    }
    for suffix in ["", "_nether", "_the_end"] {
        let src = root.join(format!("{from}{suffix}"));
        if src.is_dir() {
            fs::rename(&src, root.join(format!("{to}{suffix}"))).map_err(|e| e.to_string())?;
        }
    }
    // keep it active if it was
    let mut props = Properties::load(root);
    if props.get_or("level-name", "world") == from {
        props.set("level-name", to);
        props.save().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn delete(server_dir: &str, name: &str) -> Result<(), String> {
    let name = safe_name(name)?;
    let root = Path::new(server_dir);
    if Properties::load(root).get_or("level-name", "world") == name {
        return Err("That's the active world — switch to another one first.".into());
    }
    let trash = root.join(TRASH);
    fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    let mut moved = 0;
    for suffix in ["", "_nether", "_the_end"] {
        let src = root.join(format!("{name}{suffix}"));
        if src.is_dir() {
            fs::rename(&src, trash.join(format!("{}-{name}{suffix}", now()))).map_err(|e| e.to_string())?;
            moved += 1;
        }
    }
    if moved == 0 {
        return Err("That world folder doesn't exist.".into());
    }
    Ok(())
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn srv(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("cp-worlds-{tag}-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("world")).unwrap();
        fs::write(d.join("world/level.dat"), b"x").unwrap();
        fs::create_dir_all(d.join("world_nether")).unwrap();
        fs::write(d.join("world_nether/level.dat"), b"x").unwrap();
        fs::create_dir_all(d.join("old-smp")).unwrap();
        fs::write(d.join("old-smp/level.dat"), b"x").unwrap();
        fs::write(d.join("server.properties"), "level-name=world\n").unwrap();
        d
    }

    #[test]
    fn lists_worlds_and_marks_active() {
        let d = srv("list");
        let info = list(&d.to_string_lossy());
        assert_eq!(info.active, "world");
        let w = info.worlds.iter().find(|w| w.name == "world").unwrap();
        assert!(w.active && w.has_nether && !w.has_end);
        assert!(info.worlds.iter().any(|w| w.name == "old-smp" && !w.active));
        // nether/end folders aren't listed as their own worlds
        assert!(!info.worlds.iter().any(|w| w.name == "world_nether"));
    }

    #[test]
    fn switch_rename_delete() {
        let d = srv("ops");
        let s = d.to_string_lossy().to_string();

        set_active(&s, "old-smp").unwrap();
        assert_eq!(Properties::load(&d).get_or("level-name", ""), "old-smp");

        // now "world" is inactive → renamable + deletable
        rename(&s, "world", "backup-world").unwrap();
        assert!(d.join("backup-world/level.dat").is_file());
        assert!(d.join("backup-world_nether/level.dat").is_file());

        delete(&s, "backup-world").unwrap();
        assert!(!d.join("backup-world").exists());
        assert!(fs::read_dir(d.join(TRASH)).unwrap().count() >= 1);

        // can't delete the active world
        assert!(delete(&s, "old-smp").is_err());
    }

    #[test]
    fn create_points_level_name_and_seed() {
        let d = srv("create");
        let s = d.to_string_lossy().to_string();
        create(&s, "hardcore", Some("12345")).unwrap();
        let p = Properties::load(&d);
        assert_eq!(p.get_or("level-name", ""), "hardcore");
        assert_eq!(p.get_or("level-seed", ""), "12345");
    }

    #[test]
    fn rejects_bad_names() {
        let d = srv("evil");
        let s = d.to_string_lossy().to_string();
        assert!(set_active(&s, "../etc").is_err());
        assert!(rename(&s, "world", "a/b").is_err());
        assert!(create(&s, "", None).is_err());
    }
}
