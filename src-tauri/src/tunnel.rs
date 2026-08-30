//! In-app tunnel — no browser, no account. Bundles the `bore` client
//! (github.com/ekzhang/bore): one click gives `bore.pub:<port>` that works
//! from anywhere. The address is stable while the tunnel runs; it changes if
//! the tunnel is restarted. For a permanent custom address the user can still
//! paste a playit.gg address in the Network tab.

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

const BORE_VERSION: &str = "v0.6.0";

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TunnelStatus {
    pub running: bool,
    pub address: Option<String>,
    pub error: Option<String>,
}

struct Active {
    child: Arc<Mutex<Child>>,
    address: Arc<Mutex<Option<String>>>,
    error: Arc<Mutex<Option<String>>>,
}

pub struct TunnelManager {
    app: AppHandle,
    bin_dir: PathBuf,
    active: Mutex<HashMap<String, Active>>,
}

fn asset_name() -> Option<(&'static str, bool)> {
    // (github asset suffix, is_zip)
    let a = match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "x86_64") => ("x86_64-apple-darwin.tar.gz", false),
        ("macos", "aarch64") => ("aarch64-apple-darwin.tar.gz", false),
        ("windows", "x86_64") => ("x86_64-pc-windows-msvc.zip", true),
        ("linux", "x86_64") => ("x86_64-unknown-linux-musl.tar.gz", false),
        ("linux", "aarch64") => ("aarch64-unknown-linux-musl.tar.gz", false),
        _ => return None,
    };
    Some(a)
}

/// drop ANSI colour escapes (bore adds them when stderr looks like a TTY)
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' {
            for d in chars.by_ref() {
                if d.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn bin_name() -> &'static str {
    if cfg!(windows) {
        "bore.exe"
    } else {
        "bore"
    }
}

impl TunnelManager {
    pub fn new(app: AppHandle, config_dir: &Path) -> Arc<Self> {
        Arc::new(Self {
            app,
            bin_dir: config_dir.join("bore"),
            active: Mutex::new(HashMap::new()),
        })
    }

    fn bore_path(&self) -> PathBuf {
        self.bin_dir.join(bin_name())
    }

