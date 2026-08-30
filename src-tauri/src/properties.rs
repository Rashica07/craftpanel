//! A line-preserving reader/writer for `server.properties`.
//!
//! Java's `.properties` format, kept deliberately conservative: we parse into an
//! ordered list of lines, only rewrite the lines whose key actually changed, and
//! leave comments, blanks, ordering and untouched entries byte-for-byte.

use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
enum Line {
    /// Comment or blank — kept verbatim.
    Raw(String),
    /// `key=value` entry. `raw` is the exact original line (None once rewritten).
    Entry { key: String, value: String, raw: Option<String> },
}

#[derive(Debug, Clone)]
pub struct Properties {
    path: PathBuf,
    lines: Vec<Line>,
    /// File ended with a newline.
    trailing_newline: bool,
    existed: bool,
}

impl Properties {
    pub fn load(dir: &Path) -> Self {
        let path = dir.join("server.properties");
        let text = fs::read_to_string(&path).ok();
        let existed = text.is_some();
        let text = text.unwrap_or_default();
        let trailing_newline = text.ends_with('\n') || text.is_empty();

        let mut lines = Vec::new();
        for raw in text.lines() {
            let trimmed = raw.trim_start();
            if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with('!') {
                lines.push(Line::Raw(raw.to_string()));
                continue;
            }
            match split_entry(raw) {
                Some((k, v)) => lines.push(Line::Entry {
                    key: k,
                    value: v,
                    raw: Some(raw.to_string()),
                }),
                None => lines.push(Line::Raw(raw.to_string())),
            }
        }

        Properties { path, lines, trailing_newline, existed }
    }

    pub fn existed(&self) -> bool {
        self.existed
    }

    pub fn get(&self, key: &str) -> Option<String> {
        self.lines.iter().rev().find_map(|l| match l {
            Line::Entry { key: k, value, .. } if k == key => Some(unescape(value)),
            _ => None,
        })
    }

    pub fn get_or(&self, key: &str, default: &str) -> String {
        self.get(key).unwrap_or_else(|| default.to_string())
    }

    /// Every `key=value` entry in file order (last wins on duplicates), unescaped.
    pub fn entries(&self) -> Vec<(String, String)> {
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for line in &self.lines {
            if let Line::Entry { key, .. } = line {
                if seen.insert(key.clone()) {
                    out.push((key.clone(), self.get(key).unwrap_or_default()));
                }
            }
        }
        out
    }

    /// Set (or insert) a key. Returns true if the stored value changed.
    pub fn set(&mut self, key: &str, value: &str) -> bool {
        let escaped = escape_value(value);
        for line in self.lines.iter_mut() {
            if let Line::Entry { key: k, value: v, raw } = line {
                if k == key {
                    if unescape(v) == value {
                        return false;
                    }
                    *v = escaped;
                    *raw = None; // force re-render of just this line
                    return true;
                }
            }
        }
        self.lines.push(Line::Entry {
            key: key.to_string(),
            value: escaped,
            raw: None,
        });
        true
    }

    pub fn render(&self) -> String {
        let mut out = String::new();
        for (i, line) in self.lines.iter().enumerate() {
            if i > 0 {
                out.push('\n');
            }
            match line {
                Line::Raw(s) => out.push_str(s),
                Line::Entry { key, value, raw } => match raw {
                    Some(original) => out.push_str(original),
                    None => {
                        out.push_str(key);
                        out.push('=');
                        out.push_str(value);
                    }
                },
            }
        }
        if self.trailing_newline && !out.is_empty() {
            out.push('\n');
        }
        out
    }

    pub fn save(&self) -> std::io::Result<()> {
        fs::write(&self.path, self.render())
    }
}

fn split_entry(raw: &str) -> Option<(String, String)> {
    // key ends at the first unescaped '=' or ':'
    let bytes = raw.as_bytes();
    let mut i = 0;
    let mut escaped = false;
    // skip leading whitespace for the key
    while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') {
        i += 1;
    }
    let key_start = i;
    while i < bytes.len() {
        let c = bytes[i];
        if escaped {
            escaped = false;
        } else if c == b'\\' {
            escaped = true;
        } else if c == b'=' || c == b':' {
            let key = raw[key_start..i].trim_end().to_string();
            let value = raw[i + 1..].trim_start().to_string();
            if key.is_empty() {
                return None;
            }
            return Some((key, value));
        }
        i += 1;
    }
    None
}

fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('t') => out.push('\t'),
            Some('u') => {
                let hex: String = chars.by_ref().take(4).collect();
                if let Ok(n) = u32::from_str_radix(&hex, 16) {
                    if let Some(ch) = char::from_u32(n) {
                        out.push(ch);
                    }
                }
            }
            Some(other) => out.push(other), // \: \= \\ \space
            None => {}
        }
    }
    out
}

/// Minimal, safe escaping for values we write (booleans, ports, passwords, MOTD).
fn escape_value(v: &str) -> String {
    let mut out = String::with_capacity(v.len());
    for (i, c) in v.chars().enumerate() {
        match c {
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            ' ' if i == 0 => out.push_str("\\ "),
            _ => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir_with(contents: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("cp-props-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("server.properties"), contents).unwrap();
        d
    }

    #[test]
    fn reads_values_including_escaped_colon() {
        let d = dir_with("#head\nlevel-type=minecraft\\:normal\nserver-port=25565\nmotd=Hi there\n");
        let p = Properties::load(&d);
        assert_eq!(p.get("level-type").as_deref(), Some("minecraft:normal"));
        assert_eq!(p.get("server-port").as_deref(), Some("25565"));
        assert_eq!(p.get("motd").as_deref(), Some("Hi there"));
        assert_eq!(p.get("nope"), None);
    }

    #[test]
    fn set_only_touches_its_own_line() {
        let original = "#Minecraft server properties\n#Sat Aug 29\nenable-rcon=false\nonline-mode=false\nmotd=A Minecraft Server\n";
        let d = dir_with(original);
        let mut p = Properties::load(&d);

        assert!(p.set("enable-rcon", "true"));
        assert!(!p.set("online-mode", "false")); // unchanged -> no-op
        assert!(p.set("rcon.password", "abc123")); // new key -> appended

        let out = p.render();
        assert!(out.contains("#Minecraft server properties\n#Sat Aug 29\n"));
        assert!(out.contains("enable-rcon=true\n"));
        assert!(out.contains("online-mode=false\n"));
        assert!(out.contains("motd=A Minecraft Server\n"));
        assert!(out.trim_end().ends_with("rcon.password=abc123"));
        // online-mode line is byte-identical to the original
        assert!(out.contains("\nonline-mode=false\n"));
    }

    #[test]
    fn handles_missing_file() {
        let d = std::env::temp_dir().join("cp-props-missing");
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        let mut p = Properties::load(&d);
        assert!(!p.existed());
        p.set("enable-rcon", "true");
        assert_eq!(p.render(), "enable-rcon=true\n");
    }
}
