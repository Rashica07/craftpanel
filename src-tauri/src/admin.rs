//! Ops / whitelist / bans overview for a server.
//!
//! Reading is always available (parse the JSON files Minecraft keeps). Changes
//! go through RCON while the server is up — that's offline-mode safe (keyed on
//! name, never a synthesised UUID). When the server is down, the UI shows the
//! lists read-only and tells the user to start it.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::properties::Properties;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminLists {
    pub ops: Vec<String>,
    pub whitelist: Vec<String>,
    pub banned: Vec<BannedEntry>,
    pub banned_ips: Vec<String>,
    /// `white-list=true` in server.properties
    pub whitelist_on: bool,
    /// `enforce-whitelist=true`
    pub enforce_whitelist: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BannedEntry {
    pub name: String,
    pub reason: Option<String>,
}

#[derive(Deserialize)]
struct NameOnly {
    name: Option<String>,
}

#[derive(Deserialize)]
struct BanRow {
    name: Option<String>,
    reason: Option<String>,
}

#[derive(Deserialize)]
struct IpRow {
    ip: Option<String>,
}

fn names(dir: &Path, file: &str) -> Vec<String> {
    let Ok(raw) = fs::read_to_string(dir.join(file)) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<NameOnly>>(&raw)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| r.name)
        .collect()
}

pub fn read_lists(server_dir: &str) -> AdminLists {
    let dir = Path::new(server_dir);
    let props = Properties::load(dir);

    let banned = fs::read_to_string(dir.join("banned-players.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<BanRow>>(&raw).ok())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| {
            r.name.map(|name| BannedEntry {
                name,
                reason: r.reason.filter(|s| !s.is_empty()),
            })
        })
        .collect();

    let banned_ips = fs::read_to_string(dir.join("banned-ips.json"))
        .ok()
        .and_then(|raw| serde_json::from_str::<Vec<IpRow>>(&raw).ok())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| r.ip)
        .collect();

    AdminLists {
        ops: names(dir, "ops.json"),
        whitelist: names(dir, "whitelist.json"),
        banned,
        banned_ips,
        whitelist_on: props.get_or("white-list", "false") == "true",
        enforce_whitelist: props.get_or("enforce-whitelist", "false") == "true",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_all_three_lists() {
        let d = std::env::temp_dir().join(format!("cp-admin-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        fs::write(
            d.join("ops.json"),
            r#"[{"uuid":"x","name":"Steve","level":4}]"#,
        )
        .unwrap();
        fs::write(d.join("whitelist.json"), r#"[{"uuid":"y","name":"Alex"}]"#).unwrap();
        fs::write(
            d.join("banned-players.json"),
            r#"[{"uuid":"z","name":"Griefer","reason":"grief"}]"#,
        )
        .unwrap();
        fs::write(d.join("server.properties"), "white-list=true\n").unwrap();

        let l = read_lists(&d.to_string_lossy());
        assert_eq!(l.ops, vec!["Steve"]);
        assert_eq!(l.whitelist, vec!["Alex"]);
        assert_eq!(l.banned[0].name, "Griefer");
        assert_eq!(l.banned[0].reason.as_deref(), Some("grief"));
        assert!(l.whitelist_on);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn missing_files_are_empty_not_an_error() {
        let d = std::env::temp_dir().join("cp-admin-empty");
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        let l = read_lists(&d.to_string_lossy());
        assert!(l.ops.is_empty() && l.whitelist.is_empty() && l.banned.is_empty());
        assert!(!l.whitelist_on);
    }
}
