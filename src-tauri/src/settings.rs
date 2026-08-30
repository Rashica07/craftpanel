//! Stage 4 — structured view of `server.properties` for the settings panel.
//!
//! Two curated tiers plus the raw list:
//!  * `common`   — what most people touch
//!  * `advanced` — the knobs experienced admins reach for, each with a `help` note
//!  * `all`      — every key, for hand-editing

use std::path::Path;

use serde::Serialize;

use crate::properties::Properties;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingField {
    pub key: String,
    pub label: String,
    pub value: String,
    /// "bool" | "int" | "enum" | "text"
    pub kind: &'static str,
    pub options: &'static [&'static str],
    pub help: Option<&'static str>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerSettings {
    pub present: bool,
    pub common: Vec<SettingField>,
    pub advanced: Vec<SettingField>,
    /// Every key in file order, for the raw editor.
    pub all: Vec<(String, String)>,
}

struct Spec {
    key: &'static str,
    label: &'static str,
    kind: &'static str,
    options: &'static [&'static str],
    default: &'static str,
    help: Option<&'static str>,
}

const fn s(
    key: &'static str,
    label: &'static str,
    kind: &'static str,
    options: &'static [&'static str],
    default: &'static str,
    help: Option<&'static str>,
) -> Spec {
    Spec { key, label, kind, options, default, help }
}

const DIFFICULTY: &[&str] = &["peaceful", "easy", "normal", "hard"];
const GAMEMODE: &[&str] = &["survival", "creative", "adventure", "spectator"];
const LEVEL_TYPE: &[&str] = &[
    "minecraft:normal",
    "minecraft:flat",
    "minecraft:large_biomes",
    "minecraft:amplified",
    "minecraft:single_biome_surface",
];
const COMPRESSION: &[&str] = &["deflate", "none"];

const COMMON: &[Spec] = &[
    s("motd", "MOTD", "text", &[], "A Minecraft Server", None),
    s("difficulty", "Difficulty", "enum", DIFFICULTY, "easy", None),
    s("gamemode", "Default game mode", "enum", GAMEMODE, "survival", None),
    s("max-players", "Max players", "int", &[], "20", None),
    s("pvp", "PvP", "bool", &[], "true", None),
    s("white-list", "Whitelist", "bool", &[], "false",
      Some("When on, only players in whitelist.json can join.")),
    s("online-mode", "Online mode (Mojang auth)", "bool", &[], "true",
      Some("Off = offline/cracked. Anyone can join under any name unless an auth mod enforces logins.")),
    s("allow-flight", "Allow flight", "bool", &[], "false",
      Some("Needed for elytra and some flight mods; without it the server kicks 'flying' players.")),
    s("hardcore", "Hardcore", "bool", &[], "false", None),
    s("enable-command-block", "Command blocks", "bool", &[], "false", None),
    s("spawn-protection", "Spawn protection radius", "int", &[], "16",
      Some("Blocks around spawn only ops can build in. 0 disables it.")),
];

const ADVANCED: &[Spec] = &[
    s("view-distance", "View distance (chunks)", "int", &[], "10",
      Some("How far chunks are sent to clients. The single biggest RAM/bandwidth lever — 6–8 is fine for most.")),
    s("simulation-distance", "Simulation distance (chunks)", "int", &[], "10",
      Some("How far entities/redstone/crops actually tick. Lower = big CPU win. Often set below view-distance.")),
    s("network-compression-threshold", "Network compression threshold", "int", &[], "256",
      Some("Packets larger than this (bytes) get compressed. -1 disables compression (LAN only); 512 eases CPU on busy servers.")),
    s("max-tick-time", "Watchdog max tick time (ms)", "int", &[], "60000",
      Some("The watchdog kills the server if a tick hangs this long. Set to -1 to disable the watchdog while debugging.")),
    s("entity-broadcast-range-percentage", "Entity broadcast range %", "int", &[], "100",
      Some("How far entities are visible to clients, as a % of view-distance. 50–75 cuts entity packet spam.")),
    s("player-idle-timeout", "Idle kick (minutes)", "int", &[], "0",
      Some("Auto-kick AFK players after N minutes. 0 = never.")),
    s("pause-when-empty-seconds", "Pause when empty (seconds)", "int", &[], "60",
      Some("Newer servers idle the tick loop when no one's online. -1 keeps it always running (needed for AFK farms).")),
    s("sync-chunk-writes", "Synchronous chunk writes", "bool", &[], "true",
      Some("Safer on crash, but a latency spike on some disks. Many admins set this false on SSDs.")),
    s("use-native-transport", "Native transport (epoll/kqueue)", "bool", &[], "true",
      Some("Linux/macOS netty optimisation. Leave on unless it misbehaves.")),
    s("max-world-size", "Max world border (blocks)", "int", &[], "29999984", None),
    s("level-type", "Level type", "enum", LEVEL_TYPE, "minecraft:normal",
      Some("World generator. Only takes effect when the world is first created.")),
    s("level-seed", "Level seed", "text", &[], "",
      Some("Only used when generating a new world.")),
    s("spawn-monsters", "Spawn monsters", "bool", &[], "true", None),
    s("allow-nether", "Allow the Nether", "bool", &[], "true", None),
    s("enable-query", "GameSpy query protocol", "bool", &[], "false",
      Some("Lets server-list sites read player counts. Pairs with query.port.")),
    s("query.port", "Query port", "int", &[], "25565", None),
    s("prevent-proxy-connections", "Block proxy/VPN logins", "bool", &[], "false",
      Some("Rejects players whose ISP country doesn't match their Mojang session. Can false-positive.")),
    s("rate-limit", "Packet rate limit", "int", &[], "0",
      Some("Kick clients sending more than N packets/sec. 0 = off. 300–500 is a mild anti-crash setting.")),
    s("enforce-secure-profile", "Require signed chat", "bool", &[], "true",
      Some("Off allows unsigned chat / older clients; required off for most offline-mode setups.")),
    s("op-permission-level", "Op permission level", "int", &[], "4",
      Some("1 bypass spawn-protection · 2 /gamemode etc · 3 /ban · 4 /stop /op.")),
    s("function-permission-level", "Function permission level", "int", &[], "2", None),
    s("region-file-compression", "Region file compression", "enum", COMPRESSION, "deflate", None),
];

