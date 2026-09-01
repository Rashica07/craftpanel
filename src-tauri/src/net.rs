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
    /// the router already forwards this port, TCP for every server type
    /// except Bedrock (which is UDP-only — see `protocol_for`)
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

pub(crate) fn public_ip() -> Option<String> {
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

/// Java servers speak Minecraft's protocol over TCP; Bedrock is RakNet over
/// UDP only — there's no TCP listener to forward at all on a Bedrock
/// server, so every UPnP call in this module needs to know which one it's
/// dealing with rather than assuming TCP.
fn protocol_for(bedrock: bool) -> PortMappingProtocol {
    if bedrock { PortMappingProtocol::UDP } else { PortMappingProtocol::TCP }
}

fn has_mapping(gw: &Gateway, port: u16, protocol: PortMappingProtocol) -> bool {
    for i in 0..64u32 {
        match gw.get_generic_port_mapping_entry(i) {
            Ok(e) => {
                if e.external_port == port && e.protocol == protocol {
                    return true;
                }
            }
            Err(_) => break,
        }
    }
    false
}

pub fn info(server_dir: &str, bedrock: bool) -> NetInfo {
    let port = external::port_of(std::path::Path::new(server_dir));
    let lan = lan_ip().map(|v| v.to_string());
    let public = public_ip();
    let gw = gateway();
    let protocol = protocol_for(bedrock);

    NetInfo {
        port,
        lan_address: lan.as_ref().map(|ip| format!("{ip}:{port}")),
        lan_ip: lan,
        likely_cgnat: public.as_deref().map(is_cgnat).unwrap_or(false),
        public_address: public.as_ref().map(|ip| format!("{ip}:{port}")),
        public_ip: public,
        upnp_available: gw.is_some(),
        upnp_mapped: gw.as_ref().map(|g| has_mapping(g, port, protocol)).unwrap_or(false),
    }
}

/// Ask the router to forward `port` to this machine for ~24 h — UDP for a
/// Bedrock server, TCP for everything else.
pub fn upnp_forward(server_dir: &str, bedrock: bool) -> Result<String, String> {
    let port = external::port_of(std::path::Path::new(server_dir));
    let lan = lan_ip().ok_or("Couldn't find this machine's LAN address.")?;
    let gw = gateway().ok_or("No UPnP router found on this network.")?;
    gw.add_port(
        protocol_for(bedrock),
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

/// Forward an arbitrary port (TCP or UDP) — used for Geyser's Bedrock UDP port.
pub fn upnp_forward_port(port: u16, udp: bool) -> Result<(), String> {
    let lan = lan_ip().ok_or("Couldn't find this machine's LAN address.")?;
    let gw = gateway().ok_or("No UPnP router found on this network.")?;
    let proto = if udp { PortMappingProtocol::UDP } else { PortMappingProtocol::TCP };
    gw.add_port(
        proto,
        port,
        SocketAddr::new(IpAddr::V4(lan), port),
        86_400,
        "CraftPanel Bedrock (Geyser)",
    )
    .map_err(|e| format!("Router refused the forward: {e}"))
}

pub fn upnp_remove(server_dir: &str, bedrock: bool) -> Result<(), String> {
    let port = external::port_of(std::path::Path::new(server_dir));
    let gw = gateway().ok_or("No UPnP router found.")?;
    gw.remove_port(protocol_for(bedrock), port)
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
    fn bedrock_forwards_udp_everyone_else_forwards_tcp() {
        assert_eq!(protocol_for(true), PortMappingProtocol::UDP);
        assert_eq!(protocol_for(false), PortMappingProtocol::TCP);
    }

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
