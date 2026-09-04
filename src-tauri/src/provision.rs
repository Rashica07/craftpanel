//! Stage 2.5 — create a server from scratch: pick loader + version, download the
//! artifact, first-boot it to generate configs, accept the EULA.
//!
//! HTTP is blocking (`ureq`); the command layer runs `create()` on a thread and
//! forwards `Progress` events to the UI.

use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha1::Digest as _;

use crate::adapter::ServerType;

const UA: &str = "CraftPanel/0.1 (+https://github.com/) server-manager";
const FIRST_BOOT_TIMEOUT: Duration = Duration::from_secs(240);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Loader {
    Vanilla,
    Paper,
    /// Unlike every other loader here, there's no downloadable jar —
    /// Spigot's license requires everyone to compile their own via
    /// Mojang/Spigot's own `BuildTools.jar`. See [`build_spigot`].
    Spigot,
    Fabric,
    Neoforge,
    Forge,
    /// Native Bedrock Dedicated Server — see `bedrock.rs`. Windows/Linux
    /// only; no macOS build exists.
    Bedrock,
}

impl Loader {
    fn server_type(&self) -> ServerType {
        match self {
            Loader::Vanilla => ServerType::Vanilla,
            Loader::Paper => ServerType::Paper,
            Loader::Spigot => ServerType::Spigot,
            Loader::Fabric => ServerType::Fabric,
            // NeoForge is detected/stored as Forge for now (see ROADMAP).
            Loader::Neoforge | Loader::Forge => ServerType::Forge,
            Loader::Bedrock => ServerType::Bedrock,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct VersionInfo {
    pub id: String,
    /// "release" | "snapshot" | "beta" | ...
    pub kind: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateSpec {
    pub loader: Loader,
    pub mc_version: String,
    /// loader build (Fabric loader, NeoForge/Forge version); ignored for vanilla.
    pub loader_version: Option<String>,
    pub dir: String,
    pub name: String,
    pub ram_mb: u32,
    pub java_path: Option<String>,
    /// User ticked the EULA box in the wizard.
    pub accept_eula: bool,
    /// Optional starting settings written to server.properties after first-boot.
    #[serde(default)]
    pub seed: Option<String>,
    #[serde(default)]
    pub gamemode: Option<String>,
    #[serde(default)]
    pub difficulty: Option<String>,
    #[serde(default)]
    pub motd: Option<String>,
    #[serde(default)]
    pub max_players: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub stage: String,
    pub message: String,
    /// 0..=100 when known.
    pub pct: Option<u8>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Created {
    pub server_type: ServerType,
    pub launch_target: String,
    pub mc_version: String,
    pub dir: String,
}

pub type ProgressFn = dyn Fn(Progress) + Send + Sync;

// --- version listing -----------------------------------------------------------

pub fn list_versions(loader: Loader) -> Result<Vec<VersionInfo>, String> {
    match loader {
        Loader::Vanilla => mojang_versions(),
        Loader::Paper => paper_versions(),
        Loader::Spigot => spigot_versions(),
        Loader::Fabric => fabric_game_versions(),
        Loader::Neoforge => neoforge_versions(),
        Loader::Forge => forge_versions(),
        // Mojang's download API always serves "whatever's current" — there's
        // no historical version picker for Bedrock like there is for Java.
        // One synthetic entry so the wizard's existing version-list UI works
        // unchanged instead of needing a special case.
        Loader::Bedrock => Ok(vec![VersionInfo { id: "current".into(), kind: "release".into() }]),
    }
}

fn get_json(url: &str) -> Result<serde_json::Value, String> {
    ureq::get(url)
        .set("User-Agent", UA)
        .timeout(Duration::from_secs(20))
        .call()
        .map_err(|e| format!("{url}: {e}"))?
        .into_json()
        .map_err(|e| format!("{url}: bad JSON: {e}"))
}

fn mojang_versions() -> Result<Vec<VersionInfo>, String> {
    let v = get_json("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")?;
    let arr = v["versions"].as_array().ok_or("no versions array")?;
    Ok(arr
        .iter()
        .filter_map(|e| {
            Some(VersionInfo {
                id: e["id"].as_str()?.to_string(),
                kind: e["type"].as_str().unwrap_or("release").to_string(),
            })
        })
        .collect())
}

fn paper_versions() -> Result<Vec<VersionInfo>, String> {
    let v = get_json("https://fill.papermc.io/v3/projects/paper")?;
    let families = v["versions"].as_object().ok_or("no versions map")?;
    let mut out = Vec::new();
    for list in families.values() {
        if let Some(arr) = list.as_array() {
            for ver in arr {
                if let Some(s) = ver.as_str() {
                    let kind = if s.contains('-') { "snapshot" } else { "release" };
                    out.push(VersionInfo { id: s.to_string(), kind: kind.to_string() });
                }
            }
        }
    }
    // `families` is a `serde_json::Map` keyed by version family (e.g.
    // "1.20", "1.21") — iterating `.values()` walks those families in
    // whatever order the map happens to store them (insertion/hash
    // order, not numeric order), so without this the picker showed e.g.
    // the 1.16 family after the 1.21 one. Sort every version explicitly,
    // newest first, the same way every other version list in this file
    // already reads (Mojang's own manifest, Fabric's, NeoForge's).
    out.sort_by(|a, b| mc_version_key(&b.id).cmp(&mc_version_key(&a.id)));
    Ok(out)
}

/// Turns "1.21.1" / "1.8.9" / "1.21" into `(21, 1)`-style tuples so
/// Minecraft version strings compare numerically instead of
/// lexicographically (where "1.9" would wrongly sort after "1.10").
/// Handles the trailing `-` snapshot suffix Paper's own ids sometimes
/// carry (e.g. "1.21.4-rc1") by comparing on the numeric prefix alone.
fn mc_version_key(id: &str) -> Vec<u32> {
    id.split(['-', '+'])
        .next()
        .unwrap_or(id)
        .split('.')
        .map(|p| p.parse::<u32>().unwrap_or(0))
        .collect()
}

/// Real, hard-won fix — the original version of this reused Mojang's own
/// manifest filtered to 1.8+, on the assumption every Mojang release has
/// matching Spigot BuildData. It doesn't: verified live that
/// `hub.spigotmc.org/versions/1.8.9.json` 404s (1.8.9 was a client-only
/// patch — its server is byte-identical to 1.8.8's, so Spigot never
/// published separate BuildData for it) while `1.8.8.json` exists. Any
/// version picked from a Mojang-derived list could 404 deep into a
/// multi-minute BuildTools run with a useless-looking stack trace.
///
/// `hub.spigotmc.org/versions/` turns out to serve a real (if
/// undocumented) directory listing — scraping the `.json` filenames
/// there is the actual authoritative "can BuildTools build this" list,
/// confirmed against a live fetch: real MC versions carry a `.`
/// (`1.21.9`, `26.2`, `1.13-pre7`), and are mixed in with ~4000 bare
/// numeric entries (`1000`, `999`, `latest`, …) that are BuildTools'
/// own internal build-config revisions, not Minecraft versions — a
/// `.` in the id is what tells them apart.
fn spigot_versions() -> Result<Vec<VersionInfo>, String> {
    let body = ureq::get("https://hub.spigotmc.org/versions/")
        .set("User-Agent", UA)
        .timeout(Duration::from_secs(20))
        .call()
        .map_err(|e| format!("hub.spigotmc.org/versions/: {e}"))?
        .into_string()
        .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for chunk in body.split("href=\"").skip(1) {
        let Some(end) = chunk.find(".json\"") else { continue };
        let id = &chunk[..end];
        if id.is_empty() || !id.contains('.') || id.contains('/') {
            continue; // "../", and the ~4000 bare-number BuildTools revision files
        }
        out.push(VersionInfo {
            id: id.to_string(),
            kind: if id.contains('-') { "snapshot".into() } else { "release".into() },
        });
    }
    if out.is_empty() {
        return Err("hub.spigotmc.org/versions/ returned no usable versions".into());
    }
    out.sort_by(|a, b| mc_version_key(&b.id).cmp(&mc_version_key(&a.id)));
    Ok(out)
}

fn fabric_game_versions() -> Result<Vec<VersionInfo>, String> {
    let v = get_json("https://meta.fabricmc.net/v2/versions/game")?;
    let arr = v.as_array().ok_or("expected array")?;
    Ok(arr
        .iter()
        .filter_map(|e| {
            Some(VersionInfo {
                id: e["version"].as_str()?.to_string(),
                kind: if e["stable"].as_bool().unwrap_or(false) {
                    "release".into()
                } else {
                    "snapshot".into()
                },
            })
        })
        .collect())
}

fn neoforge_versions() -> Result<Vec<VersionInfo>, String> {
    let v = get_json(
        "https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge",
    )?;
    let arr = v["versions"].as_array().ok_or("no versions")?;
    Ok(arr
        .iter()
        .filter_map(|e| e.as_str())
        .map(|s| VersionInfo {
            id: s.to_string(),
            kind: if s.contains("beta") { "beta".into() } else { "release".into() },
        })
        .rev()
        .collect())
}

fn forge_versions() -> Result<Vec<VersionInfo>, String> {
    let v = get_json("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json")?;
    let promos = v["promos"].as_object().ok_or("no promos")?;
    let mut out = Vec::new();
    for (k, val) in promos {
        // keys look like "1.20.1-latest" / "1.20.1-recommended"
        if let Some(mc) = k.strip_suffix("-recommended").or_else(|| k.strip_suffix("-latest")) {
            if let Some(forge) = val.as_str() {
                out.push(VersionInfo {
                    id: format!("{mc}-{forge}"),
                    kind: if k.ends_with("recommended") { "release".into() } else { "beta".into() },
                });
            }
        }
    }
    Ok(out)
}

// --- creation ---------------------------------------------------------------

pub fn create(spec: &CreateSpec, progress: &ProgressFn) -> Result<Created, String> {
    let dir = Path::new(&spec.dir);
    fs::create_dir_all(dir).map_err(|e| format!("can't create folder: {e}"))?;
    if dir.read_dir().map(|mut d| d.next().is_some()).unwrap_or(false) {
        return Err("That folder isn't empty — pick a fresh folder for a new server.".into());
    }
    let java = spec.java_path.clone().unwrap_or_else(|| "java".to_string());

    let mut mc_version = spec.mc_version.clone();
    let (server_type, launch_target) = match spec.loader {
        Loader::Vanilla => (ServerType::Vanilla, download_vanilla(spec, dir, progress)?),
        Loader::Paper => (ServerType::Paper, download_paper(spec, dir, progress)?),
        Loader::Spigot => (ServerType::Spigot, build_spigot(spec, dir, &java, progress)?),
        Loader::Fabric => (ServerType::Fabric, download_fabric(spec, dir, progress)?),
        Loader::Neoforge | Loader::Forge => {
            (spec.loader.server_type(), run_installer(spec, dir, &java, progress)?)
        }
        Loader::Bedrock => {
            // Mojang's API has no version picker (see list_versions) — find
            // out what we actually got from the download URL itself rather
            // than reporting the wizard's placeholder "current".
            let (target, real_version) = download_bedrock(dir, progress)?;
            mc_version = real_version;
            (ServerType::Bedrock, target)
        }
    };

    // EULA — Bedrock Dedicated Server has no `eula.txt` mechanism at all
    // (see bedrock.rs / process::eula_accepted); the wizard's checkbox is
    // still the consent step, there's just no file to write here.
    if server_type != ServerType::Bedrock {
        progress(Progress { stage: "eula".into(), message: "Accepting the Minecraft EULA".into(), pct: None });
        fs::write(
            dir.join("eula.txt"),
            "# Accepted via CraftPanel — https://aka.ms/MinecraftEULA\neula=true\n",
        )
        .map_err(|e| e.to_string())?;
    }

    // First boot to generate server.properties / world / configs.
    first_boot(spec, dir, &java, &launch_target, server_type, progress)?;

    Ok(Created {
        server_type,
        launch_target,
        mc_version,
        dir: spec.dir.clone(),
    })
}

/// Swaps an *existing* server's jar/loader in place — world, plugins/mods,
/// configs, and everything else in the folder is left completely alone.
/// Only the launcher file itself changes.
///
/// Deliberately narrower than [`create`]: Forge/NeoForge need their
/// installer's multi-file output (`libraries/`, run scripts, …) replaced
/// as a set, and Bedrock is a whole different binary/versioning story —
/// both are real work for a follow-up, not attempted here. Vanilla/Paper/
/// Fabric are each just "download one jar to a known filename", which is
/// exactly what [`download_vanilla`]/[`download_paper`]/[`download_fabric`]
/// already do — reused as-is rather than duplicated.
pub fn change_version(
    rec: &crate::db::ServerRecord,
    loader: Loader,
    mc_version: String,
    loader_version: Option<String>,
    progress: &ProgressFn,
) -> Result<Created, String> {
    if !matches!(loader, Loader::Vanilla | Loader::Paper | Loader::Fabric) {
        return Err(
            "Changing to Forge, NeoForge, or Bedrock isn't supported yet — create a new server for that.".into(),
        );
    }
    let dir = Path::new(&rec.path);
    if !dir.is_dir() {
        return Err("Server folder not found.".into());
    }

    let spec = CreateSpec {
        loader,
        mc_version: mc_version.clone(),
        loader_version,
        dir: rec.path.clone(),
        name: rec.name.clone(),
        ram_mb: rec.ram_mb,
        java_path: Some(rec.java_path.clone()).filter(|s| !s.is_empty()),
        accept_eula: true, // already accepted when this server was first created
        seed: None,
        gamemode: None,
        difficulty: None,
        motd: None,
        max_players: None,
    };

    // best-effort: drop the old launcher file so a stale jar doesn't linger
    // and confuse a future "what's actually running here" — never touches
    // anything else in the folder.
    let old = dir.join(&rec.launch_target);
    if old.is_file() {
        let _ = fs::remove_file(&old);
    }

    let launch_target = match loader {
        Loader::Vanilla => download_vanilla(&spec, dir, progress)?,
        Loader::Paper => download_paper(&spec, dir, progress)?,
        Loader::Fabric => download_fabric(&spec, dir, progress)?,
        _ => unreachable!("checked above"),
    };

    Ok(Created {
        server_type: loader.server_type(),
        launch_target,
        mc_version,
        dir: rec.path.clone(),
    })
}

fn download_bedrock(dir: &Path, progress: &ProgressFn) -> Result<(String, String), String> {
    let version = crate::bedrock::download(dir, progress)?;
    Ok((crate::bedrock::bin_name().to_string(), version))
}

fn download_to(
    url: &str,
    dest: &Path,
    label: &str,
    progress: &ProgressFn,
) -> Result<(), String> {
    progress(Progress { stage: "download".into(), message: format!("Downloading {label}…"), pct: Some(0) });
    let resp = ureq::get(url)
        .set("User-Agent", UA)
        .timeout(Duration::from_secs(60))
        .call()
        .map_err(|e| format!("download failed: {e}"))?;

    let total: u64 = resp
        .header("Content-Length")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);

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
                message: format!("Downloading {label}… {} MB", done / 1_048_576),
                pct: Some(pct),
            });
        }
    }
    file.flush().map_err(|e| e.to_string())?;
    Ok(())
}

