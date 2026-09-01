//! Visual settings for a handful of very common plugins — EssentialsX,
//! LuckPerms, Geyser — instead of hand-editing YAML. Not a general YAML
//! parser or writer: line-based, indentation-aware lookup/replace for a
//! fixed, hand-verified list of keys per plugin (real keys, checked against
//! each project's actual shipped config/docs — see the `FIELDS` tables
//! below), same line-preserving discipline `settings.rs` already uses for
//! `server.properties` — every other byte in the file (comments, key
//! order, everything not in this list) is left exactly as it was.
//!
//! Deliberately small: these three plugins ship *hundreds* of settings
//! between them. This covers the handful worth a toggle/slider instead of
//! a text field — anything else, the file's still just a file, editable
//! as text in the Files tab like always.

use std::fs;
use std::path::Path;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FieldKind {
    Bool,
    Int,
    Text,
    Select,
}

struct FieldSpec {
    /// "key" for a top-level key, or "parent.key" for one level of nesting
    key: &'static str,
    label: &'static str,
    hint: &'static str,
    kind: FieldKind,
    options: &'static [&'static str],
    min: Option<i64>,
    max: Option<i64>,
}

struct KnownPlugin {
    id: &'static str,
    name: &'static str,
    /// candidate relative paths — first one that exists on disk wins
    paths: &'static [&'static str],
    fields: &'static [FieldSpec],
}

const ESSENTIALSX: KnownPlugin = KnownPlugin {
    id: "essentialsx",
    name: "EssentialsX",
    paths: &["plugins/Essentials/config.yml"],
    fields: &[
        FieldSpec { key: "currency-symbol", label: "Currency symbol", hint: "Shown before balances, e.g. in /balance.", kind: FieldKind::Text, options: &[], min: None, max: None },
        FieldSpec { key: "starting-balance", label: "Starting balance", hint: "What a new player's wallet starts with.", kind: FieldKind::Int, options: &[], min: Some(0), max: None },
        FieldSpec { key: "max-money", label: "Maximum balance", hint: "A wallet can't go above this.", kind: FieldKind::Int, options: &[], min: Some(0), max: None },
        FieldSpec { key: "min-money", label: "Minimum balance", hint: "How far into debt a wallet can go (usually 0 or negative).", kind: FieldKind::Int, options: &[], min: None, max: None },
        FieldSpec { key: "spawn-on-join", label: "Spawn on join", hint: "Send players to world spawn every time they join, not just the first time.", kind: FieldKind::Bool, options: &[], min: None, max: None },
        FieldSpec { key: "respawn-at-home", label: "Respawn at home", hint: "After dying, respawn at /sethome instead of world spawn.", kind: FieldKind::Bool, options: &[], min: None, max: None },
        FieldSpec { key: "teleport-safety", label: "Safe teleports", hint: "Nudge a teleport that would land inside a wall or over a void to the nearest safe spot.", kind: FieldKind::Bool, options: &[], min: None, max: None },
        FieldSpec { key: "is-water-safe", label: "Water counts as safe", hint: "Let /home, /spawn etc. land in water without being pushed elsewhere.", kind: FieldKind::Bool, options: &[], min: None, max: None },
    ],
};

const LUCKPERMS: KnownPlugin = KnownPlugin {
    id: "luckperms",
    name: "LuckPerms",
    paths: &["plugins/LuckPerms/config.yml"],
    fields: &[
        FieldSpec { key: "server", label: "Server name", hint: "Used for server-specific permissions. \"global\" applies everywhere.", kind: FieldKind::Text, options: &[], min: None, max: None },
        FieldSpec { key: "storage-method", label: "Storage method", hint: "Where permission/group data actually lives.", kind: FieldKind::Select, options: &["h2", "sqlite", "json", "yaml", "hocon", "mysql", "mariadb", "postgresql", "mongodb"], min: None, max: None },
        FieldSpec { key: "enable-ops", label: "Vanilla /op", hint: "Let vanilla server-operator status still work alongside LuckPerms.", kind: FieldKind::Bool, options: &[], min: None, max: None },
        FieldSpec { key: "auto-op", label: "Auto-op for admin group", hint: "Automatically grant vanilla op to anyone with admin permissions.", kind: FieldKind::Bool, options: &[], min: None, max: None },
        FieldSpec { key: "debug-logins", label: "Debug logins", hint: "Log extra detail about permission calculation on every join — noisy, diagnostic only.", kind: FieldKind::Bool, options: &[], min: None, max: None },
        FieldSpec { key: "allow-invalid-usernames", label: "Allow invalid usernames", hint: "Accept player names that don't match Minecraft's normal username rules (some proxies need this).", kind: FieldKind::Bool, options: &[], min: None, max: None },
    ],
};

