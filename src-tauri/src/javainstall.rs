//! Downloads and installs a Java runtime (Eclipse Temurin, via the Adoptium
//! API) for when a server needs one and none is on PATH. Shared across every
//! server — installed once per major version, not once per server.
//!
//! Only ships **17**, **21**, and **25**: between them they cover every
//! currently supported Minecraft version (see `java::required_java_for_mc`)
//! — 25 for the year-based scheme (26.0+) that replaced "1.x" starting in
//! 2026. Very old Minecraft needing Java 8, or the narrow 1.17-only Java 16
//! requirement, isn't covered — substituting a newer JVM under a genuinely
//! old modded server is its own can of worms, so `offerable_feature`
//! returns `None` rather than guess.
//!
//! Mirrors the download/verify pattern already used for server jars
//! (`provision.rs`) and the tunnel client (`tunnel.rs`): stream to a temp
//! file, verify a real checksum before trusting the bytes, only *then*
//! extract and mark anything executable. A checksum mismatch deletes the
//! download and fails loudly rather than running it anyway.

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Deserialize;

use crate::java::JavaInfo;
use crate::provision::{Progress, ProgressFn};

const UA: &str = "CraftPanel/0.1 (+https://github.com/) java-install";
const API: &str = "https://api.adoptium.net/v3/assets/latest";

fn os_name() -> &'static str {
    if cfg!(target_os = "macos") {
        "mac"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "linux"
    }
}

fn arch_name() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else {
        "x64"
    }
}

fn bin_name() -> &'static str {
    if cfg!(windows) {
        "java.exe"
    } else {
        "java"
    }
}

/// Adoptium packages macOS builds as a full `.jdk` bundle — the real
/// `JAVA_HOME` is nested at `Contents/Home/` inside the extracted archive.
/// Linux and Windows extract flat (`bin/`, `lib/`, … right at the top).
/// Confirmed against the actual archives for all three platforms, not
/// assumed — see the `live_install_java_17_end_to_end` test.
fn home_subdir() -> &'static [&'static str] {
    if cfg!(target_os = "macos") {
        &["Contents", "Home"]
    } else {
        &[]
    }
}

/// Which bundled feature version (17, 21, or 25) satisfies a given requirement —
/// see the module doc for why 8 and 16 aren't covered.
pub fn offerable_feature(required_java: u32) -> Option<u8> {
    match required_java {
        17 => Some(17),
        21 => Some(21),
        25 => Some(25),
        _ => None,
    }
}

/// Where a feature version's runtime lives once installed — the archive's
/// extraction root, *not* necessarily `JAVA_HOME` itself (see `java_home`).
pub fn install_dir(app_data_dir: &Path, feature: u8) -> PathBuf {
    app_data_dir
        .join("jre")
        .join(feature.to_string())
        .join(format!("{}-{}", os_name(), arch_name()))
}

/// The actual `JAVA_HOME` inside an install dir — same as the install dir on
/// Linux/Windows, `<install_dir>/Contents/Home` on macOS.
fn java_home(dir: &Path) -> PathBuf {
    home_subdir().iter().fold(dir.to_path_buf(), |p, c| p.join(c))
}

/// Already installed? Returns the `java` binary path if so.
pub fn installed_path(app_data_dir: &Path, feature: u8) -> Option<PathBuf> {
    let p = java_home(&install_dir(app_data_dir, feature))
        .join("bin")
        .join(bin_name());
    p.is_file().then_some(p)
}

#[derive(Deserialize)]
struct Release {
    binary: Binary,
}
#[derive(Deserialize)]
struct Binary {
    package: Package,
}
#[derive(Deserialize)]
struct Package {
    link: String,
    checksum: String,
    name: String,
}

fn fetch_release(feature: u8) -> Result<Package, String> {
    let url = format!(
        "{API}/{feature}/hotspot?architecture={}&image_type=jre&os={}&vendor=eclipse",
        arch_name(),
        os_name(),
    );
    let releases: Vec<Release> = ureq::get(&url)
        .set("User-Agent", UA)
        .timeout(Duration::from_secs(20))
        .call()
        .map_err(|e| format!("Couldn't reach Adoptium to find a Java {feature} build: {e}"))?
        .into_json()
        .map_err(|e| format!("Adoptium returned something CraftPanel didn't expect: {e}"))?;
    releases
        .into_iter()
        .next()
        .map(|r| r.binary.package)
        .ok_or_else(|| {
            format!("No Java {feature} build published for this computer ({}-{}).", os_name(), arch_name())
        })
}

fn sha256_hex(path: &Path) -> Result<String, String> {
    use sha2::Digest as _;
    let mut f = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = sha2::Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
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
                message: format!("Downloading Java… {} MB", done / 1_048_576),
                pct: Some(pct),
            });
        }
    }
    file.flush().map_err(|e| e.to_string())
}