fn sha1_hex(path: &Path) -> Result<String, String> {
    let mut f = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = sha1::Sha1::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = f.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex(&hasher.finalize()))
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
    Ok(hex(&hasher.finalize()))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn download_vanilla(spec: &CreateSpec, dir: &Path, progress: &ProgressFn) -> Result<String, String> {
    let manifest = get_json("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json")?;
    let entry = manifest["versions"]
        .as_array()
        .and_then(|a| a.iter().find(|e| e["id"] == serde_json::json!(spec.mc_version)))
        .ok_or_else(|| format!("Minecraft {} not found", spec.mc_version))?;
    let pkg_url = entry["url"].as_str().ok_or("no package url")?;
    let pkg = get_json(pkg_url)?;
    let dl = &pkg["downloads"]["server"];
    let url = dl["url"].as_str().ok_or("this version has no server download")?;
    let want_sha1 = dl["sha1"].as_str().unwrap_or_default().to_string();

    let dest = dir.join("server.jar");
    download_to(url, &dest, "Minecraft server", progress)?;
    if !want_sha1.is_empty() {
        progress(Progress { stage: "verify".into(), message: "Verifying checksum".into(), pct: None });
        let got = sha1_hex(&dest)?;
        if got != want_sha1 {
            return Err(format!("checksum mismatch (sha1 {got} != {want_sha1})"));
        }
    }
    Ok("server.jar".to_string())
}

