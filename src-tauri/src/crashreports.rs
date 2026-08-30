//! Read `crash-reports/*.txt` — surface the latest crash, its cause line, and a
//! best guess at the culprit mod from the stack trace.

use std::fs;
use std::path::Path;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CrashReport {
    pub file: String,
    /// "2026-08-30 01:23:45" from the report, if present
    pub time: Option<String>,
    /// file mtime, unix — for sorting / "how long ago"
    pub mtime: i64,
    pub description: Option<String>,
    /// the top exception line, e.g. "java.lang.NullPointerException: ..."
    pub headline: Option<String>,
    /// best guess at the offending mod / package
    pub suspect: Option<String>,
}

const VANILLA_ROOTS: &[&str] = &[
    "net.minecraft",
    "net.minecraftforge",
    "net.neoforged",
    "com.mojang",
    "java.",
    "javax.",
    "sun.",
    "jdk.",
    "io.netty",
    "cpw.mods",
    "net.fabricmc",
    "org.spongepowered",
    "org.slf4j",
    "org.apache",
    "com.google",
    "it.unimi",
    "oshi.",
    "joptsimple",
];

fn mtime(p: &Path) -> i64 {
    fs::metadata(p)
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn parse(file: &str, mtime: i64, text: &str) -> CrashReport {
    let mut time = None;
    let mut description = None;
    let mut headline = None;

    for line in text.lines() {
        let t = line.trim();
        if let Some(v) = t.strip_prefix("Time: ") {
            time = Some(v.trim().to_string());
        } else if let Some(v) = t.strip_prefix("Description: ") {
            description = Some(v.trim().to_string());
        } else if headline.is_none()
            && (t.contains("Exception") || t.contains("Error"))
            && (t.contains('.') || t.contains(':'))
            && !t.starts_with("at ")
            && !t.starts_with("//")
            && !t.starts_with('#')
        {
            headline = Some(t.to_string());
        }
    }

    // explicit "Suspected Mods:" (Forge) wins
    let suspect = text
        .lines()
        .find_map(|l| {
            let t = l.trim();
            t.strip_prefix("Suspected Mods:")
                .map(|s| s.trim().trim_end_matches('.').to_string())
                .filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case("None"))
        })
        .or_else(|| suspect_from_stack(text));

    CrashReport {
        file: file.to_string(),
        time,
        mtime,
        description,
        headline,
        suspect,
    }
}

fn suspect_from_stack(text: &str) -> Option<String> {
    for line in text.lines() {
        let t = line.trim();
        let Some(rest) = t.strip_prefix("at ") else { continue };
        // "at pkg.sub.Class.method(Class.java:12) ~[mod.jar:?]"
        let path = rest.split('(').next().unwrap_or("");
        if path.is_empty() || VANILLA_ROOTS.iter().any(|r| path.starts_with(r)) {
            continue;
        }
        // jar hint in brackets: ~[coolmod-1.2.jar:?]
        if let Some(b) = rest.split_once('[') {
            let jar = b.1.split([':', ']']).next().unwrap_or("");
            if jar.ends_with(".jar") && !jar.contains("minecraft") && !jar.contains("forge") {
                return Some(jar.to_string());
            }
        }
        let root: Vec<&str> = path.split('.').take(2).collect();
        if root.len() == 2 {
            return Some(root.join("."));
        }
    }
    None
}

pub fn latest(server_dir: &str) -> Option<CrashReport> {
    list(server_dir).into_iter().next()
}

pub fn list(server_dir: &str) -> Vec<CrashReport> {
    let dir = Path::new(server_dir).join("crash-reports");
    let mut reports: Vec<CrashReport> = Vec::new();
    if let Ok(rd) = fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) != Some("txt") {
                continue;
            }
            let name = e.file_name().to_string_lossy().to_string();
            let mt = mtime(&p);
            let text = fs::read_to_string(&p).unwrap_or_default();
            reports.push(parse(&name, mt, &text));
        }
    }
    reports.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    reports.truncate(20);
    reports
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"---- Minecraft Crash Report ----
// Who set us up the TNT?

Time: 2026-08-30 01:23:45
Description: Exception in server tick loop

java.lang.NullPointerException: Cannot invoke "..." because "x" is null
	at net.minecraft.server.MinecraftServer.tickServer(MinecraftServer.java:100)
	at com.example.coolmod.TickHandler.onTick(TickHandler.java:42) ~[coolmod-1.2.3.jar:?]
	at net.minecraft.server.MinecraftServer.tickChildren(MinecraftServer.java:80)
"#;

    #[test]
    fn extracts_fields_and_culprit_jar() {
        let r = parse("crash.txt", 0, SAMPLE);
        assert_eq!(r.time.as_deref(), Some("2026-08-30 01:23:45"));
        assert_eq!(r.description.as_deref(), Some("Exception in server tick loop"));
        assert!(r.headline.as_deref().unwrap().starts_with("java.lang.NullPointerException"));
        assert_eq!(r.suspect.as_deref(), Some("coolmod-1.2.3.jar"));
    }

    #[test]
    fn falls_back_to_package_root() {
        let s = SAMPLE.replace(" ~[coolmod-1.2.3.jar:?]", "");
        let r = parse("c.txt", 0, &s);
        assert_eq!(r.suspect.as_deref(), Some("com.example"));
    }

    #[test]
    fn no_reports_dir_is_empty() {
        assert!(list("/no/such/server").is_empty());
    }
}
