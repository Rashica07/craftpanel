//! Java runtime detection and Minecraft-version compatibility checks.

use std::process::Command;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaInfo {
    /// Executable we probed (`java` or an absolute path).
    pub path: String,
    /// Raw first line of `java -version`.
    pub raw: String,
    /// Parsed feature version: 8, 11, 17, 21, ...
    pub major: u32,
    /// "64-Bit" present in the banner.
    pub is_64bit: bool,
}

/// Probe a Java executable. `exe` defaults to `java` on $PATH.
pub fn probe(exe: Option<&str>) -> Option<JavaInfo> {
    let exe = exe.unwrap_or("java");
    let output = Command::new(exe).arg("-version").output().ok()?;
    // `java -version` prints to stderr.
    let text = if !output.stderr.is_empty() {
        String::from_utf8_lossy(&output.stderr).to_string()
    } else {
        String::from_utf8_lossy(&output.stdout).to_string()
    };
    let first = text.lines().next().unwrap_or("").trim().to_string();
    let major = parse_major(&text)?;
    Some(JavaInfo {
        path: exe.to_string(),
        raw: first,
        major,
        is_64bit: text.contains("64-Bit"),
    })
}

/// Parse the feature version out of a `java -version` banner.
///
/// `openjdk version "1.8.0_361"` -> 8
/// `openjdk version "17.0.8"`    -> 17
/// `java version "21" 2023-09-19` -> 21
fn parse_major(text: &str) -> Option<u32> {
    let start = text.find('"')?;
    let rest = &text[start + 1..];
    let end = rest.find('"')?;
    let ver = &rest[..end];
    let mut parts = ver.split(['.', '_', '-']);
    let first = parts.next()?;
    if first == "1" {
        parts.next()?.parse().ok()
    } else {
        first.parse().ok()
    }
}

/// Minimum Java feature version Mojang requires for a given MC version.
pub fn required_java_for_mc(mc_version: &str) -> u32 {
    let (major, minor, patch) = parse_mc(mc_version);
    if major != 1 {
        // Mojang's year-based scheme (e.g. "26.1") replaced "1.x" starting
        // with 2026 releases — 26.0 and up ship needing Java 25+, not 21.
        return if major >= 26 { 25 } else { 21 };
    }
    match minor {
        0..=16 => 8,
        17 => 16,
        18..=19 => 17,
        20 if patch <= 4 => 17,
        20 => 21, // 1.20.5+
        _ => 21,  // 1.21+
    }
}

/// Finds an already-installed JDK matching `required_major`, without
/// needing the user to hunt one down and paste a path by hand — the real
/// gap this closes: someone installs a matching JDK (e.g. via Adoptium's
/// own installer, following exactly the advice CraftPanel's own error
/// message gives), and the app still didn't pick it up, because a bare
/// `java` on PATH keeps resolving to whatever the system's *default* JVM
/// is, not whatever was just installed alongside it — normal multi-JDK
/// behavior on every OS, just not obvious.
///
/// macOS asks the OS's own JVM registry (`/usr/libexec/java_home`) rather
/// than guessing install paths — the same tool `java_home` itself uses,
/// so it finds anything any installer (Adoptium, Oracle, Homebrew's cask,
/// SDKMAN, …) registered, not just one vendor's layout. Windows has no
/// equivalent registry query, so it scans the handful of real install
/// roots every mainstream JDK installer actually uses. Every candidate is
/// verified with a real `probe()` before being trusted — a stale
/// directory name is never good enough on its own.
pub fn find_compatible_java(required_major: u32) -> Option<String> {
    #[cfg(target_os = "macos")]
    {
        for spec in [required_major.to_string(), format!("1.{required_major}")] {
            let out = Command::new("/usr/libexec/java_home").arg("-v").arg(&spec).output().ok()?;
            if !out.status.success() {
                continue;
            }
            let home = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if home.is_empty() {
                continue;
            }
            let candidate = format!("{home}/bin/java");
            if let Some(info) = probe(Some(&candidate)) {
                if info.major == required_major {
                    return Some(candidate);
                }
            }
        }
        return None;
    }

    #[cfg(target_os = "windows")]
    {
        let roots = [
            r"C:\Program Files\Eclipse Adoptium",
            r"C:\Program Files\Java",
            r"C:\Program Files (x86)\Eclipse Adoptium",
            r"C:\Program Files (x86)\Java",
        ];
        for root in roots {
            let Ok(entries) = std::fs::read_dir(root) else { continue };
            for entry in entries.filter_map(|e| e.ok()) {
                let candidate = entry.path().join("bin").join("java.exe");
                if !candidate.is_file() {
                    continue;
                }
                if let Some(info) = probe(candidate.to_str()) {
                    if info.major == required_major {
                        return Some(candidate.to_string_lossy().into_owned());
                    }
                }
            }
        }
        return None;
    }

    #[allow(unreachable_code)]
    {
        None
    }
}