fn download_paper(spec: &CreateSpec, dir: &Path, progress: &ProgressFn) -> Result<String, String> {
    let builds = get_json(&format!(
        "https://fill.papermc.io/v3/projects/paper/versions/{}/builds",
        spec.mc_version
    ))?;
    let list = builds.as_array().ok_or("no builds")?;
    let build = list
        .iter()
        .find(|b| b["channel"] == serde_json::json!("STABLE"))
        .or_else(|| list.first())
        .ok_or("no usable build")?;
    let dl = &build["downloads"]["server:default"];
    let url = dl["url"].as_str().ok_or("no download url")?;
    let name = dl["name"].as_str().unwrap_or("paper.jar").to_string();
    let want = dl["checksums"]["sha256"].as_str().unwrap_or_default().to_string();

    let dest = dir.join(&name);
    download_to(url, &dest, &name, progress)?;
    if !want.is_empty() {
        progress(Progress { stage: "verify".into(), message: "Verifying checksum".into(), pct: None });
        let got = sha256_hex(&dest)?;
        if got != want {
            return Err(format!("checksum mismatch (sha256 {got} != {want})"));
        }
    }
    Ok(name)
}

fn download_fabric(spec: &CreateSpec, dir: &Path, progress: &ProgressFn) -> Result<String, String> {
    // newest stable loader + installer unless the wizard pinned one
    let loader = match &spec.loader_version {
        Some(v) => v.clone(),
        None => {
            let v = get_json("https://meta.fabricmc.net/v2/versions/loader")?;
            v.as_array()
                .and_then(|a| a.iter().find(|e| e["stable"].as_bool().unwrap_or(false)))
                .or_else(|| v.as_array().and_then(|a| a.first()))
                .and_then(|e| e["version"].as_str())
                .ok_or("no fabric loader")?
                .to_string()
        }
    };
    let installer = {
        let v = get_json("https://meta.fabricmc.net/v2/versions/installer")?;
        v.as_array()
            .and_then(|a| a.iter().find(|e| e["stable"].as_bool().unwrap_or(false)))
            .or_else(|| v.as_array().and_then(|a| a.first()))
            .and_then(|e| e["version"].as_str())
            .ok_or("no fabric installer")?
            .to_string()
    };
    let url = format!(
        "https://meta.fabricmc.net/v2/versions/loader/{}/{}/{}/server/jar",
        spec.mc_version, loader, installer
    );
    let dest = dir.join("fabric-server-launch.jar");
    download_to(&url, &dest, "Fabric server launcher", progress)?;
    Ok("fabric-server-launch.jar".to_string())
}

