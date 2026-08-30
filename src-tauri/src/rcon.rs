//! Minimal Source RCON client (the protocol Minecraft speaks).
//!
//! Blocking TCP with timeouts. One [`RconClient`] per connection; the process
//! layer keeps a lazily-(re)connected client per server.

use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::Mutex;
use std::time::Duration;

const TYPE_AUTH: i32 = 3;
const TYPE_EXEC: i32 = 2;
const TYPE_RESPONSE: i32 = 0;
const MAX_BODY: usize = 4096;

#[derive(Debug)]
pub enum RconError {
    Io(io::Error),
    AuthFailed,
    Protocol(String),
}

impl std::fmt::Display for RconError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RconError::Io(e) => write!(f, "connection error: {e}"),
            RconError::AuthFailed => write!(f, "RCON password rejected"),
            RconError::Protocol(s) => write!(f, "RCON protocol error: {s}"),
        }
    }
}

impl From<io::Error> for RconError {
    fn from(e: io::Error) -> Self {
        RconError::Io(e)
    }
}

pub type Result<T> = std::result::Result<T, RconError>;

pub struct RconClient {
    stream: TcpStream,
    next_id: i32,
}

impl RconClient {
    pub fn connect<A: ToSocketAddrs>(addr: A, password: &str) -> Result<Self> {
        let addr = addr
            .to_socket_addrs()?
            .next()
            .ok_or_else(|| RconError::Protocol("no address".into()))?;
        let stream = TcpStream::connect_timeout(&addr, Duration::from_secs(3))?;
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        stream.set_write_timeout(Some(Duration::from_secs(5)))?;
        stream.set_nodelay(true).ok();

        let mut client = RconClient { stream, next_id: 1 };
        client.authenticate(password)?;
        Ok(client)
    }

    fn authenticate(&mut self, password: &str) -> Result<()> {
        let id = self.take_id();
        self.send(id, TYPE_AUTH, password)?;
        // Server may send an empty RESPONSE_VALUE first, then the auth result.
        loop {
            let pkt = self.recv()?;
            if pkt.ptype == TYPE_EXEC || pkt.ptype == TYPE_RESPONSE {
                if pkt.id == -1 {
                    return Err(RconError::AuthFailed);
                }
                if pkt.id == id {
                    return Ok(());
                }
                // ignore the leading empty packet, keep reading
            }
        }
    }

    /// Run a command and return its text output.
    ///
    /// Minecraft sends one RESPONSE_VALUE per command for anything short (which
    /// is every command CraftPanel issues). We read that packet, then briefly
    /// drain any continuation packets for long output like `help`. We do *not*
    /// send the Source-style "sentinel" follow-up packet — Paper closes the
    /// connection on it.
    pub fn command(&mut self, cmd: &str) -> Result<String> {
        let id = self.take_id();
        self.send(id, TYPE_EXEC, cmd)?;

        let mut body = String::new();
        let first = self.recv()?;
        if first.id == id {
            body.push_str(&first.body);
        }

        self.stream
            .set_read_timeout(Some(Duration::from_millis(250)))
            .ok();
        loop {
            match self.recv() {
                Ok(p) if p.id == id => body.push_str(&p.body),
                Ok(_) => {}
                Err(RconError::Io(e))
                    if matches!(
                        e.kind(),
                        io::ErrorKind::WouldBlock
                            | io::ErrorKind::TimedOut
                            | io::ErrorKind::UnexpectedEof
                    ) =>
                {
                    break
                }
                Err(e) => {
                    let _ = self.stream.set_read_timeout(Some(Duration::from_secs(5)));
                    return Err(e);
                }
            }
        }
        let _ = self.stream.set_read_timeout(Some(Duration::from_secs(5)));
        Ok(body)
    }

    fn take_id(&mut self) -> i32 {
        let id = self.next_id;
        self.next_id = self.next_id.wrapping_add(1).max(1);
        id
    }

    fn send(&mut self, id: i32, ptype: i32, body: &str) -> Result<()> {
        if body.len() > MAX_BODY {
            return Err(RconError::Protocol("command too long".into()));
        }
        let mut buf = Vec::with_capacity(body.len() + 14);
        let len = (body.len() + 10) as i32;
        buf.extend_from_slice(&len.to_le_bytes());
        buf.extend_from_slice(&id.to_le_bytes());
        buf.extend_from_slice(&ptype.to_le_bytes());
        buf.extend_from_slice(body.as_bytes());
        buf.extend_from_slice(&[0u8, 0u8]);
        self.stream.write_all(&buf)?;
        self.stream.flush()?;
        Ok(())
    }

    fn recv(&mut self) -> Result<Packet> {
        let mut len_bytes = [0u8; 4];
        self.stream.read_exact(&mut len_bytes)?;
        let len = i32::from_le_bytes(len_bytes);
        if !(10..=(MAX_BODY as i32 + 10)).contains(&len) {
            return Err(RconError::Protocol(format!("bad packet length {len}")));
        }
        let mut rest = vec![0u8; len as usize];
        self.stream.read_exact(&mut rest)?;

        let id = i32::from_le_bytes([rest[0], rest[1], rest[2], rest[3]]);
        let ptype = i32::from_le_bytes([rest[4], rest[5], rest[6], rest[7]]);
        // body is rest[8 .. len-2], then two null bytes
        let body_end = rest.len().saturating_sub(2);
        let body = String::from_utf8_lossy(&rest[8..body_end]).to_string();
        Ok(Packet { id, ptype, body })
    }
}

