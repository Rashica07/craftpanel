//! Lightweight "is there a newer release?" check against GitHub Releases,
//! plus the real signed auto-install via `tauri-plugin-updater`.
//!
//! The repo is resolved once, at compile time, not read from a per-user
//! setting — nobody running CraftPanel should ever need to know or care
//! what repo it updates from. A fork points its own build at itself by
//! setting the `CRAFTPANEL_REPO` env var before `cargo build` (a CI secret
//! in their own copy of `.github/workflows/release.yml`, same mechanism as
//! `TAURI_SIGNING_PRIVATE_KEY` already uses there) — no source edit needed.
//! CI signs release artifacts and publishes a `latest.json` manifest
//! alongside them; the public key that verifies that signature lives in
//! `tauri.conf.json`.

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

use crate::provision::Progress;

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

/// CraftPanel's own repo — baked in at compile time, overridable by setting
/// `CRAFTPANEL_REPO` before building (see the module doc comment above).
const DEFAULT_REPO: &str = match option_env!("CRAFTPANEL_REPO") {
    Some(v) => v,
    None => "Rashica07/craftpanel",
};

/// Turns whatever a human typed or pasted into "GitHub repo" — a bare
/// `owner/repo`, a full `https://github.com/owner/repo` URL, one with a
/// trailing `.git` or slash, or (the bug that prompted this) `owner/repo`
/// with a stray `github.com/` still stuck on the front from a copy-paste —
/// into a clean `owner/repo`, or `None` if it still doesn't look like one.
fn normalize_repo(input: &str) -> Option<String> {
    let mut s = input.trim();
    for prefix in ["https://", "http://"] {
        s = s.strip_prefix(prefix).unwrap_or(s);
    }
    s = s.strip_prefix("www.").unwrap_or(s);
    // strip a leading "github.com/" — possibly more than once, matching
    // the exact "github.com/github.com/owner/repo" shape this was seen to
    // produce
    loop {
        let lower = s.to_ascii_lowercase();
        if let Some(rest) = lower.strip_prefix("github.com/") {
            s = &s[s.len() - rest.len()..];
        } else {
            break;
        }
    }
    let s = s.trim_matches('/').trim_end_matches(".git");
    let parts: Vec<&str> = s.split('/').collect();
    let [owner, repo] = parts.as_slice() else { return None };
    let valid = |p: &str| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.');
    if valid(owner) && valid(repo) {
        Some(format!("{owner}/{repo}"))
    } else {
        None
    }
}

/// `DEFAULT_REPO`, cleaned up — a defensive pass in case whoever set
/// `CRAFTPANEL_REPO` pasted a full URL instead of a bare `owner/repo`.
fn resolved_repo() -> String {
    normalize_repo(DEFAULT_REPO).unwrap_or_else(|| DEFAULT_REPO.to_string())
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

pub fn check() -> UpdateCheck {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let repo = resolved_repo();

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

/// Download and install the latest signed release, emitting `update:progress`
/// events as it goes. On success the frontend is expected to call the
/// process plugin's `relaunch()` — this function doesn't restart the app
/// itself, since a command that never returns is awkward to await from JS.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let repo = resolved_repo();

    let endpoint = format!("https://github.com/{repo}/releases/latest/download/latest.json")
        .parse()
        .map_err(|e| format!("bad update endpoint: {e}"))?;

    emit(app, "checking", "Checking for the latest release…", None);

    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;

    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No update available.".to_string())?;

    let app_chunk = app.clone();
    let app_done = app.clone();
    let mut downloaded: u64 = 0;
    let mut last_pct: i64 = -1;

    update
        .download_and_install(
            move |chunk_len, total_len| {
                downloaded += chunk_len as u64;
                let Some(total) = total_len.filter(|t| *t > 0) else {
                    return;
                };
                let pct = ((downloaded as f64 / total as f64) * 100.0).min(100.0) as u8;
                if pct as i64 != last_pct {
                    last_pct = pct as i64;
                    emit(
                        &app_chunk,
                        "downloading",
                        &format!("Downloading update… {pct}%"),
                        Some(pct),
                    );
                }
            },
            move || {
                emit(&app_done, "installing", "Installing update…", Some(100));
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    emit(app, "done", "Update installed. Restart to finish.", Some(100));
    Ok(())
}

fn emit(app: &AppHandle, stage: &str, message: &str, pct: Option<u8>) {
    let _ = app.emit(
        "update:progress",
        &Progress {
            stage: stage.into(),
            message: message.into(),
            pct,
        },
    );
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
    fn resolved_repo_is_default_repo_normalized() {
        assert_eq!(resolved_repo(), DEFAULT_REPO);
    }

    #[test]
    fn normalize_accepts_a_bare_owner_slash_repo() {
        assert_eq!(normalize_repo("someone/fork").as_deref(), Some("someone/fork"));
    }

    #[test]
    fn normalize_strips_scheme_and_host() {
        assert_eq!(
            normalize_repo("https://github.com/someone/fork").as_deref(),
            Some("someone/fork")
        );
        assert_eq!(
            normalize_repo("http://www.github.com/someone/fork").as_deref(),
            Some("someone/fork")
        );
    }

    #[test]
    fn normalize_strips_trailing_dot_git_and_slash() {
        assert_eq!(normalize_repo("someone/fork.git").as_deref(), Some("someone/fork"));
        assert_eq!(normalize_repo("someone/fork/").as_deref(), Some("someone/fork"));
        assert_eq!(
            normalize_repo("https://github.com/someone/fork/").as_deref(),
            Some("someone/fork")
        );
    }

    #[test]
    fn normalize_fixes_the_doubled_github_com_paste_bug() {
        // exactly the shape a copy-paste from a browser address bar into a
        // field that already expects "owner/repo" produced in practice
        assert_eq!(
            normalize_repo("github.com/Rashica07/craftpanel").as_deref(),
            Some("Rashica07/craftpanel")
        );
        assert_eq!(
            normalize_repo("github.com/github.com/Rashica07/craftpanel").as_deref(),
            Some("Rashica07/craftpanel")
        );
    }

    #[test]
    fn normalize_rejects_garbage() {
        assert_eq!(normalize_repo(""), None);
        assert_eq!(normalize_repo("not-a-repo-slug"), None);
        assert_eq!(normalize_repo("a/b/c"), None);
        assert_eq!(normalize_repo("has a space/repo"), None);
    }

    #[test]
    #[ignore] // hits the network — run explicitly with `cargo test -- --ignored`
    fn live_check_against_craftpanels_own_repo_is_reachable() {
        let c = check();
        assert!(c.unavailable.is_none(), "expected a real response: {:?}", c.unavailable);
    }
}
