//! Lightweight "is there a newer release?" check against GitHub Releases.
//! (Full signed auto-install via the Tauri updater is a follow-up — it needs
//! the CI to sign artifacts.)

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current: String,
    pub latest: Option<String>,
    pub newer: bool,
    pub url: Option<String>,
    pub notes: Option<String>,
    /// no repo configured / offline / no releases yet
    pub unavailable: Option<String>,
}

fn parse_semver(s: &str) -> (u64, u64, u64) {
    let s = s.trim().trim_start_matches('v');
    let mut it = s.split(['.', '-', '+']).filter_map(|p| p.parse::<u64>().ok());
    (
        it.next().unwrap_or(0),
        it.next().unwrap_or(0),
        it.next().unwrap_or(0),
    )
}

pub fn check(repo: Option<&str>) -> UpdateCheck {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let repo = match repo.map(str::trim).filter(|s| s.contains('/')) {
        Some(r) => r,
        None => {
            return UpdateCheck {
                current,
                latest: None,
                newer: false,
                url: None,
                notes: None,
                unavailable: Some("Set your GitHub repo in Settings to check for updates.".into()),
            }
        }
    };

    let url = format!("https://api.github.com/repos/{repo}/releases/latest");
    let resp = ureq::get(&url)
        .set("User-Agent", "CraftPanel")
        .set("Accept", "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(8))
        .call();

    let json: serde_json::Value = match resp.and_then(|r| r.into_json().map_err(Into::into)) {
        Ok(v) => v,
        Err(_) => {
            return UpdateCheck {
                current,
                latest: None,
                newer: false,
                url: None,
                notes: None,
                unavailable: Some("No published release yet, or couldn't reach GitHub.".into()),
            }
        }
    };

    let tag = json["tag_name"].as_str().unwrap_or("").to_string();
    let newer = !tag.is_empty() && parse_semver(&tag) > parse_semver(&current);
    UpdateCheck {
        newer,
        latest: (!tag.is_empty()).then(|| tag.clone()),
        url: json["html_url"].as_str().map(str::to_string),
        notes: json["body"]
            .as_str()
            .map(|b| b.lines().take(8).collect::<Vec<_>>().join("\n")),
        current,
        unavailable: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semver_compare() {
        assert!(parse_semver("v0.2.0") > parse_semver("0.1.9"));
        assert!(parse_semver("1.0.0") > parse_semver("0.9.9"));
        assert_eq!(parse_semver("0.1.0"), (0, 1, 0));
    }

    #[test]
    fn no_repo_is_graceful() {
        let c = check(None);
        assert!(c.unavailable.is_some());
        assert!(!c.newer);
    }
}