fn field(props: &Properties, spec: &Spec) -> SettingField {
    let value = props.get(spec.key).unwrap_or_else(|| spec.default.to_string());
    let note = if spec.key == "online-mode" && value == "false" {
        Some("This server is offline / cracked.".to_string())
    } else {
        None
    };
    SettingField {
        key: spec.key.to_string(),
        label: spec.label.to_string(),
        value,
        kind: spec.kind,
        options: spec.options,
        help: spec.help,
        note,
    }
}

pub fn read(server_dir: &str) -> ServerSettings {
    let props = Properties::load(Path::new(server_dir));
    if !props.existed() {
        return ServerSettings {
            present: false,
            common: Vec::new(),
            advanced: Vec::new(),
            all: Vec::new(),
        };
    }
    ServerSettings {
        present: true,
        common: COMMON.iter().map(|s| field(&props, s)).collect(),
        advanced: ADVANCED.iter().map(|s| field(&props, s)).collect(),
        all: props.entries(),
    }
}

/// Apply key→value changes, byte-preserving every untouched line.
/// Returns the keys that actually changed.
pub fn apply(server_dir: &str, changes: &[(String, String)]) -> Result<Vec<String>, String> {
    let dir = Path::new(server_dir);
    let mut props = Properties::load(dir);
    if !props.existed() {
        return Err("No server.properties yet — start the server once first.".into());
    }
    let mut changed = Vec::new();
    for (k, v) in changes {
        if !valid_key(k) {
            return Err(format!("Rejected suspicious key: {k}"));
        }
        if props.set(k, v) {
            changed.push(k.clone());
        }
    }
    props.save().map_err(|e| e.to_string())?;
    Ok(changed)
}

fn valid_key(k: &str) -> bool {
    !k.is_empty()
        && k.len() < 128
        && k.bytes().all(|b| b.is_ascii_alphanumeric() || b"-._".contains(&b))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn dir_with(s: &str) -> String {
        let d = std::env::temp_dir().join(format!("cp-set-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("server.properties"), s).unwrap();
        d.to_string_lossy().to_string()
    }

    #[test]
    fn reads_common_advanced_and_flags_offline_mode() {
        let dir = dir_with("online-mode=false\ndifficulty=hard\nsimulation-distance=6\n");
        let s = read(&dir);
        assert!(s.present);
        let om = s.common.iter().find(|f| f.key == "online-mode").unwrap();
        assert_eq!(om.value, "false");
        assert!(om.note.is_some());
        let sim = s.advanced.iter().find(|f| f.key == "simulation-distance").unwrap();
        assert_eq!(sim.value, "6");
        assert!(sim.help.is_some());
    }

    #[test]
    fn apply_is_surgical() {
        let dir = dir_with("#header\nonline-mode=false\npvp=true\nmotd=Old\n");
        let changed =
            apply(&dir, &[("motd".into(), "New".into()), ("pvp".into(), "true".into())]).unwrap();
        assert_eq!(changed, vec!["motd"]);
        let out = fs::read_to_string(Path::new(&dir).join("server.properties")).unwrap();
        assert!(out.contains("#header\n"));
        assert!(out.contains("online-mode=false\n"));
        assert!(out.contains("motd=New\n"));
    }

    #[test]
    fn rejects_bad_keys() {
        let dir = dir_with("motd=x\n");
        assert!(apply(&dir, &[("../evil".into(), "1".into())]).is_err());
    }
}
