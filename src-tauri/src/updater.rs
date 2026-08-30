//! Lightweight "is there a newer release?" check against GitHub Releases,
//! plus the real signed auto-install via `tauri-plugin-updater`.
//!
//! The endpoint is built at install time (not baked into `tauri.conf.json`)
//! because the GitHub repo is a per-install setting (`AppSettings.github_repo`)
//! — different builds of CraftPanel can point at different forks' releases.
//! CI signs release artifacts and publishes a `latest.json` manifest
//! alongside them (see `.github/workflows/release.yml`); the public key that
//! verifies that signature lives in `tauri.conf.json`.

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

/// Download and install the latest signed release, emitting `update:progress`
/// events as it goes. On success the frontend is expected to call the
/// process plugin's `relaunch()` — this function doesn't restart the app
/// itself, since a command that never returns is awkward to await from JS.
pub async fn install(app: &AppHandle, repo: Option<&str>) -> Result<(), String> {
    let repo = repo
        .map(str::trim)
        .filter(|s| s.contains('/'))
        .ok_or_else(|| "Set your GitHub repo in Settings to update.".to_string())?;

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
    fn no_repo_is_graceful() {
        let c = check(None);
        assert!(c.unavailable.is_some());
        assert!(!c.newer);
    }
}