/// Extracts a `.tar.gz`, stripping the archive's single top-level folder
/// (`jdk-17.x+y-jre/…`) so everything lands as `dest/bin/java`, `dest/lib/…`.
fn extract_tar_gz(archive_path: &Path, dest: &Path) -> Result<(), String> {
    let f = fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let gz = flate2::read::GzDecoder::new(f);
    let mut ar = tar::Archive::new(gz);
    for entry in ar.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        if entry.header().entry_type().is_dir() {
            continue;
        }
        let path = entry.path().map_err(|e| e.to_string())?.into_owned();
        let mut comps = path.components();
        comps.next(); // drop the top-level jdk-xxx folder
        let rel: PathBuf = comps.collect();
        if rel.as_os_str().is_empty() {
            continue;
        }
        let out = dest.join(&rel);
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        entry.unpack(&out).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Same idea for `.zip`, on Windows. Uses raw name-splitting rather than the
/// zip crate's path-decoding helpers — archive paths are always `/`-joined
/// regardless of platform, so a plain split is all that's needed.
fn extract_zip(archive_path: &Path, dest: &Path) -> Result<(), String> {
    let f = fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if name.ends_with('/') {
            continue; // directory entry
        }
        let rel = match name.split_once('/') {
            Some((_, rest)) if !rest.is_empty() => rest,
            _ => continue,
        };
        let out = dest.join(rel);
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out_file = fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Download (if not already installed), verify, and extract a Java runtime.
/// Returns the probed `JavaInfo` for the installed `java` binary.
pub fn install(app_data_dir: &Path, feature: u8, progress: &ProgressFn) -> Result<JavaInfo, String> {
    if let Some(existing) = installed_path(app_data_dir, feature) {
        if let Some(info) = crate::java::probe(existing.to_str()) {
            progress(Progress {
                stage: "done".into(),
                message: "Already installed.".into(),
                pct: Some(100),
            });
            return Ok(info);
        }
    }

    progress(Progress {
        stage: "fetch".into(),
        message: format!("Finding a Java {feature} build for this computer…"),
        pct: None,
    });
    let pkg = fetch_release(feature)?;

    let tmp_dir = std::env::temp_dir().join("craftpanel-java-install");
    fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
    let archive_path = tmp_dir.join(&pkg.name);

    progress(Progress {
        stage: "download".into(),
        message: format!("Downloading {}…", pkg.name),
        pct: Some(0),
    });
    download_to(&pkg.link, &archive_path, progress)?;

    progress(Progress {
        stage: "verify".into(),
        message: "Verifying checksum".into(),
        pct: None,
    });
    let got = sha256_hex(&archive_path)?;
    if !got.eq_ignore_ascii_case(&pkg.checksum) {
        let _ = fs::remove_file(&archive_path);
        return Err(
            "The download didn't match the checksum Adoptium published, so CraftPanel \
             deleted it rather than run it. This is usually a flaky connection — try again."
                .into(),
        );
    }

    let dest = install_dir(app_data_dir, feature);
    let _ = fs::remove_dir_all(&dest); // clean slate if a previous partial install exists
    fs::create_dir_all(&dest).map_err(|e| e.to_string())?;

    progress(Progress {
        stage: "extract".into(),
        message: "Extracting…".into(),
        pct: None,
    });
    if pkg.name.ends_with(".zip") {
        extract_zip(&archive_path, &dest)?;
    } else {
        extract_tar_gz(&archive_path, &dest)?;
    }
    let _ = fs::remove_file(&archive_path);

    let bin = java_home(&dest).join("bin").join(bin_name());
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
            "Extracted the download but couldn't find java inside it — the archive layout \
             may have changed on Adoptium's end."
                .into(),
        );
    }

    progress(Progress {
        stage: "done".into(),
        message: "Java installed.".into(),
        pct: Some(100),
    });
    crate::java::probe(bin.to_str())
        .ok_or_else(|| "Installed Java, but couldn't get it to report a version.".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_offers_the_two_bundled_majors() {
        assert_eq!(offerable_feature(17), Some(17));
        assert_eq!(offerable_feature(21), Some(21));
        assert_eq!(offerable_feature(25), Some(25));
        assert_eq!(offerable_feature(8), None);
        assert_eq!(offerable_feature(16), None);
        assert_eq!(offerable_feature(11), None);
    }

    #[test]
    fn install_dir_is_scoped_per_feature_and_platform() {
        let a = install_dir(Path::new("/tmp/cp"), 17);
        let b = install_dir(Path::new("/tmp/cp"), 21);
        assert_ne!(a, b);
        assert!(a.to_string_lossy().contains("17"));
        assert!(a.to_string_lossy().contains(os_name()));
    }

    /// The real thing, end to end: hits the live Adoptium API, downloads a
    /// real ~40-190MB archive, verifies its checksum, extracts it, and
    /// confirms `java -version` reports major 17. This is the highest-risk
    /// code in the app (download + verify + execute a third-party binary),
    /// so it's worth actually running against the network, not just
    /// compiling — `cargo test -- --ignored` (or `--include-ignored`).
    #[test]
    #[ignore]
    fn live_install_java_17_end_to_end() {
        let d = std::env::temp_dir().join("cp-java-install-test");
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();

        assert!(installed_path(&d, 17).is_none(), "shouldn't be installed yet");

        let info = install(&d, 17, &|p| println!("[{}] {} {:?}", p.stage, p.message, p.pct))
            .expect("install should succeed");
        assert_eq!(info.major, 17, "probed major version should be 17");

        let path = installed_path(&d, 17).expect("should report installed now");
        assert!(path.is_file());

        // second call should short-circuit to the existing install, not
        // re-download
        let again = install(&d, 17, &|_| {}).expect("second install should reuse it");
        assert_eq!(again.major, 17);

        let _ = fs::remove_dir_all(&d);
    }
}
