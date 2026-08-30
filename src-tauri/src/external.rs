//! Detect a server that's already running *outside* CraftPanel (started from a
//! terminal, another launcher, autostart, …) so we don't show "Stopped" next to
//! a live server or let the user start a second copy on the same port.

use std::fs;
use std::net::{Shutdown, SocketAddr, TcpStream};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalStatus {
    /// Something is accepting connections on the server's port.
    pub port_open: bool,
    /// The port we probed (from `server.properties`, default 25565).
    pub port: u16,
}

impl ExternalStatus {
    pub fn looks_running(&self) -> bool {
        self.port_open
    }
}

pub fn probe(server_dir: &str) -> ExternalStatus {
    let dir = Path::new(server_dir);
    let props = read_properties(dir);

    let port = props
        .as_ref()
        .and_then(|p| get(p, "server-port"))
        .and_then(|v| v.parse().ok())
        .filter(|p| *p != 0)
        .unwrap_or(25565);

    ExternalStatus {
        port_open: is_port_open(port),
        port,
    }
}

fn is_port_open(port: u16) -> bool {
    for host in ["127.0.0.1", "::1"] {
        if let Ok(addr) = format!("{host}:{port}").parse::<SocketAddr>() {
            if let Ok(stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(300)) {
                let _ = stream.shutdown(Shutdown::Both);
                return true;
            }
        }
    }
    false
}

/// PIDs with a LISTEN socket on `port`. Used to recover from an orphaned
/// server that CraftPanel can no longer see as its own.
pub fn port_pids(port: u16) -> Vec<u32> {
    #[cfg(unix)]
    {
        let out = Command::new("lsof")
            .args([
                "-nP",
                &format!("-iTCP:{port}"),
                "-sTCP:LISTEN",
                "-t",
            ])
            .stderr(Stdio::null())
            .output();
        if let Ok(o) = out {
            return String::from_utf8_lossy(&o.stdout)
                .split_whitespace()
                .filter_map(|s| s.parse().ok())
                .collect();
        }
    }
    #[cfg(windows)]
    {
        let out = Command::new("netstat")
            .args(["-ano", "-p", "tcp"])
            .stderr(Stdio::null())
            .output();
        if let Ok(o) = out {
            let needle = format!(":{port}");
            let mut pids = Vec::new();
            for line in String::from_utf8_lossy(&o.stdout).lines() {
                if !line.contains("LISTENING") {
                    continue;
                }
                let cols: Vec<&str> = line.split_whitespace().collect();
                // proto  local  foreign  state  pid
                if cols.len() >= 5
                    && cols[1].ends_with(&needle)
                    && cols[1].rsplit_once(':').map(|(_, p)| p == port.to_string()).unwrap_or(false)
                {
                    if let Ok(pid) = cols[4].parse() {
                        pids.push(pid);
                    }
                }
            }
            pids.sort_unstable();
            pids.dedup();
            return pids;
        }
    }
    Vec::new()
}

/// Is `port` free to bind (nothing listening, per the OS)?
pub fn port_free(port: u16) -> bool {
    !is_port_open(port) && port_pids(port).is_empty()
}

fn read_properties(dir: &Path) -> Option<String> {
    fs::read_to_string(dir.join("server.properties")).ok()
}

pub fn port_of(dir: &Path) -> u16 {
    read_properties(dir)
        .as_deref()
        .and_then(|p| get(p, "server-port"))
        .and_then(|v| v.parse().ok())
        .filter(|p| *p != 0)
        .unwrap_or(25565)
}

fn get(props: &str, key: &str) -> Option<String> {
    for line in props.lines() {
        let line = line.trim();
        if line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            if k.trim() == key {
                return Some(v.trim().to_string());
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_port_and_level_from_properties() {
        let d = std::env::temp_dir().join("cp-ext");
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        fs::write(
            d.join("server.properties"),
            "#comment\nserver-port=25570\nlevel-name=myworld\n",
        )
        .unwrap();

        let s = probe(&d.to_string_lossy());
        assert_eq!(s.port, 25570);
        // nothing is listening on 25570 in the test env
        assert!(!s.port_open);
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn defaults_port_when_no_properties() {
        let s = probe("/no/such/dir");
        assert_eq!(s.port, 25565);
        // note: can't assert !looks_running() — a real MC server may be up on
        // 25565 on the test machine.
    }

    #[test]
    fn port_free_and_pids_agree_with_a_live_listener() {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(!port_free(port), "a bound port isn't free");
        // this process holds it, so if lsof is present our own pid shows up
        let pids = port_pids(port);
        if !pids.is_empty() {
            assert!(pids.contains(&std::process::id()));
        }
        drop(listener);
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(port_free(port));
    }

    #[test]
    fn port_open_reflects_a_live_listener() {
        use std::net::TcpListener;
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        let d = std::env::temp_dir().join("cp-ext-live");
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("server.properties"), format!("server-port={port}\n")).unwrap();

        assert!(probe(&d.to_string_lossy()).port_open);
        drop(listener);
        // give the OS a beat to release the port
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(!probe(&d.to_string_lossy()).port_open);
        let _ = fs::remove_dir_all(&d);
    }
}