fn run_installer(
    spec: &CreateSpec,
    dir: &Path,
    java: &str,
    progress: &ProgressFn,
) -> Result<String, String> {
    let ver = spec
        .loader_version
        .clone()
        .ok_or("pick a loader version for NeoForge/Forge")?;

    let (url, installer_name, install_flag) = if spec.loader == Loader::Neoforge {
        (
            format!("https://maven.neoforged.net/releases/net/neoforged/neoforge/{ver}/neoforge-{ver}-installer.jar"),
            format!("neoforge-{ver}-installer.jar"),
            "--install-server",
        )
    } else {
        (
            format!("https://maven.minecraftforge.net/net/minecraftforge/forge/{ver}/forge-{ver}-installer.jar"),
            format!("forge-{ver}-installer.jar"),
            "--installServer",
        )
    };

    let installer_path = dir.join(&installer_name);
    download_to(&url, &installer_path, &installer_name, progress)?;

    progress(Progress {
        stage: "install".into(),
        message: "Running the loader installer (this takes a minute)…".into(),
        pct: None,
    });
    let out = Command::new(java)
        .current_dir(dir)
        .arg("-jar")
        .arg(&installer_name)
        .arg(install_flag)
        .output()
        .map_err(|e| format!("couldn't run installer: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "installer failed:\n{}",
            String::from_utf8_lossy(&out.stderr).chars().take(800).collect::<String>()
        ));
    }
    let _ = fs::remove_file(&installer_path);
    let _ = fs::remove_file(dir.join(format!("{installer_name}.log")));

    // Prefer the args-file launch path; fall back to run.sh.
    if crate::process::forge_args_file(dir).is_some() {
        Ok("run.sh".to_string()) // process::build_command resolves the args file
    } else if dir.join("run.sh").is_file() {
        Ok("run.sh".to_string())
    } else {
        Err("installer finished but produced no run script or args file".into())
    }
}

