//! Native Bedrock Dedicated Server support.
//!
//! Deliberately not full parity with the Java adapters yet — see
//! `ServerType::Bedrock`'s doc comment and ROADMAP.md's Batch 16 entry for
//! exactly what's covered vs. deferred. What's here: detect an existing
//! install, download+extract a fresh one, launch it, and tell running from
//! stopped by watching its console output.
//!
//! Three things verified against the *real* server, not assumed:
//!  - The download API (`net-secondary.web.minecraft-services.net`, the same
//!    one minecraft.net's own site calls, no auth) — confirmed live.
//!  - **No macOS build exists.** Only `serverBedrockWindows` and
//!    `serverBedrockLinux` — this has always been true, it isn't a gap in
//!    the API. `download()` returns a clear error on macOS rather than
//!    trying and failing obscurely.
//!  - The startup line is exactly `Server started.` — confirmed with
//!    `strings` on the actual `bedrock_server` ELF binary, since running it
//!    to observe real output isn't possible from a Mac (it's a Linux
//!    binary). Worth a real confirm-by-running on Windows before trusting
//!    this fully — flagged in ROADMAP.md.
//!
//! No published checksum for the download (unlike Adoptium's Java builds):
//! Mojang's download-links API doesn't provide one. HTTPS + Mojang's own
//! domain is the only integrity guarantee available here — the same trust
//! level `tunnel.rs`'s bore-client download already operates at, just
//! worth naming explicitly since this binary is much larger and runs with
//! more privilege (a real game server, not a relay client).

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::adapter::ServerStatus;
use crate::provision::{Progress, ProgressFn};

const UA: &str = "CraftPanel/0.1 (+https://github.com/) bedrock-install";
const LINKS_API: &str = "https://net-secondary.web.minecraft-services.net/api/v1.0/download/links";

pub fn bin_name() -> &'static str {
    if cfg!(windows) {
        "bedrock_server.exe"
    } else {
        "bedrock_server"
    }
}

