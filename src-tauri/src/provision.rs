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
    Fabric,
    Neoforge,
    Forge,
}

impl Loader {
    fn server_type(&self) -> ServerType {
        match self {
            Loader::Vanilla => ServerType::Vanilla,
            Loader::Paper => ServerType::Paper,
            Loader::Fabric => ServerType::Fabric,
            // NeoForge is detected/stored as Forge for now (see ROADMAP).
            Loader::Neoforge | Loader::Forge => ServerType::Forge,
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
        Loader::Fabric => fabric_game_versions(),
        Loader::Neoforge => neoforge_versions(),
        Loader::Forge => forge_versions(),
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

    let (server_type, launch_target) = match spec.loader {
        Loader::Vanilla => (ServerType::Vanilla, download_vanilla(spec, dir, progress)?),
        Loader::Paper => (ServerType::Paper, download_paper(spec, dir, progress)?),
        Loader::Fabric => (ServerType::Fabric, download_fabric(spec, dir, progress)?),
        Loader::Neoforge | Loader::Forge => {
            (spec.loader.server_type(), run_installer(spec, dir, &java, progress)?)
        }
    };

    // EULA
    progress(Progress { stage: "eula".into(), message: "Accepting the Minecraft EULA".into(), pct: None });
    fs::write(
        dir.join("eula.txt"),
        "# Accepted via CraftPanel — https://aka.ms/MinecraftEULA\neula=true\n",
    )
    .map_err(|e| e.to_string())?;

    // First boot to generate server.properties / world / configs.
    first_boot(spec, dir, &java, &launch_target, server_type, progress)?;

    Ok(Created {
        server_type,
        launch_target,
        mc_version: spec.mc_version.clone(),
        dir: spec.dir.clone(),
    })
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
                if l.contains("done (") && l.contains("for help") {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loader_maps_to_server_type() {
        assert_eq!(Loader::Paper.server_type(), ServerType::Paper);
        assert_eq!(Loader::Neoforge.server_type(), ServerType::Forge);
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
        for l in [Loader::Vanilla, Loader::Paper, Loader::Fabric, Loader::Neoforge, Loader::Forge] {
            let v = list_versions(l).unwrap_or_else(|e| panic!("{l:?}: {e}"));
            assert!(!v.is_empty(), "{l:?} returned no versions");
        }
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
        assert!(crate::process::eula_accepted(&dir));

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