/// Human-readable compatibility note, or `None` if the pairing is fine.
pub fn compatibility_warning(java: &JavaInfo, mc_version: Option<&str>) -> Option<String> {
    let mc = mc_version?;
    let need = required_java_for_mc(mc);
    if java.major < need {
        Some(format!(
            "Minecraft {mc} needs Java {need}+, but the detected runtime is Java {}. \
             The server will fail to start until you install a newer JDK.",
            java.major
        ))
    } else if java.major > need + 4 && need <= 8 {
        Some(format!(
            "Minecraft {mc} expects Java {need}. Java {} usually still works but is untested by Mojang for this version.",
            java.major
        ))
    } else {
        None
    }
}

fn parse_mc(v: &str) -> (u32, u32, u32) {
    let mut it = v.trim().split('.').map(|p| {
        p.chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse::<u32>()
            .unwrap_or(0)
    });
    (it.next().unwrap_or(0), it.next().unwrap_or(0), it.next().unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_legacy_and_modern_banners() {
        assert_eq!(parse_major("openjdk version \"1.8.0_361\"\n"), Some(8));
        assert_eq!(parse_major("openjdk version \"17.0.8\" 2023-07-18\n"), Some(17));
        assert_eq!(parse_major("java version \"21\" 2023-09-19 LTS\n"), Some(21));
        assert_eq!(parse_major("openjdk version \"11.0.20.1\"\n"), Some(11));
    }

    #[test]
    fn maps_mc_versions_to_required_java() {
        assert_eq!(required_java_for_mc("1.8.9"), 8);
        assert_eq!(required_java_for_mc("1.16.5"), 8);
        assert_eq!(required_java_for_mc("1.17.1"), 16);
        assert_eq!(required_java_for_mc("1.18.2"), 17);
        assert_eq!(required_java_for_mc("1.20.1"), 17);
        assert_eq!(required_java_for_mc("1.20.4"), 17);
        assert_eq!(required_java_for_mc("1.20.6"), 21);
        assert_eq!(required_java_for_mc("1.21.1"), 21);
        // the year-based scheme that replaced "1.x" starting in 2026
        assert_eq!(required_java_for_mc("26.0"), 25);
        assert_eq!(required_java_for_mc("26.1"), 25);
    }

    /// Not asserting a *found* JDK — that depends entirely on what's
    /// actually installed on whatever machine runs this test. Just that
    /// asking for something that can never exist returns `None` cleanly
    /// rather than panicking (a bad `java_home`/directory-scan parse is
    /// exactly the kind of thing that should degrade to "didn't find
    /// one," never crash the whole create-server flow).
    #[test]
    fn find_compatible_java_returns_none_for_an_impossible_version() {
        assert!(find_compatible_java(3).is_none());
    }

    /// The real happy path — machine-dependent (needs a real JDK matching
    /// `probe(None)`'s own major installed), so `#[ignore]`d like this
    /// file's other environment-dependent tests. Confirms this actually
    /// finds a real, working `java` binary, not just returns *a* string.
    #[test]
    #[ignore]
    fn find_compatible_java_locates_the_currently_running_jdk() {
        let mine = probe(None).expect("this machine needs a java on PATH to run this test");
        let found = find_compatible_java(mine.major).expect("should find the JDK that's clearly installed");
        let info = probe(Some(&found)).expect("the path found should itself be a working java");
        assert_eq!(info.major, mine.major);
    }

    #[test]
    fn warns_only_on_real_mismatch() {
        let j17 = JavaInfo { path: "java".into(), raw: String::new(), major: 17, is_64bit: true };
        assert!(compatibility_warning(&j17, Some("1.20.1")).is_none());
        assert!(compatibility_warning(&j17, Some("1.21.1")).is_some());
        assert!(compatibility_warning(&j17, None).is_none());
    }
}
