//! The native Minecraft **Management Server** (JSON-RPC over WebSocket), added
//! in MC 1.21.9 / the 26.x line. CraftPanel doesn't speak the full protocol yet
//! — this module detects support, reports config, and can turn it on (writing
//! only the `management-server-*` keys, line-preserving, never `online-mode`).

use std::net::TcpStream;
use std::path::Path;
use std::time::Duration;

use serde::Serialize;

use crate::properties::Properties;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MgmtStatus {
    /// this MC version ships the management server
    pub supported: bool,
    pub enabled: bool,
    pub host: String,
    pub port: u16,
    pub tls: bool,
    pub secret_set: bool,
    /// the port is actually accepting connections
    pub reachable: bool,
}

/// MC 1.21.9+ or the 26.x year scheme.
pub fn supports(mc_version: Option<&str>) -> bool {
    let Some(v) = mc_version else { return false };
    let parts: Vec<u32> = v.split(['.', '-']).filter_map(|s| s.parse().ok()).collect();
    match parts.as_slice() {
        [maj, ..] if *maj >= 22 && *maj <= 99 => true, // year scheme (26.x …)
        [1, 21, patch, ..] => *patch >= 9,
        [1, minor, ..] => *minor >= 22,
        _ => false,
    }
}

fn port_open(port: u16) -> bool {
    port != 0
        && TcpStream::connect_timeout(
            &format!("127.0.0.1:{port}").parse().unwrap(),
            Duration::from_millis(300),
        )
        .is_ok()
}

pub fn status(server_dir: &str, mc_version: Option<&str>) -> MgmtStatus {
    let p = Properties::load(Path::new(server_dir));
    let port: u16 = p.get_or("management-server-port", "0").parse().unwrap_or(0);
    MgmtStatus {
        supported: supports(mc_version),
        enabled: p.get_or("management-server-enabled", "false") == "true" && port != 0,
        host: p.get_or("management-server-host", "localhost"),
        tls: p.get_or("management-server-tls-enabled", "false") == "true",
        secret_set: !p.get("management-server-secret").unwrap_or_default().is_empty(),
        reachable: port_open(port),
        port,
    }
}

/// Turn the management server on. Writes only `management-server-*` keys.
pub fn enable(server_dir: &str, preferred_port: u16) -> Result<MgmtStatus, String> {
    let dir = Path::new(server_dir);
    let mut p = Properties::load(dir);
    if !p.existed() {
        return Err("Start the server once so it writes server.properties first.".into());
    }
    p.set("management-server-enabled", "true");
    p.set("management-server-host", "localhost");
    let cur: u16 = p.get_or("management-server-port", "0").parse().unwrap_or(0);
    if cur == 0 {
        p.set("management-server-port", &preferred_port.to_string());
    }
    if p.get("management-server-secret").unwrap_or_default().is_empty() {
        p.set("management-server-secret", &gen_secret());
    }
    // keep it local-only; TLS off is fine for a loopback socket
    if p.get("management-server-tls-enabled").is_none() {
        p.set("management-server-tls-enabled", "false");
    }
    p.save().map_err(|e| e.to_string())?;
    Ok(status(server_dir, None))
}

pub fn disable(server_dir: &str) -> Result<(), String> {
    let dir = Path::new(server_dir);
    let mut p = Properties::load(dir);
    p.set("management-server-enabled", "false");
    p.save().map_err(|e| e.to_string())
}

fn gen_secret() -> String {
    let a = uuid::Uuid::new_v4().simple().to_string();
    let b = uuid::Uuid::new_v4().simple().to_string();
    format!("{a}{b}")[..40].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_gate() {
        assert!(supports(Some("1.21.9")));
        assert!(supports(Some("1.21.11")));
        assert!(!supports(Some("1.21.4")));
        assert!(!supports(Some("1.20.1")));
        assert!(supports(Some("26.2")));
        assert!(supports(Some("1.22.0")));
        assert!(!supports(None));
    }

    #[test]
    fn enable_writes_only_mgmt_keys_and_keeps_online_mode() {
        let d = std::env::temp_dir().join(format!("cp-mgmt-{:?}", std::thread::current().id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(
            d.join("server.properties"),
            "online-mode=false\nmotd=Hi\nmanagement-server-port=0\n",
        )
        .unwrap();

        let st = enable(&d.to_string_lossy(), 25585).unwrap();
        assert!(st.enabled);
        assert_eq!(st.port, 25585);
        assert!(st.secret_set);

        let out = std::fs::read_to_string(d.join("server.properties")).unwrap();
        assert!(out.contains("online-mode=false")); // untouched
        assert!(out.contains("management-server-enabled=true"));
        assert!(out.contains("motd=Hi"));
        let _ = std::fs::remove_dir_all(&d);
    }
}
