//! Session files — so a CraftPanel restart re-adopts the servers it launched
//! instead of mislabelling them "external" (which locked you out of restarting
//! them).
//!
//! When a server starts, we drop `<server>/.craftpanel-session.json` recording
//! the child pid, the CraftPanel pid that spawned it, and the RCON endpoint (so
//! a fresh app instance can still stop it). The monitor deletes the file when
//! the process exits. On launch, `ProcessManager::adopt_all` reads every file:
//! if the pid is still a live JVM it's re-adopted as **Running (reattached)**;
//! otherwise the stale file is cleared.

use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub const SESSION_FILE: &str = ".craftpanel-session.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    /// The Minecraft / Java child process.
    pub pid: u32,
    /// The CraftPanel process that launched it (informational).
    pub launcher_pid: u32,
    pub started_at: i64,
    #[serde(default)]
    pub rcon_port: Option<u16>,
    #[serde(default)]
    pub rcon_password: Option<String>,
}

pub(crate) fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn write(dir: &Path, s: &Session) {
    if let Ok(json) = serde_json::to_vec_pretty(s) {
        let _ = fs::write(dir.join(SESSION_FILE), json);
    }
}

pub fn read(dir: &Path) -> Option<Session> {
    let raw = fs::read(dir.join(SESSION_FILE)).ok()?;
    serde_json::from_slice(&raw).ok()
}

pub fn clear(dir: &Path) {
    let _ = fs::remove_file(dir.join(SESSION_FILE));
}

/// Is `pid` a live process whose command line looks like a JVM? The JVM check
/// guards against PID reuse — after a reboot the number could belong to anything.
pub fn server_alive(pid: u32) -> bool {
    let line = proc_line(pid).to_ascii_lowercase();
    line.contains("java")
}

/// Ask the process to stop (SIGTERM / taskkill).
pub fn terminate(pid: u32) {
    #[cfg(unix)]
    let _ = Command::new("kill").arg(pid.to_string()).status();
    #[cfg(windows)]
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string()])
        .status();
}

/// Force-kill the process (SIGKILL / taskkill /F).
pub fn force_kill(pid: u32) {
    #[cfg(unix)]
    let _ = Command::new("kill").args(["-9", &pid.to_string()]).status();
    #[cfg(windows)]
    let _ = Command::new("taskkill")
        .args(["/F", "/PID", &pid.to_string()])
        .status();
}

#[cfg(unix)]
fn proc_line(pid: u32) -> String {
    Command::new("ps")
        .args(["-p", &pid.to_string(), "-o", "command="])
        .stderr(Stdio::null())
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

#[cfg(windows)]
fn proc_line(pid: u32) -> String {
    Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])
        .stderr(Stdio::null())
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_clears() {
        let d = std::env::temp_dir().join(format!("cp-sess-{:?}", std::thread::current().id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();

        assert!(read(&d).is_none());
        write(
            &d,
            &Session {
                pid: 4321,
                launcher_pid: 1,
                started_at: 42,
                rcon_port: Some(25575),
                rcon_password: Some("x".into()),
            },
        );
        let s = read(&d).unwrap();
        assert_eq!(s.pid, 4321);
        assert_eq!(s.rcon_port, Some(25575));

        clear(&d);
        assert!(read(&d).is_none());
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn this_process_is_not_a_server() {
        // our own pid is alive but not a JVM
        assert!(!server_alive(std::process::id()));
        // a pid that's very unlikely to exist
        assert!(!server_alive(999_999_999));
    }
}