/// `None` on macOS — there is no Bedrock Dedicated Server build for it, and
/// there never has been. Callers should check this before offering Bedrock
/// as a create option at all, not just at download time.
pub fn platform_supported() -> bool {
    cfg!(target_os = "windows") || cfg!(target_os = "linux")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BedrockDetection {
    pub launch_target: String,
}

/// Full scan used by the Add Server flow — mirrors `MinecraftAdapter::inspect`
/// in shape, but Bedrock has nothing equivalent to a version-history file to
/// pull an MC version out of, so there's just the one field.
pub fn inspect(path: &Path) -> Option<BedrockDetection> {
    let target = bin_name();
    if path.join(target).is_file() {
        Some(BedrockDetection { launch_target: target.to_string() })
    } else {
        None
    }
}

pub fn parse_status(text: &str) -> ServerStatus {
    let o = text.to_ascii_lowercase();
    if o.contains("server started.") {
        ServerStatus::Running
    } else if o.contains("stopping server") {
        ServerStatus::Stopping
    } else {
        ServerStatus::Unknown
    }
}

#[derive(Deserialize)]
struct LinksResponse {
    result: LinksResult,
}
#[derive(Deserialize)]
struct LinksResult {
    links: Vec<Link>,
}
#[derive(Deserialize)]
struct Link {
    #[serde(rename = "downloadType")]
    download_type: String,
    #[serde(rename = "downloadUrl")]
    download_url: String,
}

fn download_url() -> Result<String, String> {
    let want = if cfg!(windows) {
        "serverBedrockWindows"
    } else {
        "serverBedrockLinux"
    };
    let resp: LinksResponse = ureq::get(LINKS_API)
        .set("User-Agent", UA)
        .timeout(Duration::from_secs(20))
        .call()
        .map_err(|e| format!("Couldn't reach minecraft.net for the Bedrock server: {e}"))?
        .into_json()
        .map_err(|e| format!("minecraft.net returned something unexpected: {e}"))?;
    resp.result
        .links
        .into_iter()
        .find(|l| l.download_type == want)
        .map(|l| l.download_url)
        .ok_or_else(|| "Mojang didn't list a Bedrock server download for this platform.".into())
}

/// There's no version picker for Bedrock (see `list_versions` in
/// provision.rs — Mojang's API always serves "whatever's current"), so the
/// only place the actual version number shows up is the download filename
/// itself: `…/bedrock-server-1.26.45.1.zip` -> `"1.26.45.1"`.
fn version_from_url(url: &str) -> Option<String> {
    let name = url.rsplit('/').next()?;
    let stripped = name.strip_prefix("bedrock-server-")?;
    let stripped = stripped.strip_suffix(".zip").unwrap_or(stripped);
    (!stripped.is_empty()).then(|| stripped.to_string())
}

fn download_to(url: &str, dest: &Path, progress: &ProgressFn) -> Result<(), String> {
    let resp = ureq::get(url)
        .set("User-Agent", UA)
        .timeout(Duration::from_secs(300))
        .call()
        .map_err(|e| format!("download failed: {e}"))?;
    let total: u64 = resp.header("Content-Length").and_then(|s| s.parse().ok()).unwrap_or(0);
    let mut reader = resp.into_reader();
    let mut file = fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut buf = [0u8; 65536];
    let mut done: u64 = 0;
    loop {
        let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        done += n as u64;
        if total > 0 {
            let pct = ((done * 100) / total).min(100) as u8;
            progress(Progress {
                stage: "download".into(),
                message: format!("Downloading the Bedrock server… {} MB", done / 1_048_576),
                pct: Some(pct),
            });
        }
    }
    file.flush().map_err(|e| e.to_string())
}

/// Extracts the zip flat into `dest` — unlike the Java runtime archives,
/// Mojang's Bedrock zip has no wrapper folder; `bedrock_server` sits right
/// at the archive root alongside `behavior_packs/`, `server.properties`, etc.
fn extract_zip(archive_path: &Path, dest: &Path) -> Result<(), String> {
    let f = fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if name.ends_with('/') {
            continue;
        }
        let out = dest.join(&name);
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out_file = fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Download and unpack a fresh Bedrock server into `dest` (must already
/// exist and be empty — same contract as `provision::create`'s callers).
/// Returns the version string parsed out of the download filename, since
/// there's nowhere else to get it from (see `version_from_url`).
pub fn download(dest: &Path, progress: &ProgressFn) -> Result<String, String> {
    if !platform_supported() {
        return Err(
            "Bedrock Dedicated Server has no macOS build — Mojang only ships it for \
             Windows and Linux. This isn't a CraftPanel limitation; there's nothing \
             to install here on a Mac."
                .into(),
        );
    }

    progress(Progress {
        stage: "fetch".into(),
        message: "Finding the current Bedrock server build…".into(),
        pct: None,
    });
    let url = download_url()?;
    let version = version_from_url(&url).unwrap_or_else(|| "current".to_string());

    let tmp_dir = std::env::temp_dir().join("craftpanel-bedrock-install");
    fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
    let archive_path: PathBuf = tmp_dir.join("bedrock-server.zip");

    progress(Progress {
        stage: "download".into(),
        message: "Downloading the Bedrock server…".into(),
        pct: Some(0),
    });
    download_to(&url, &archive_path, progress)?;

    progress(Progress {
        stage: "extract".into(),
        message: "Extracting…".into(),
        pct: None,
    });
    extract_zip(&archive_path, dest)?;
    let _ = fs::remove_file(&archive_path);

    let bin = dest.join(bin_name());
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = fs::metadata(&bin) {
            let mut p = meta.permissions();
            p.set_mode(0o755);
            let _ = fs::set_permissions(&bin, p);
        }
    }
    if !bin.is_file() {
        return Err(
            "Extracted the download but couldn't find the server binary inside it — \
             Mojang may have changed the archive layout."
                .into(),
        );
    }

    progress(Progress {
        stage: "done".into(),
        message: "Bedrock server ready.".into(),
        pct: Some(100),
    });
    Ok(version)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_the_verified_startup_line() {
        assert_eq!(parse_status("[INFO] Server started."), ServerStatus::Running);
        assert_eq!(parse_status("NO LOG FILE! - setting up server logging..."), ServerStatus::Unknown);
        assert_eq!(parse_status("[INFO] Stopping server..."), ServerStatus::Stopping);
    }

    #[test]
    fn parses_version_out_of_the_real_url_shape() {
        assert_eq!(
            version_from_url("https://www.minecraft.net/bedrockdedicatedserver/bin-win/bedrock-server-1.26.45.1.zip"),
            Some("1.26.45.1".to_string()),
        );
        assert_eq!(version_from_url("https://example.com/not-a-bedrock-url.zip"), None);
    }

    #[test]
    fn inspect_finds_the_right_binary_name() {
        let d = std::env::temp_dir().join("cp-bedrock-inspect-test");
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        assert!(inspect(&d).is_none());
        fs::write(d.join(bin_name()), b"").unwrap();
        assert_eq!(inspect(&d).unwrap().launch_target, bin_name());
        let _ = fs::remove_dir_all(&d);
    }

    /// Real thing, end to end, same discipline as
    /// `javainstall::live_install_java_17_end_to_end`: hits the live Mojang
    /// API, downloads the real ~100MB archive, extracts it, confirms the
    /// binary is present and (on Unix) executable. Skipped on macOS since
    /// there's genuinely nothing to download there.
    #[test]
    #[ignore]
    fn live_download_bedrock_end_to_end() {
        if !platform_supported() {
            eprintln!("skipping: no Bedrock build for this platform (expected on macOS)");
            return;
        }
        let d = std::env::temp_dir().join("cp-bedrock-install-test");
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();

        let version = download(&d, &|p| println!("[{}] {} {:?}", p.stage, p.message, p.pct))
            .expect("download should succeed");
        assert!(!version.is_empty() && version != "current", "should parse a real version from the URL");

        let bin = d.join(bin_name());
        assert!(bin.is_file());
        assert!(d.join("server.properties").is_file());

        let _ = fs::remove_dir_all(&d);
    }
}