struct Packet {
    id: i32,
    ptype: i32,
    body: String,
}

/// Keeps one authenticated connection per server and reuses it, so polling
/// (players, TPS, RAM) doesn't reconnect every few seconds. Reconnects on error.
pub struct RconPool(Mutex<HashMap<String, RconClient>>);

impl Default for RconPool {
    fn default() -> Self {
        RconPool(Mutex::new(HashMap::new()))
    }
}

impl RconPool {
    pub fn new() -> Self {
        Self::default()
    }

    /// Run `f` against the pooled connection for `key`; on any error, drop it
    /// and retry once on a fresh connection.
    pub fn run<T>(
        &self,
        key: &str,
        host: &str,
        port: u16,
        password: &str,
        f: impl Fn(&mut RconClient) -> Result<T>,
    ) -> Result<T> {
        let mut map = self.0.lock().unwrap();
        if let Some(c) = map.get_mut(key) {
            match f(c) {
                Ok(v) => return Ok(v),
                Err(_) => {
                    map.remove(key);
                }
            }
        }
        let mut c = RconClient::connect((host, port), password)?;
        let v = f(&mut c)?;
        map.insert(key.to_string(), c);
        Ok(v)
    }

    pub fn drop_conn(&self, key: &str) {
        self.0.lock().unwrap().remove(key);
    }
}

// --- higher-level helpers the commands layer uses -------------------------

/// Parse the vanilla `/list` output into player names.
///
/// "There are 2 of a max of 20 players online: Alice, Bob"
pub fn parse_player_list(output: &str) -> (u32, u32, Vec<String>) {
    let mut online = 0;
    let mut max = 0;
    let mut players = Vec::new();

    if let Some(rest) = output.split("There are ").nth(1) {
        let mut it = rest.split_whitespace();
        online = it.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        // ... "of a max of N players online:"
        for w in it {
            if let Ok(n) = w.parse::<u32>() {
                max = n;
                break;
            }
        }
    }
    if let Some((_, names)) = output.split_once("online:") {
        players = names
            .split(',')
            .map(|s| s.trim().trim_end_matches(|c: char| c == '.').to_string())
            .filter(|s| !s.is_empty())
            .collect();
    }
    (online, max, players)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    /// A tiny RCON server that speaks just enough protocol for the client test.
    fn spawn_mock(password: &'static str) -> u16 {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        thread::spawn(move || {
            let (mut sock, _) = listener.accept().unwrap();
            loop {
                let mut lb = [0u8; 4];
                if sock.read_exact(&mut lb).is_err() {
                    return;
                }
                let len = i32::from_le_bytes(lb) as usize;
                let mut rest = vec![0u8; len];
                if sock.read_exact(&mut rest).is_err() {
                    return;
                }
                let id = i32::from_le_bytes([rest[0], rest[1], rest[2], rest[3]]);
                let ptype = i32::from_le_bytes([rest[4], rest[5], rest[6], rest[7]]);
                let body = String::from_utf8_lossy(&rest[8..rest.len() - 2]).to_string();

                let write = |sock: &mut std::net::TcpStream, rid: i32, rtype: i32, rbody: &str| {
                    let mut buf = Vec::new();
                    let l = (rbody.len() + 10) as i32;
                    buf.extend_from_slice(&l.to_le_bytes());
                    buf.extend_from_slice(&rid.to_le_bytes());
                    buf.extend_from_slice(&rtype.to_le_bytes());
                    buf.extend_from_slice(rbody.as_bytes());
                    buf.extend_from_slice(&[0, 0]);
                    sock.write_all(&buf).unwrap();
                };

                match ptype {
                    3 => {
                        // auth
                        let ok_id = if body == password { id } else { -1 };
                        write(&mut sock, ok_id, 2, "");
                    }
                    2 => {
                        let reply = match body.as_str() {
                            "" => "".to_string(),
                            "list" => {
                                "There are 1 of a max of 20 players online: Steve".to_string()
                            }
                            other => format!("ran: {other}"),
                        };
                        write(&mut sock, id, 0, &reply);
                    }
                    _ => return,
                }
            }
        });
        port
    }

    #[test]
    fn connects_authenticates_and_runs_commands() {
        let port = spawn_mock("s3cret");
        thread::sleep(std::time::Duration::from_millis(50));

        let mut c = RconClient::connect(("127.0.0.1", port), "s3cret").unwrap();
        let out = c.command("list").unwrap();
        assert!(out.contains("Steve"));
        assert_eq!(c.command("say hi").unwrap(), "ran: say hi");
    }

    #[test]
    fn wrong_password_is_rejected() {
        let port = spawn_mock("right");
        thread::sleep(std::time::Duration::from_millis(50));
        match RconClient::connect(("127.0.0.1", port), "wrong") {
            Err(RconError::AuthFailed) => {}
            Err(e) => panic!("expected AuthFailed, got error: {e}"),
            Ok(_) => panic!("expected AuthFailed, got a connected client"),
        }
    }

    #[test]
    fn parses_player_list() {
        let (on, max, players) =
            parse_player_list("There are 2 of a max of 20 players online: Alice, Bob");
        assert_eq!((on, max), (2, 20));
        assert_eq!(players, vec!["Alice", "Bob"]);
    }

    #[test]
    fn parses_empty_player_list() {
        let (on, max, players) =
            parse_player_list("There are 0 of a max of 20 players online:");
        assert_eq!((on, max), (0, 20));
        assert!(players.is_empty());
    }
}