const GEYSER: KnownPlugin = KnownPlugin {
    id: "geyser",
    name: "Geyser",
    paths: &[
        "plugins/Geyser-Spigot/config.yml",
        "config/Geyser-Fabric/config.yml",
        "config/geyser-neoforge/config.yml",
    ],
    fields: &[
        FieldSpec { key: "bedrock.address", label: "Listen address", hint: "Which network interface accepts Bedrock connections — 0.0.0.0 means all of them.", kind: FieldKind::Text, options: &[], min: None, max: None },
        FieldSpec { key: "bedrock.port", label: "Bedrock port", hint: "The UDP port Bedrock players connect to. Also shown on the Network tab.", kind: FieldKind::Int, options: &[], min: Some(1), max: Some(65535) },
        FieldSpec { key: "bedrock.clone-remote-port", label: "Match the Java port", hint: "Some hosts change your Java port on every restart — this keeps Bedrock's port matching it automatically.", kind: FieldKind::Bool, options: &[], min: None, max: None },
    ],
};

const KNOWN: &[KnownPlugin] = &[ESSENTIALSX, LUCKPERMS, GEYSER];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldView {
    pub key: String,
    pub label: String,
    pub hint: String,
    pub kind: FieldKind,
    pub options: Vec<String>,
    pub min: Option<i64>,
    pub max: Option<i64>,
    pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginConfigView {
    pub plugin: String,
    pub name: String,
    pub file: String,
    pub fields: Vec<FieldView>,
}

fn split_key(key: &str) -> (Option<&str>, &str) {
    match key.split_once('.') {
        Some((parent, child)) => (Some(parent), child),
        None => (None, key),
    }
}

fn strip_trailing_comment(s: &str) -> &str {
    // a '#' preceded by whitespace (or at the start) and not inside quotes
    let mut quote: Option<char> = None;
    let mut prev_ws = true;
    for (i, c) in s.char_indices() {
        match quote {
            Some(q) if c == q => quote = None,
            Some(_) => {}
            None if c == '\'' || c == '"' => quote = Some(c),
            None if c == '#' && prev_ws => return &s[..i],
            None => {}
        }
        prev_ws = c.is_whitespace();
    }
    s
}

fn clean_scalar(raw: &str) -> String {
    let t = strip_trailing_comment(raw).trim();
    if t.len() >= 2 {
        let b = t.as_bytes();
        if (b[0] == b'\'' && b[t.len() - 1] == b'\'') || (b[0] == b'"' && b[t.len() - 1] == b'"') {
            return t[1..t.len() - 1].to_string();
        }
    }
    t.to_string()
}

fn get_top_level(text: &str, key: &str) -> Option<String> {
    let prefix = format!("{key}:");
    text.lines()
        .filter(|l| !l.starts_with(' ') && !l.starts_with('\t'))
        .find_map(|l| l.strip_prefix(&prefix).map(clean_scalar))
}

fn get_nested(text: &str, parent: &str, key: &str) -> Option<String> {
    let parent_prefix = format!("{parent}:");
    let child_prefix = format!("{key}:");
    let mut in_block = false;
    for line in text.lines() {
        let indented = line.starts_with(' ') || line.starts_with('\t');
        if !indented {
            in_block = line.starts_with(&parent_prefix);
            continue;
        }
        if !in_block {
            continue;
        }
        if let Some(rest) = line.trim_start().strip_prefix(&child_prefix) {
            return Some(clean_scalar(rest));
        }
    }
    None
}

fn get_value(text: &str, key: &str) -> Option<String> {
    match split_key(key) {
        (None, k) => get_top_level(text, k),
        (Some(p), k) => get_nested(text, p, k),
    }
}

/// Replace one known key's value, quoting it if `quote`. Every other line
/// — comments, blank lines, everything else — passes through byte-for-byte.
fn set_value(text: &str, key: &str, new_value: &str, quote: bool) -> Result<String, String> {
    let (parent, child) = split_key(key);
    let formatted = if quote {
        format!("'{}'", new_value.replace('\'', "''"))
    } else {
        new_value.to_string()
    };
    let child_prefix = format!("{child}:");
    let parent_prefix = parent.map(|p| format!("{p}:"));

    let mut in_block = parent.is_none();
    let mut found = false;
    let mut out: Vec<String> = Vec::new();

    for line in text.lines() {
        let indented = line.starts_with(' ') || line.starts_with('\t');
        if let Some(pp) = &parent_prefix {
            if !indented {
                in_block = line.starts_with(pp.as_str());
                out.push(line.to_string());
                continue;
            }
            if !in_block {
                out.push(line.to_string());
                continue;
            }
        } else if indented {
            out.push(line.to_string());
            continue;
        }

        let trimmed = line.trim_start();
        let indent = &line[..line.len() - trimmed.len()];
        if !found && trimmed.starts_with(&child_prefix) {
            out.push(format!("{indent}{child}: {formatted}"));
            found = true;
        } else {
            out.push(line.to_string());
        }
    }

    if !found {
        return Err(format!(
            "'{key}' wasn't found in this file — it may have been removed or renamed past what CraftPanel expects. Edit it directly in the Files tab instead."
        ));
    }
    let mut result = out.join("\n");
    if text.ends_with('\n') {
        result.push('\n');
    }
    Ok(result)
}

fn find_file(server_dir: &Path, plugin: &KnownPlugin) -> Option<(String, String)> {
    for rel in plugin.paths {
        let p = server_dir.join(rel);
        if let Ok(text) = fs::read_to_string(&p) {
            return Some((rel.to_string(), text));
        }
    }
    None
}

/// Every known plugin whose config file actually exists in this server —
/// usually zero, one, or (Geyser + EssentialsX, say) a couple.
pub fn detect(server_dir: &str) -> Vec<PluginConfigView> {
    let dir = Path::new(server_dir);
    KNOWN
        .iter()
        .filter_map(|plugin| {
            let (rel, text) = find_file(dir, plugin)?;
            let fields = plugin
                .fields
                .iter()
                .map(|f| FieldView {
                    key: f.key.to_string(),
                    label: f.label.to_string(),
                    hint: f.hint.to_string(),
                    kind: f.kind,
                    options: f.options.iter().map(|s| s.to_string()).collect(),
                    min: f.min,
                    max: f.max,
                    value: get_value(&text, f.key),
                })
                .collect();
            Some(PluginConfigView {
                plugin: plugin.id.to_string(),
                name: plugin.name.to_string(),
                file: rel,
                fields,
            })
        })
        .collect()
}

/// Write one field back. `plugin_id` + `key` must match one of `KNOWN`'s
/// field specs — this never writes an arbitrary path the frontend made up.
pub fn set_field(server_dir: &str, plugin_id: &str, key: &str, value: &str) -> Result<(), String> {
    let plugin = KNOWN
        .iter()
        .find(|p| p.id == plugin_id)
        .ok_or_else(|| format!("Unknown plugin '{plugin_id}'."))?;
    let field = plugin
        .fields
        .iter()
        .find(|f| f.key == key)
        .ok_or_else(|| format!("'{key}' isn't a setting CraftPanel manages for {}.", plugin.name))?;

    if field.kind == FieldKind::Int {
        let n: i64 = value.parse().map_err(|_| "That needs to be a whole number.".to_string())?;
        if let Some(min) = field.min {
            if n < min {
                return Err(format!("{} can't go below {min}.", field.label));
            }
        }
        if let Some(max) = field.max {
            if n > max {
                return Err(format!("{} can't go above {max}.", field.label));
            }
        }
    }
    if field.kind == FieldKind::Select && !field.options.contains(&value) {
        return Err(format!("'{value}' isn't a valid {}.", field.label));
    }

    let dir = Path::new(server_dir);
    let (rel, text) = find_file(dir, plugin)
        .ok_or_else(|| format!("{}'s config file wasn't found — is it installed?", plugin.name))?;
    let quote = field.kind == FieldKind::Text;
    let updated = set_value(&text, key, value, quote)?;
    fs::write(dir.join(rel), updated).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ESX_SAMPLE: &str = "\
# comment
ops-name-color: '4'
currency-symbol: '$'
starting-balance: 0
max-money: 10000000000000
spawn-on-join: false
teleport-safety: true
";

    const GEYSER_SAMPLE: &str = "\
bedrock:
  # comment about address
  address: 0.0.0.0
  port: 19132
  clone-remote-port: false
remote:
  address: 127.0.0.1
  port: 25565
";

    #[test]
    fn reads_top_level_and_strips_quotes() {
        assert_eq!(get_top_level(ESX_SAMPLE, "currency-symbol"), Some("$".to_string()));
        assert_eq!(get_top_level(ESX_SAMPLE, "starting-balance"), Some("0".to_string()));
        assert_eq!(get_top_level(ESX_SAMPLE, "teleport-safety"), Some("true".to_string()));
        assert_eq!(get_top_level(ESX_SAMPLE, "nonexistent"), None);
    }

    #[test]
    fn reads_nested_and_stops_at_next_sibling_block() {
        assert_eq!(get_nested(GEYSER_SAMPLE, "bedrock", "port"), Some("19132".to_string()));
        assert_eq!(get_nested(GEYSER_SAMPLE, "bedrock", "address"), Some("0.0.0.0".to_string()));
        // "port" also exists under remote: — must not bleed across blocks
        assert_eq!(get_nested(GEYSER_SAMPLE, "remote", "port"), Some("25565".to_string()));
        assert_eq!(get_nested(GEYSER_SAMPLE, "bedrock", "not-here"), None);
    }

    #[test]
    fn set_top_level_preserves_everything_else() {
        let out = set_value(ESX_SAMPLE, "currency-symbol", "€", true).unwrap();
        assert!(out.contains("currency-symbol: '€'"));
        assert!(out.contains("# comment")); // untouched
        assert!(out.contains("ops-name-color: '4'")); // untouched
        assert_eq!(get_top_level(&out, "starting-balance"), Some("0".to_string())); // untouched
    }

    #[test]
    fn set_nested_only_touches_the_right_block() {
        let out = set_value(GEYSER_SAMPLE, "bedrock.port", "19133", false).unwrap();
        assert_eq!(get_nested(&out, "bedrock", "port"), Some("19133".to_string()));
        assert_eq!(get_nested(&out, "remote", "port"), Some("25565".to_string())); // untouched
        assert!(out.contains("# comment about address")); // untouched
    }

    #[test]
    fn set_missing_key_errors_instead_of_silently_appending() {
        assert!(set_value(ESX_SAMPLE, "does-not-exist", "x", false).is_err());
    }

    #[test]
    fn set_field_validates_int_range_and_select_options() {
        let d = std::env::temp_dir().join(format!("cp-plugincfg-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("plugins/Geyser-Spigot")).unwrap();
        fs::write(d.join("plugins/Geyser-Spigot/config.yml"), GEYSER_SAMPLE).unwrap();

        let dir = d.to_string_lossy().to_string();
        assert!(set_field(&dir, "geyser", "bedrock.port", "70000").is_err(), "port above 65535 should fail");
        assert!(set_field(&dir, "geyser", "bedrock.port", "19133").is_ok());
        let text = fs::read_to_string(d.join("plugins/Geyser-Spigot/config.yml")).unwrap();
        assert_eq!(get_nested(&text, "bedrock", "port"), Some("19133".to_string()));

        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn detect_finds_only_whats_actually_installed() {
        let d = std::env::temp_dir().join(format!("cp-plugincfg-detect-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("plugins/Essentials")).unwrap();
        fs::write(d.join("plugins/Essentials/config.yml"), ESX_SAMPLE).unwrap();

        let views = detect(&d.to_string_lossy());
        assert_eq!(views.len(), 1, "only EssentialsX is 'installed' in this fixture");
        assert_eq!(views[0].plugin, "essentialsx");
        let currency = views[0].fields.iter().find(|f| f.key == "currency-symbol").unwrap();
        assert_eq!(currency.value.as_deref(), Some("$"));

        let _ = fs::remove_dir_all(&d);
    }
}
