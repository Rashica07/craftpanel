//! "How do my friends join?" — LAN address, public IP, an optional automatic
//! UPnP port-forward, and a QR code for the join address.
//!
//! A bundled tunnel agent comes later; for now the user can paste a tunnel
//! address (playit.gg / bore / ngrok) and CraftPanel treats it as the address.

use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};
use std::time::Duration;

use igd_next::{search_gateway, Gateway, PortMappingProtocol, SearchOptions};
use serde::Serialize;

use crate::external;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetInfo {
    pub port: u16,
    pub lan_ip: Option<String>,
    pub lan_address: Option<String>,
    pub public_ip: Option<String>,
    pub public_address: Option<String>,
    /// a UPnP gateway answered
    pub upnp_available: bool,
    /// the router already forwards this TCP port
    pub upnp_mapped: bool,
    /// public IP is carrier-grade NAT (100.64/10) — forwarding won't help
    pub likely_cgnat: bool,
}

fn lan_ip() -> Option<Ipv4Addr> {
    // connect() on a UDP socket sends nothing — it just picks the route
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.connect("8.8.8.8:80").ok()?;
    match sock.local_addr().ok()?.ip() {
        IpAddr::V4(v4) if !v4.is_loopback() => Some(v4),
        _ => None,
    }
}

fn public_ip() -> Option<String> {
    let body = ureq::get("https://api.ipify.org")
        .timeout(Duration::from_secs(4))
        .call()
        .ok()?
        .into_string()
        .ok()?;
    let ip = body.trim().to_string();
    ip.parse::<IpAddr>().ok().map(|_| ip)
}

fn is_cgnat(ip: &str) -> bool {
    let o: Vec<u8> = ip.split('.').filter_map(|s| s.parse().ok()).collect();
    o.len() == 4 && o[0] == 100 && (64..=127).contains(&o[1])
}

fn gateway() -> Option<Gateway> {
    search_gateway(SearchOptions {
        timeout: Some(Duration::from_secs(3)),
        ..Default::default()
    })
    .ok()
}

fn has_mapping(gw: &Gateway, port: u16) -> bool {
    for i in 0..64u32 {
        match gw.get_generic_port_mapping_entry(i) {
            Ok(e) => {
                if e.external_port == port && e.protocol == PortMappingProtocol::TCP {
                    return true;
                }
            }
            Err(_) => break,
        }
    }
    false
}

pub fn info(server_dir: &str) -> NetInfo {
    let port = external::port_of(std::path::Path::new(server_dir));
    let lan = lan_ip().map(|v| v.to_string());
    let public = public_ip();
    let gw = gateway();

    NetInfo {
        port,
        lan_address: lan.as_ref().map(|ip| format!("{ip}:{port}")),
        lan_ip: lan,
        likely_cgnat: public.as_deref().map(is_cgnat).unwrap_or(false),
        public_address: public.as_ref().map(|ip| format!("{ip}:{port}")),
        public_ip: public,
        upnp_available: gw.is_some(),
        upnp_mapped: gw.as_ref().map(|g| has_mapping(g, port)).unwrap_or(false),
    }
}

/// Ask the router to forward `port` (TCP) to this machine for ~24 h.
pub fn upnp_forward(server_dir: &str) -> Result<String, String> {
    let port = external::port_of(std::path::Path::new(server_dir));
    let lan = lan_ip().ok_or("Couldn't find this machine's LAN address.")?;
    let gw = gateway().ok_or("No UPnP router found on this network.")?;
    gw.add_port(
        PortMappingProtocol::TCP,
        port,
        SocketAddr::new(IpAddr::V4(lan), port),
        86_400,
        "CraftPanel Minecraft server",
    )
    .map_err(|e| format!("Router refused the port-forward: {e}"))?;
    let ext = gw
        .get_external_ip()
        .map_err(|e| format!("forwarded, but couldn't read the public IP: {e}"))?;
    Ok(format!("{ext}:{port}"))
}

pub fn upnp_remove(server_dir: &str) -> Result<(), String> {
    let port = external::port_of(std::path::Path::new(server_dir));
    let gw = gateway().ok_or("No UPnP router found.")?;
    gw.remove_port(PortMappingProtocol::TCP, port)
        .map_err(|e| e.to_string())
}

/// A QR code as an inline SVG string (dark modules only).
pub fn qr_svg(text: &str) -> Result<String, String> {
    use qrcode::{Color, QrCode};
    let code = QrCode::new(text.as_bytes()).map_err(|e| e.to_string())?;
    let w = code.width();
    let quiet = 2usize;
    let side = w + quiet * 2;
    let colors = code.to_colors();
    let mut rects = String::new();
    for y in 0..w {
        for x in 0..w {
            if colors[y * w + x] == Color::Dark {
                rects.push_str(&format!(
                    "<rect x='{}' y='{}' width='1' height='1'/>",
                    x + quiet,
                    y + quiet
                ));
            }
        }
    }
    Ok(format!(
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 {side} {side}' shape-rendering='crispEdges'>\
<rect width='{side}' height='{side}' fill='#fff'/><g fill='#000'>{rects}</g></svg>"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cgnat_detection() {
        assert!(is_cgnat("100.64.0.1"));
        assert!(is_cgnat("100.127.255.254"));
        assert!(!is_cgnat("100.128.0.1"));
        assert!(!is_cgnat("192.168.1.1"));
        assert!(!is_cgnat("8.8.8.8"));
    }

    #[test]
    fn qr_svg_is_wellformed() {
        let svg = qr_svg("play.example.com:25565").unwrap();
        assert!(svg.starts_with("<svg"));
        assert!(svg.contains("<rect"));
        assert!(svg.ends_with("</svg>"));
    }

    #[test]
    fn info_reads_port() {
        let d = std::env::temp_dir().join(format!("cp-net-{:?}", std::thread::current().id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("server.properties"), "server-port=25599\n").unwrap();
        // network calls may no-op in a sandbox; just assert the cheap field
        let port = external::port_of(&d);
        assert_eq!(port, 25599);
        let _ = std::fs::remove_dir_all(&d);
    }
}