    /// Download + cache the bore client if we don't have it.
    fn ensure_bore(&self) -> Result<PathBuf, String> {
        let path = self.bore_path();
        if path.is_file() {
            return Ok(path);
        }
        let (suffix, is_zip) =
            asset_name().ok_or("No tunnel client for this platform yet.")?;
        let url = format!(
            "https://github.com/ekzhang/bore/releases/download/{BORE_VERSION}/bore-{BORE_VERSION}-{suffix}"
        );
        self.progress("Downloading the tunnel client…");
        let mut bytes = Vec::new();
        ureq::get(&url)
            .timeout(Duration::from_secs(60))
            .call()
            .map_err(|e| format!("download failed: {e}"))?
            .into_reader()
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;

        fs::create_dir_all(&self.bin_dir).map_err(|e| e.to_string())?;
        let want = bin_name();
        if is_zip {
            let mut zip = zip::ZipArchive::new(std::io::Cursor::new(bytes))
                .map_err(|e| e.to_string())?;
            for i in 0..zip.len() {
                let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
                let n = f.name().rsplit('/').next().unwrap_or("").to_string();
                if n == want {
                    let mut out = fs::File::create(&path).map_err(|e| e.to_string())?;
                    std::io::copy(&mut f, &mut out).map_err(|e| e.to_string())?;
                }
            }
        } else {
            let gz = flate2::read::GzDecoder::new(&bytes[..]);
            let mut ar = tar::Archive::new(gz);
            for entry in ar.entries().map_err(|e| e.to_string())? {
                let mut entry = entry.map_err(|e| e.to_string())?;
                let ep = entry.path().map_err(|e| e.to_string())?.into_owned();
                if ep.file_name().and_then(|s| s.to_str()) == Some(want) {
                    entry.unpack(&path).map_err(|e| e.to_string())?;
                }
            }
        }
        if !path.is_file() {
            return Err("tunnel client archive didn't contain the binary".into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut p = fs::metadata(&path).map_err(|e| e.to_string())?.permissions();
            p.set_mode(0o755);
            fs::set_permissions(&path, p).map_err(|e| e.to_string())?;
        }
        Ok(path)
    }

    fn progress(&self, msg: &str) {
        let _ = self.app.emit("tunnel:progress", msg);
    }

    fn emit_status(&self, server_id: &str) {
        let st = self.status(server_id);
        let _ = self.app.emit("tunnel:status", (server_id, st));
    }

    pub fn status(&self, server_id: &str) -> TunnelStatus {
        let map = self.active.lock().unwrap();
        match map.get(server_id) {
            Some(a) => TunnelStatus {
                running: true,
                address: a.address.lock().unwrap().clone(),
                error: a.error.lock().unwrap().clone(),
            },
            None => TunnelStatus::default(),
        }
    }

    pub fn start(self: &Arc<Self>, server_id: &str, port: u16) -> Result<(), String> {
        if self.active.lock().unwrap().contains_key(server_id) {
            return Ok(());
        }
        let bore = self.ensure_bore()?;
        self.progress("Opening the tunnel…");

        let mut child = Command::new(&bore)
            .args(["local", &port.to_string(), "--to", "bore.pub"])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("couldn't start the tunnel: {e}"))?;

        let stderr = child.stderr.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let child = Arc::new(Mutex::new(child));
        let address = Arc::new(Mutex::new(None::<String>));
        let error = Arc::new(Mutex::new(None::<String>));

        self.active.lock().unwrap().insert(
            server_id.to_string(),
            Active { child: child.clone(), address: address.clone(), error: error.clone() },
        );

        // bore logs to stderr; parse "listening at bore.pub:NNNNN"
        for pipe in [
            Box::new(stderr) as Box<dyn Read + Send>,
            Box::new(stdout) as Box<dyn Read + Send>,
        ] {
            let this = self.clone();
            let sid = server_id.to_string();
            let address = address.clone();
            let error = error.clone();
            thread::spawn(move || {
                let reader = BufReader::new(pipe);
                for raw in reader.lines().map_while(Result::ok) {
                    let line = strip_ansi(&raw);
                    if let Some(rest) = line.split("listening at ").nth(1) {
                        let addr = rest.split_whitespace().next().unwrap_or("").to_string();
                        if !addr.is_empty() {
                            *address.lock().unwrap() = Some(addr);
                            this.emit_status(&sid);
                        }
                    }
                    let l = line.to_ascii_lowercase();
                    if l.contains("error") || l.contains("failed") || l.contains("refused") {
                        *error.lock().unwrap() = Some(line.clone());
                        this.emit_status(&sid);
                    }
                }
            });
        }

        // watchdog: when bore exits, drop it
        {
            let this = self.clone();
            let sid = server_id.to_string();
            let child = child.clone();
            thread::spawn(move || loop {
                thread::sleep(Duration::from_millis(600));
                if child.lock().unwrap().try_wait().ok().flatten().is_some() {
                    this.active.lock().unwrap().remove(&sid);
                    this.emit_status(&sid);
                    return;
                }
            });
        }
        Ok(())
    }

    pub fn stop(&self, server_id: &str) {
        if let Some(a) = self.active.lock().unwrap().remove(server_id) {
            let _ = a.child.lock().unwrap().kill();
        }
        self.emit_status(server_id);
    }

    pub fn stop_all(&self) {
        let ids: Vec<String> = self.active.lock().unwrap().keys().cloned().collect();
        for id in ids {
            self.stop(&id);
        }
    }

}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_an_asset_for_this_platform() {
        // the dev machine is one of the supported targets
        assert!(asset_name().is_some());
    }

    #[test]
    fn parses_bore_listening_line_with_ansi() {
        let line = "\u{1b}[2m2026..\u{1b}[0m \u{1b}[32m INFO\u{1b}[0m \u{1b}[2mbore_cli::client\u{1b}[0m\u{1b}[2m:\u{1b}[0m listening at bore.pub:38561\u{1b}[0m";
        let clean = strip_ansi(line);
        let addr = clean
            .split("listening at ")
            .nth(1)
            .and_then(|r| r.split_whitespace().next());
        assert_eq!(addr, Some("bore.pub:38561"));
    }
}