/// Spigot ships no downloadable server jar anywhere — its license requires
/// everyone to compile their own via Mojang/Spigot's own `BuildTools.jar`
/// (downloads Minecraft + Bukkit/CraftBukkit/Spigot source, then Maven-
/// builds it). Real multi-minute compile, not a download — the exact
/// tradeoff flagged to and accepted by the user before this was built.
///
/// `--compile SPIGOT` skips the CraftBukkit build entirely (BuildTools
/// otherwise compiles both by default) since nothing here ever launches
/// a CraftBukkit jar — meaningfully faster and lighter for no loss.
fn build_spigot(spec: &CreateSpec, dir: &Path, java: &str, progress: &ProgressFn) -> Result<String, String> {
    const BUILD_TIMEOUT: Duration = Duration::from_secs(25 * 60);

    // Fail fast, before downloading anything — BuildTools needs `git` on
    // PATH and will otherwise fail deep into the build with a much more
    // confusing error.
    if Command::new("git").arg("--version").output().is_err() {
        return Err("BuildTools needs git installed to compile Spigot — on macOS, run `xcode-select --install` (or install Xcode) to get it, then try again.".into());
    }

    // Old Minecraft versions need the JDK that was actually current when
    // they shipped — BuildTools enforces this itself (confirmed live: it
    // refuses outright rather than trying and failing weirdly). Rather
    // than pass through whatever `java` this server happens to be
    // configured with (almost always a modern one, since that's what
    // runs the actual server jar) and let BuildTools reject it, look for
    // a matching JDK the user may have separately installed — the real
    // gap this closes: a bare `java` on PATH doesn't automatically start
    // pointing at a JDK you just installed alongside your existing one.
    // Falls back to the passed-in `java` untouched if nothing better is
    // found, so this only ever helps, never blocks a build that would've
    // worked anyway.
    let required_java = crate::java::required_java_for_mc(&spec.mc_version);
    let build_java = match crate::java::find_compatible_java(required_java) {
        Some(found) => {
            progress(Progress {
                stage: "build".into(),
                message: format!("Found a Java {required_java} runtime installed — using it to compile Spigot {}.", spec.mc_version),
                pct: None,
            });
            found
        }
        None => java.to_string(),
    };

    let work = dir.join(".buildtools");
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let jar_path = work.join("BuildTools.jar");
    download_to(
        "https://hub.spigotmc.org/jenkins/job/BuildTools/lastSuccessfulBuild/artifact/target/BuildTools.jar",
        &jar_path,
        "BuildTools",
        progress,
    )?;

    progress(Progress {
        stage: "build".into(),
        message: format!("Compiling Spigot {} via BuildTools — this takes several minutes…", spec.mc_version),
        pct: None,
    });

    let result = (|| -> Result<String, String> {
        let mut child = Command::new(&build_java)
            .current_dir(&work)
            .args(["-jar", "BuildTools.jar", "--rev", &spec.mc_version, "--output-dir"])
            .arg(dir)
            .args(["--compile", "SPIGOT"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("couldn't launch BuildTools (is Java installed and on PATH?): {e}"))?;

        // Both streams feed one channel — BuildTools/Maven mix real
        // progress and errors across stdout/stderr, and the timeout loop
        // below only needs "is it still saying something," not which
        // stream it came from.
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        for stream in [child.stdout.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>), child.stderr.take().map(|s| Box::new(s) as Box<dyn std::io::Read + Send>)]
            .into_iter()
            .flatten()
        {
            let tx = tx.clone();
            std::thread::spawn(move || {
                let reader = BufReader::new(stream);
                for line in reader.lines().map_while(Result::ok) {
                    if tx.send(line).is_err() {
                        break;
                    }
                }
            });
        }
        drop(tx);

        // A single "last line seen" was close to useless for diagnosing a
        // real failure — Java prints the actual exception message *above*
        // its stack-trace frames, so the one line right before exit is
        // typically just "at some.deeply.Nested.method(File.java:60)"
        // with zero information in it. Keep a rolling tail instead, so
        // whatever actually explains the failure (an "Exception in
        // thread..." or "Caused by:" line) is still in view.
        const TAIL_LINES: usize = 40;
        let mut tail: std::collections::VecDeque<String> = std::collections::VecDeque::with_capacity(TAIL_LINES);

        let started = Instant::now();
        let mut last_report = Instant::now() - Duration::from_secs(10);
        loop {
            if started.elapsed() > BUILD_TIMEOUT {
                let _ = child.kill();
                return Err(format!(
                    "BuildTools didn't finish within {} minutes — either a very slow connection or it's stuck. Last output:\n{}",
                    BUILD_TIMEOUT.as_secs() / 60,
                    tail.iter().cloned().collect::<Vec<_>>().join("\n")
                ));
            }
            match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(line) => {
                    if last_report.elapsed() >= Duration::from_secs(2) {
                        last_report = Instant::now();
                        progress(Progress {
                            stage: "build".into(),
                            message: format!(
                                "Compiling Spigot via BuildTools… {}m{}s elapsed — {}",
                                started.elapsed().as_secs() / 60,
                                started.elapsed().as_secs() % 60,
                                line.chars().take(100).collect::<String>()
                            ),
                            pct: None,
                        });
                    }
                    if tail.len() == TAIL_LINES {
                        tail.pop_front();
                    }
                    tail.push_back(line);
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    if let Ok(Some(_)) = child.try_wait() {
                        break;
                    }
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }

        let status = child.wait().map_err(|e| e.to_string())?;
        if !status.success() {
            let full_tail = tail.iter().cloned().collect::<Vec<_>>().join("\n");

            // BuildTools gates old Minecraft versions on the JDK that was
            // actually current when they shipped — confirmed live: Java 25
            // building 1.8.8 fails immediately with this exact line, before
            // ever touching Mojang/Spigot source. CraftPanel deliberately
            // doesn't auto-*install* Java 8 (see `javainstall.rs`'s own doc
            // comment — substituting a newer JVM under genuinely old
            // software is its own can of worms), but it does now
            // auto-*detect* one if it's already on the machine (see
            // `find_compatible_java` above) — reaching this branch means
            // that search already ran and came up empty, so the real fix
            // is installing that JDK, not pasting a path anywhere by hand.
            if let Some(gate) = tail.iter().find(|l| l.contains("requires Java versions between")) {
                return Err(format!(
                    "{}. CraftPanel looked for an already-installed Java {required_java} and didn't find one — install one (Adoptium/Temurin publishes archived builds for every version) and try again; CraftPanel will pick it up automatically, no path to paste in.\n\nFull output:\n{full_tail}",
                    gate.trim_start_matches('*').trim()
                ));
            }
            // The other real failure mode hit during testing: picking a
            // Minecraft version Spigot never published BuildData for (e.g.
            // 1.8.9 — a client-only patch, server-identical to 1.8.8).
            if tail.iter().any(|l| l.contains("Could not get version") || l.contains("does it exist?")) {
                return Err(format!(
                    "Spigot has no build data for {} — it may be a client-only patch with no separate server (try the version just below it), or too new/old for BuildTools yet. Full output:\n{full_tail}",
                    spec.mc_version
                ));
            }

            return Err(format!(
                "BuildTools failed (make sure you have a full JDK, not just a JRE, and a working internet connection). Last output:\n{full_tail}"
            ));
        }

        // `--output-dir <dir>` makes BuildTools copy the finished jar
        // straight into the server folder — find whatever it actually
        // named it rather than guessing the exact filename.
        let jar = fs::read_dir(dir)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .find(|e| {
                let name = e.file_name().to_string_lossy().to_lowercase();
                name.starts_with("spigot-") && name.ends_with(".jar")
            })
            .ok_or("BuildTools finished but no spigot-*.jar showed up in the server folder")?;
        Ok(jar.file_name().to_string_lossy().into_owned())
    })();

    // BuildTools' own work dir (decompiled sources, Maven's local repo
    // copy, etc.) can run into the hundreds of MB to 1GB+ — always clean
    // it up, success or failure, rather than leaving it sitting in what's
    // supposed to be a plain server folder.
    let _ = fs::remove_dir_all(&work);
    result
}

fn first_boot(
    spec: &CreateSpec,
    dir: &Path,
    java: &str,
    launch_target: &str,
    server_type: ServerType,
    progress: &ProgressFn,
) -> Result<(), String> {
    progress(Progress {
        stage: "firstboot".into(),
        message: "Starting the server once to generate its config…".into(),
        pct: None,
    });

    let rec = crate::db::ServerRecord {
        id: String::new(),
        name: spec.name.clone(),
        path: spec.dir.clone(),
        server_type,
        launch_target: launch_target.to_string(),
        mc_version: Some(spec.mc_version.clone()),
        java_path: java.to_string(),
        ram_mb: spec.ram_mb.min(2048), // first boot is light
        created_at: 0,
        sync_code: None,
        keep_awake: false,
        jvm_args: None,
    };
    let mut cmd = crate::process::build_command(&rec)?;
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("first boot failed to launch: {e}"))?;

    // Drop a session file so a force-quit mid-create doesn't orphan this JVM —
    // the next launch re-adopts it instead of showing "external" forever.
    let pid = child.id();
    crate::session::write(
        dir,
        &crate::session::Session {
            pid,
            launcher_pid: std::process::id(),
            started_at: crate::session::now(),
            rcon_port: None,
            rcon_password: None,
        },
    );

    let mut stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let started = Instant::now();

    // Read stdout on its own thread so a quiet server can't wedge us past the
    // timeout (the old blocking `for line in reader.lines()` could hang forever).
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if tx.send(line).is_err() {
                break;
            }
        }
    });

    let mut ready = false;
    loop {
        if started.elapsed() > FIRST_BOOT_TIMEOUT {
            break;
        }
        match rx.recv_timeout(Duration::from_millis(500)) {
            Ok(line) => {
                let l = line.to_ascii_lowercase();
                let saw_ready = if server_type.is_bedrock() {
                    l.contains("server started.")
                } else {
                    l.contains("done (") && l.contains("for help")
                };
                if saw_ready {
                    ready = true;
                    break;
                }
                if l.contains("you need to agree to the eula") {
                    break;
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                // still booting (world-gen can be quiet) — loop, timeout guards us
                if let Ok(Some(_)) = child.try_wait() {
                    break; // it exited on its own
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    // Shut it down *cleanly* — a killed server leaves world/session.lock held,
    // which makes the user's very next Start fail to lock the world.
    let mut exited = false;
    if ready {
        let _ = writeln!(stdin, "stop");
        let _ = stdin.flush();
        for _ in 0..180 {
            // up to 90s for a graceful save+stop
            match child.try_wait() {
                Ok(Some(_)) => {
                    exited = true;
                    break;
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(500)),
                Err(_) => break,
            }
        }
    }
    if !exited {
        let _ = child.kill();
        let _ = child.wait();
    }
    // whatever happened, make sure nothing is still bound to the port
    let port = crate::external::port_of(dir);
    for orphan in crate::external::port_pids(port) {
        crate::session::force_kill(orphan);
    }
    // drop a stale lock so the next Start isn't blocked
    let level = crate::properties::Properties::load(dir)
        .get("level-name")
        .unwrap_or_else(|| "world".to_string());
    let _ = fs::remove_file(dir.join(&level).join("session.lock"));
    crate::session::clear(dir);
    // let the OS release file handles before the app can relaunch
    std::thread::sleep(Duration::from_millis(400));

    if !dir.join("server.properties").exists() {
        return Err(
            "first boot didn't generate server.properties — the Java version may be too old for this Minecraft version"
                .into(),
        );
    }
    progress(Progress { stage: "done".into(), message: "Server ready".into(), pct: Some(100) });
    Ok(())
}

// --- modpacks ----------------------------------------------------------------
//
// Modrinth `.mrpack` packs only — not CurseForge (their API needs an
// application-issued key, an ongoing liability for a key baked into a
// shipped app; Modrinth's is free and keyless, same as everything else this
// app already talks to). Format confirmed against a real downloaded pack
// (Fabulously Optimized, 2026-08-30), not just the spec doc:
// `modrinth.index.json` names the Minecraft version + loader + loader
// version in `dependencies`, lists every file with a hash and an
// `env.server` marker (required/optional/unsupported), and carries plain
// files to copy in under `overrides/` (always) and `server-overrides/`
// (server installs only, wins over `overrides/` on conflict).
//
// A modpack dictates its own loader + MC version — unlike a normal create,
// there's no picking one by hand — so this reuses the *existing*
// loader-specific provisioning (`download_fabric`, `run_installer`,
// `download_vanilla`) by building a synthetic `CreateSpec` from what the
// pack declares, rather than duplicating that logic.

#[derive(Debug, Clone, Deserialize)]
pub struct ModpackSpec {
    pub project_id: String,
    pub dir: String,
    pub name: String,
    pub ram_mb: u32,
    pub java_path: Option<String>,
    pub accept_eula: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModpackInfo {
    pub project_id: String,
    pub slug: String,
    pub title: String,
    pub description: String,
    pub icon_url: Option<String>,
    pub downloads: u64,
    /// e.g. "1.21.1" — the newest published version's target, for display
    /// before committing to a create.
    pub mc_version: Option<String>,
    pub loader: Option<String>,
}

#[derive(Deserialize)]
struct MrpackIndex {
    files: Vec<MrpackFile>,
    dependencies: std::collections::HashMap<String, String>,
}
#[derive(Deserialize)]
struct MrpackFile {
    path: String,
    hashes: MrpackHashes,
    #[serde(default)]
    env: Option<MrpackEnv>,
    downloads: Vec<String>,
}
#[derive(Deserialize)]
struct MrpackHashes {
    sha1: Option<String>,
}
#[derive(Deserialize)]
struct MrpackEnv {
    server: Option<String>,
}

/// A file with no `env` block at all is required on both sides per the
/// mrpack spec's own default — only an explicit "unsupported" excludes it.
fn server_wants(f: &MrpackFile) -> bool {
    f.env.as_ref().and_then(|e| e.server.as_deref()) != Some("unsupported")
}

/// Rejects anything that isn't a plain, contained relative path — a
/// malicious or corrupt pack's file list is untrusted input, and these
/// paths are about to become real filesystem writes.
fn safe_relative_path(p: &str) -> bool {
    let path = Path::new(p);
    !p.is_empty()
        && path.is_relative()
        && !p.contains('\0')
        && !path.components().any(|c| matches!(c, std::path::Component::ParentDir))
}

fn read_mrpack_index(archive_path: &Path) -> Result<MrpackIndex, String> {
    let f = fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    let mut entry = zip
        .by_name("modrinth.index.json")
        .map_err(|_| "This file doesn't look like a Modrinth modpack (.mrpack) — no modrinth.index.json inside.".to_string())?;
    let mut buf = String::new();
    entry.read_to_string(&mut buf).map_err(|e| e.to_string())?;
    serde_json::from_str(&buf).map_err(|e| format!("Couldn't read this modpack's manifest: {e}"))
}

/// Extracts everything under `overrides/` or `server-overrides/` in the
/// pack into `dest`, stripping that prefix. Silently does nothing if the
/// pack has no such folder — both are optional per the spec.
fn extract_mrpack_dir(archive_path: &Path, prefix: &str, dest: &Path) -> Result<(), String> {
    let f = fs::File::open(archive_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
    let want = format!("{prefix}/");
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        if name.ends_with('/') || !name.starts_with(&want) {
            continue;
        }
        let rel = &name[want.len()..];
        if !safe_relative_path(rel) {
            continue;
        }
        let out = dest.join(rel);
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out_file = fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut out_file).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The newest published version of a modpack — enough to show the picker in
/// the wizard what it's about to install without committing to it.
pub fn modpack_info(project_id: &str) -> Result<ModpackInfo, String> {
    let project = get_json(&format!("https://api.modrinth.com/v2/project/{project_id}"))?;
    let versions_val = get_json(&format!("https://api.modrinth.com/v2/project/{project_id}/version"))?;
    let versions = versions_val.as_array().cloned().unwrap_or_default();
    let latest = versions.first();
    let deps = latest.and_then(|v| v["dependencies"].as_object());
    let loader = deps.and_then(|d| {
        ["fabric-loader", "forge", "neoforge", "quilt-loader"]
            .iter()
            .find(|k| d.contains_key(**k))
            .map(|k| k.to_string())
    });
    Ok(ModpackInfo {
        project_id: project_id.to_string(),
        slug: project["slug"].as_str().unwrap_or(project_id).to_string(),
        title: project["title"].as_str().unwrap_or("").to_string(),
        description: project["description"].as_str().unwrap_or("").to_string(),
        icon_url: project["icon_url"].as_str().map(str::to_string),
        downloads: project["downloads"].as_u64().unwrap_or(0),
        mc_version: deps.and_then(|d| d.get("minecraft")).and_then(|v| v.as_str()).map(str::to_string),
        loader,
    })
}

pub fn create_from_modpack(spec: &ModpackSpec, progress: &ProgressFn) -> Result<Created, String> {
    let dir = Path::new(&spec.dir);
    fs::create_dir_all(dir).map_err(|e| format!("can't create folder: {e}"))?;
    if dir.read_dir().map(|mut d| d.next().is_some()).unwrap_or(false) {
        return Err("That folder isn't empty — pick a fresh folder for a new server.".into());
    }
    if !spec.accept_eula {
        return Err("You must accept the Minecraft EULA to create a server.".into());
    }
    let java = spec.java_path.clone().unwrap_or_else(|| "java".to_string());

    progress(Progress { stage: "fetch".into(), message: "Looking up the modpack…".into(), pct: None });
    let versions_val = get_json(&format!("https://api.modrinth.com/v2/project/{}/version", spec.project_id))?;
    let versions = versions_val.as_array().ok_or("Modrinth returned something unexpected for this modpack.")?;
    let version = versions.first().ok_or("This modpack has no published versions.")?;
    let files = version["files"].as_array().filter(|a| !a.is_empty()).ok_or("Modrinth didn't list any files for this modpack.")?;
    let primary = files
        .iter()
        .find(|f| f["primary"].as_bool().unwrap_or(false))
        .unwrap_or(&files[0]);
    let url = primary["url"].as_str().ok_or("Modpack file has no download URL.")?;
    let want_sha1 = primary["hashes"]["sha1"].as_str().unwrap_or_default().to_string();
    let filename = primary["filename"].as_str().unwrap_or("modpack.mrpack").to_string();

    let tmp_dir = std::env::temp_dir().join("craftpanel-modpack-install");
    fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
    let archive_path = tmp_dir.join(&filename);

    progress(Progress { stage: "download".into(), message: format!("Downloading {filename}…"), pct: Some(0) });
    download_to(url, &archive_path, "the modpack", progress)?;

    if !want_sha1.is_empty() {
        progress(Progress { stage: "verify".into(), message: "Verifying checksum".into(), pct: None });
        let got = sha1_hex(&archive_path)?;
        if got != want_sha1 {
            let _ = fs::remove_file(&archive_path);
            return Err(format!("checksum mismatch (sha1 {got} != {want_sha1}) — deleted rather than trust it"));
        }
    }

    progress(Progress { stage: "index".into(), message: "Reading the modpack manifest…".into(), pct: None });
    let index = read_mrpack_index(&archive_path)?;
    let mc_version = index
        .dependencies
        .get("minecraft")
        .cloned()
        .ok_or("This modpack doesn't specify a Minecraft version.")?;

    let (loader, loader_version) = if let Some(v) = index.dependencies.get("fabric-loader") {
        (Loader::Fabric, Some(v.clone()))
    } else if let Some(v) = index.dependencies.get("neoforge") {
        (Loader::Neoforge, Some(v.clone()))
    } else if let Some(v) = index.dependencies.get("forge") {
        (Loader::Forge, Some(v.clone()))
    } else if index.dependencies.contains_key("quilt-loader") {
        return Err(
            "This modpack needs Quilt, which CraftPanel doesn't provision yet — Fabric-only for now.".into(),
        );
    } else {
        (Loader::Vanilla, None)
    };

    let sub_spec = CreateSpec {
        loader,
        mc_version: mc_version.clone(),
        loader_version,
        dir: spec.dir.clone(),
        name: spec.name.clone(),
        ram_mb: spec.ram_mb,
        java_path: spec.java_path.clone(),
        accept_eula: spec.accept_eula,
        seed: None,
        gamemode: None,
        difficulty: None,
        motd: None,
        max_players: None,
    };

    progress(Progress {
        stage: "loader".into(),
        message: format!("Setting up {} {mc_version}…", loader.server_type().label()),
        pct: None,
    });
    let (server_type, launch_target) = match loader {
        Loader::Vanilla => (ServerType::Vanilla, download_vanilla(&sub_spec, dir, progress)?),
        Loader::Fabric => (ServerType::Fabric, download_fabric(&sub_spec, dir, progress)?),
        Loader::Neoforge | Loader::Forge => {
            (loader.server_type(), run_installer(&sub_spec, dir, &java, progress)?)
        }
        Loader::Paper | Loader::Spigot | Loader::Bedrock => unreachable!("never derived from mrpack dependencies"),
    };

    progress(Progress { stage: "eula".into(), message: "Accepting the Minecraft EULA".into(), pct: None });
    fs::write(
        dir.join("eula.txt"),
        "# Accepted via CraftPanel — https://aka.ms/MinecraftEULA\neula=true\n",
    )
    .map_err(|e| e.to_string())?;

    let wanted: Vec<&MrpackFile> = index.files.iter().filter(|f| server_wants(f)).collect();
    for (i, f) in wanted.iter().enumerate() {
        if !safe_relative_path(&f.path) {
            continue; // untrusted input — skip rather than risk a path-traversal write
        }
        let Some(file_url) = f.downloads.first() else { continue };
        let out = dir.join(&f.path);
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        progress(Progress {
            stage: "mods".into(),
            message: format!("Installing mods… {}/{}", i + 1, wanted.len()),
            pct: Some((((i + 1) * 100) / wanted.len().max(1)) as u8),
        });
        download_to(file_url, &out, &f.path, &|_| {})?; // per-file progress would be noisy at this granularity
        if let Some(want) = &f.hashes.sha1 {
            let got = sha1_hex(&out)?;
            if &got != want {
                return Err(format!("{}: checksum mismatch — the download may be corrupted, try again", f.path));
            }
        }
    }

    progress(Progress { stage: "overrides".into(), message: "Applying the pack's configs…".into(), pct: None });
    extract_mrpack_dir(&archive_path, "overrides", dir)?;
    extract_mrpack_dir(&archive_path, "server-overrides", dir)?; // wins on conflict — extracted second
    let _ = fs::remove_file(&archive_path);

    first_boot(&sub_spec, dir, &java, &launch_target, server_type, progress)?;

    Ok(Created { server_type, launch_target, mc_version, dir: spec.dir.clone() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loader_maps_to_server_type() {
        assert_eq!(Loader::Paper.server_type(), ServerType::Paper);
        assert_eq!(Loader::Neoforge.server_type(), ServerType::Forge);
    }

    /// Regression for the real ordering bug: Paper's own API groups
    /// versions by family in a `serde_json` map, whose iteration order
    /// isn't numeric — sorting by this key is what puts the whole list
    /// back in newest-first order regardless of what order the API
    /// happened to hand families back in.
    #[test]
    fn mc_version_key_orders_numerically_not_lexicographically() {
        let mut ids = vec!["1.9", "1.21.1", "1.10", "1.8.9", "1.21", "1.16.5"];
        ids.sort_by(|a, b| mc_version_key(b).cmp(&mc_version_key(a)));
        assert_eq!(ids, vec!["1.21.1", "1.21", "1.16.5", "1.10", "1.9", "1.8.9"]);
    }

    #[test]
    fn mc_version_key_handles_snapshot_suffixes() {
        // "1.21.4-rc1" must sort as 1.21.4, not get stuck comparing the
        // literal string "-rc1".
        assert!(mc_version_key("1.21.4-rc1") == mc_version_key("1.21.4"));
        assert!(mc_version_key("1.21.4") > mc_version_key("1.21"));
    }

    #[test]
    fn safe_relative_path_rejects_traversal_and_absolute_paths() {
        // these all came out of a real .mrpack's file list at some point in
        // testing — untrusted input from a third-party-authored zip, worth
        // exercising deliberately rather than trusting the happy path
        assert!(safe_relative_path("mods/sodium.jar"));
        assert!(safe_relative_path("config/nested/dir/file.toml"));
        assert!(!safe_relative_path("../../../etc/passwd"));
        assert!(!safe_relative_path("mods/../../../evil.jar"));
        assert!(!safe_relative_path("/etc/passwd"));
        assert!(!safe_relative_path(""));
    }

    #[test]
    fn server_wants_defaults_to_true_without_an_env_block() {
        let required = MrpackFile {
            path: "mods/a.jar".into(),
            hashes: MrpackHashes { sha1: None },
            env: Some(MrpackEnv { server: Some("required".into()) }),
            downloads: vec![],
        };
        let unsupported = MrpackFile {
            path: "mods/client-only.jar".into(),
            hashes: MrpackHashes { sha1: None },
            env: Some(MrpackEnv { server: Some("unsupported".into()) }),
            downloads: vec![],
        };
        let no_env = MrpackFile {
            path: "mods/b.jar".into(),
            hashes: MrpackHashes { sha1: None },
            env: None,
            downloads: vec![],
        };
        assert!(server_wants(&required));
        assert!(!server_wants(&unsupported));
        assert!(server_wants(&no_env)); // spec default: required if unstated
    }

    /// Real thing, end to end: hits the live Modrinth API, downloads an
    /// actual published modpack (Fabulously Optimized — Fabric, has both
    /// mods/ files and an overrides/ folder with real content), verifies
    /// its checksum, provisions the right loader for it, downloads every
    /// server-required file, applies overrides, and first-boots it. Same
    /// discipline as `javainstall`'s and `bedrock`'s live tests — this is
    /// the highest-surface-area new code in this batch, worth actually
    /// running against the network.
    #[test]
    #[ignore]
    fn live_create_from_real_modpack_end_to_end() {
        let d = std::env::temp_dir().join("cp-modpack-install-test");
        let _ = fs::remove_dir_all(&d);

        let spec = ModpackSpec {
            project_id: "fabulously-optimized".into(),
            dir: d.to_string_lossy().to_string(),
            name: "Modpack Test".into(),
            ram_mb: 3072,
            java_path: None,
            accept_eula: true,
        };

        let created = create_from_modpack(&spec, &|p| {
            println!("[{}] {} {:?}", p.stage, p.message, p.pct)
        })
        .expect("modpack create should succeed");

        assert_eq!(created.server_type, ServerType::Fabric);
        assert!(d.join("fabric-server-launch.jar").is_file());
        assert!(d.join("server.properties").exists(), "first boot should have run");
        assert!(d.join("eula.txt").exists());
        let mods: Vec<_> = fs::read_dir(d.join("mods")).unwrap().flatten().collect();
        assert!(mods.len() > 10, "expected a real mod list, got {}", mods.len());
        // this pack ships overrides/config/... — confirms extraction landed,
        // not just the mods/ downloads
        assert!(d.join("config").is_dir(), "overrides/ should have been applied");

        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn hex_encodes() {
        assert_eq!(hex(&[0x00, 0x0f, 0xff]), "000fff");
    }

    // network-dependent; run explicitly with `cargo test -- --ignored`
    #[test]
    #[ignore]
    fn lists_vanilla_versions() {
        let v = list_versions(Loader::Vanilla).unwrap();
        assert!(v.iter().any(|x| x.kind == "release"));
    }

    #[test]
    #[ignore]
    fn lists_every_loader() {
        for l in [Loader::Vanilla, Loader::Paper, Loader::Spigot, Loader::Fabric, Loader::Neoforge, Loader::Forge] {
            let v = list_versions(l).unwrap_or_else(|e| panic!("{l:?}: {e}"));
            assert!(!v.is_empty(), "{l:?} returned no versions");
        }
    }

    /// The real regression: 1.8.9 has no Spigot BuildData at all (it's a
    /// client-only Mojang patch, byte-identical server to 1.8.8) — a
    /// Mojang-manifest-derived list would happily offer it and then 404
    /// forty minutes into a BuildTools run. This must come from Spigot's
    /// own real listing, which simply never contains "1.8.9".
    #[test]
    #[ignore]
    fn spigot_versions_excludes_189_and_includes_recent_releases() {
        let v = list_versions(Loader::Spigot).unwrap();
        assert!(!v.iter().any(|x| x.id == "1.8.9"), "1.8.9 has no Spigot BuildData and must not be offered");
        assert!(v.iter().any(|x| x.id == "1.8.8"));
        assert!(v.iter().any(|x| x.id.starts_with("1.21") || x.id.starts_with("26.")));
        // no leaked BuildTools internal build-revision numbers ("1000", "999", "latest", …)
        assert!(v.iter().all(|x| x.id.contains('.')));
    }

    /// Full end-to-end: download + first-boot a real Paper server, enable RCON,
    /// launch it, query the player list over RCON, stop it.
    #[test]
    #[ignore]
    fn e2e_create_paper_then_rcon() {
        use crate::properties::Properties;
        use crate::rcon::RconClient;

        let dir = std::env::temp_dir().join(format!("cp-e2e-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        // a recent-ish stable Paper version that definitely exists
        let versions = list_versions(Loader::Paper).unwrap();
        let mc = versions
            .iter()
            .find(|v| v.kind == "release" && v.id.starts_with("1.21"))
            .map(|v| v.id.clone())
            .expect("a 1.21.x Paper release");

        let spec = CreateSpec {
            loader: Loader::Paper,
            mc_version: mc.clone(),
            loader_version: None,
            dir: dir.to_string_lossy().to_string(),
            name: "e2e".into(),
            ram_mb: 2048,
            java_path: None,
            accept_eula: true,
            seed: None,
            gamemode: None,
            difficulty: None,
            motd: None,
            max_players: None,
        };

        let created = create(&spec, &|p| eprintln!("[{}] {}", p.stage, p.message)).unwrap();
        assert_eq!(created.server_type, ServerType::Paper);
        assert!(dir.join("server.properties").exists());
        assert!(crate::process::eula_accepted(&dir, ServerType::Paper));

        // enable RCON
        let mut props = Properties::load(&dir);
        props.set("enable-rcon", "true");
        props.set("rcon.port", "25599");
        props.set("rcon.password", "e2epass");
        props.set("server-port", "25598");
        props.save().unwrap();

        // launch
        let rec = crate::db::ServerRecord {
            id: "e2e".into(),
            name: "e2e".into(),
            path: spec.dir.clone(),
            server_type: ServerType::Paper,
            launch_target: created.launch_target.clone(),
            mc_version: Some(mc),
            java_path: "java".into(),
            ram_mb: 2048,
            created_at: 0,
            sync_code: None,
            keep_awake: false,
            jvm_args: None,
        };
        let mut cmd = crate::process::build_command(&rec).unwrap();
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = cmd.spawn().unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();

        let mut ready = false;
        let mut tail: Vec<String> = Vec::new();
        let start = Instant::now();
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            eprintln!("  srv> {line}");
            tail.push(line.clone());
            if tail.len() > 20 {
                tail.remove(0);
            }
            if line.to_ascii_lowercase().contains("done (") {
                ready = true;
                break;
            }
            if start.elapsed() > Duration::from_secs(200) {
                break;
            }
        }
        // Run the RCON checks, but ALWAYS tear the server down afterwards —
        // otherwise a failed assertion leaks a Paper process holding the port.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            assert!(ready, "server never reported ready. last lines:\n{}", tail.join("\n"));
            std::thread::sleep(Duration::from_secs(1));
            let mut client = RconClient::connect(("127.0.0.1", 25599), "e2epass").unwrap();
            let out = client.command("list").unwrap();
            assert!(out.contains("players online"), "unexpected list output: {out}");
            eprintln!("  RCON /list -> {}", out.trim());
        }));

        let _ = writeln!(stdin, "stop");
        let _ = stdin.flush();
        for _ in 0..60 {
            if child.try_wait().ok().flatten().is_some() {
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        let _ = child.kill();
        let _ = child.wait();
        let _ = fs::remove_dir_all(&dir);

        if let Err(e) = result {
            std::panic::resume_unwind(e);
        }
    }
}
