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
        return 21;
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
    }

    #[test]
    fn warns_only_on_real_mismatch() {
        let j17 = JavaInfo { path: "java".into(), raw: String::new(), major: 17, is_64bit: true };
        assert!(compatibility_warning(&j17, Some("1.20.1")).is_none());
        assert!(compatibility_warning(&j17, Some("1.21.1")).is_some());
        assert!(compatibility_warning(&j17, None).is_none());
    }
}
