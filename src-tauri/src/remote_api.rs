//! A tiny local HTTP API so the Android companion app can see and control
//! your servers over the same public-IP/UPnP path Minecraft clients already
//! use (`net.rs`/`tunnel.rs`) — no hosted backend involved.
//!
//! Off by default. When switched on in Settings it binds `0.0.0.0` (not just
//! localhost) on a fixed port and hands out a bearer token the phone has to
//! present on every request. That token is separate from the local PIN in
//! `lock.rs` — the PIN keeps someone at your desk out of the *desktop app*,
//! this token is what lets a *different device* talk to it at all.
//!
//! Deliberately small: REST, polled, no WebSocket — matches how the rest of
//! this frontend already gets its live data (RconPanel/HealthStrip/etc. all
//! poll). `tiny_http` because it's minimal and blocking, same philosophy as
//! `ureq` being this codebase's only other HTTP dependency — no async
//! runtime anywhere else in the app, so this doesn't start one either.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tiny_http::{Header, Method, Response};

use crate::commands;
use crate::db::Db;
use crate::process::ProcessManager;
use crate::rcon::RconPool;

const DEFAULT_PORT: u16 = 8642;

#[derive(Serialize, Deserialize, Clone)]
struct StoredConfig {
    enabled: bool,
    token: String,
    port: u16,
}

impl Default for StoredConfig {
    fn default() -> Self {
        Self { enabled: false, token: new_token(), port: DEFAULT_PORT }
    }
}

fn new_token() -> String {
    format!("cp_{}", uuid::Uuid::new_v4().simple())
}

#[derive(Serialize)]
pub struct RemoteApiStatus {
    pub enabled: bool,
    pub running: bool,
    pub port: u16,
    pub token: String,
}

pub struct RemoteApi {
    path: PathBuf,
    stop: Mutex<Option<Arc<AtomicBool>>>,
}

impl RemoteApi {
    pub fn new(config_dir: &Path) -> Self {
        Self { path: config_dir.join("remote_api.json"), stop: Mutex::new(None) }
    }

    /// Reads the config, creating (and persisting) a fresh default — a new
    /// random token included — the first time this is ever called. Doing
    /// the write here, not just returning a default in memory, matters:
    /// otherwise every call with no file yet on disk would mint a *new*
    /// token, and status() would look like it was rotating the token on
    /// its own every time the UI asked for it.
    fn load(&self) -> StoredConfig {
        if let Some(cfg) = std::fs::read_to_string(&self.path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
        {
            return cfg;
        }
        let cfg = StoredConfig::default();
        let _ = self.save(&cfg);
        cfg
    }

    fn save(&self, cfg: &StoredConfig) -> Result<(), String> {
        let json = serde_json::to_string(cfg).map_err(|e| e.to_string())?;
        std::fs::write(&self.path, json).map_err(|e| e.to_string())
    }

    pub fn status(&self) -> RemoteApiStatus {
        let cfg = self.load();
        let running = self.stop.lock().unwrap().is_some();
        RemoteApiStatus { enabled: cfg.enabled, running, port: cfg.port, token: cfg.token }
    }

    /// Starts the listener thread if it isn't already running. Safe to call
    /// unconditionally (e.g. at app boot) — no-ops if already up.
    pub fn start(&self, app: AppHandle) -> Result<RemoteApiStatus, String> {
        if self.stop.lock().unwrap().is_some() {
            return Ok(self.status());
        }
        let mut cfg = self.load();
        cfg.enabled = true;
        self.save(&cfg)?;

        let addr = format!("0.0.0.0:{}", cfg.port);
        let server = tiny_http::Server::http(&addr)
            .map_err(|e| format!("couldn't start the remote API on port {}: {e}", cfg.port))?;

        let stop_flag = Arc::new(AtomicBool::new(false));
        *self.stop.lock().unwrap() = Some(stop_flag.clone());
        let cfg_path = self.path.clone();

        std::thread::spawn(move || loop {
            if stop_flag.load(Ordering::SeqCst) {
                break;
            }
            match server.recv_timeout(Duration::from_millis(500)) {
                Ok(Some(req)) => handle_request(&app, &cfg_path, req),
                Ok(None) => continue,
                Err(_) => break,
            }
        });

        Ok(self.status())
    }

    /// Stops the listener (the thread notices within its 500ms poll and
    /// exits on its own — nothing here blocks waiting for it).
    pub fn stop(&self) -> Result<RemoteApiStatus, String> {
        if let Some(flag) = self.stop.lock().unwrap().take() {
            flag.store(true, Ordering::SeqCst);
        }
        let mut cfg = self.load();
        cfg.enabled = false;
        self.save(&cfg)?;
        Ok(self.status())
    }

    pub fn regenerate_token(&self) -> Result<RemoteApiStatus, String> {
        let mut cfg = self.load();
        cfg.token = new_token();
        self.save(&cfg)?;
        Ok(self.status())
    }
}

fn read_token(cfg_path: &Path) -> Option<String> {
    std::fs::read_to_string(cfg_path)
        .ok()
        .and_then(|s| serde_json::from_str::<StoredConfig>(&s).ok())
        .map(|c| c.token)
}

/// The Android app's own frontend is loaded from a `https://tauri.localhost`-
/// style origin, not from this server — so every real request the WebView's
/// `fetch()` makes here is cross-origin, and the phone's own bearer token in
/// the `Authorization` header makes it a "non-simple" request on top of
/// that. Without these headers the browser sends the request but throws the
/// response away before this app's JS ever sees it — CORS, not a network
/// failure, so it wouldn't even show up in `read_network_requests` as an
/// error. `*` is fine here: the token is what actually gates access, same
/// as any bearer-token API, not the origin header.
fn with_cors(mut r: Response<std::io::Cursor<Vec<u8>>>) -> Response<std::io::Cursor<Vec<u8>>> {
    for (name, value) in [
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
        ("Access-Control-Allow-Headers", "Authorization, Content-Type"),
    ] {
        if let Ok(h) = Header::from_bytes(name.as_bytes(), value.as_bytes()) {
            r = r.with_header(h);
        }
    }
    r
}

fn json_response(status: u16, body: &Value) -> Response<std::io::Cursor<Vec<u8>>> {
    let text = serde_json::to_string(body).unwrap_or_else(|_| "{}".to_string());
    let header = Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..])
        .expect("static header is always valid");
    with_cors(Response::from_string(text).with_status_code(status).with_header(header))
}

fn handle_request(app: &AppHandle, cfg_path: &Path, mut req: tiny_http::Request) {
    // the CORS preflight the WebView sends ahead of the real request —
    // carries no Authorization header by definition, so it has to be
    // answered before the auth check, not after
    if matches!(req.method(), Method::Options) {
        let _ = req.respond(with_cors(Response::from_string("").with_status_code(204)));
        return;
    }

    let presented = req
        .headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case("Authorization"))
        .map(|h| h.value.as_str().to_string());
    let expected = read_token(cfg_path);
    let authorized = matches!(
        (expected, presented),
        (Some(want), Some(got)) if got == format!("Bearer {want}")
    );
    if !authorized {
        let _ = req.respond(json_response(401, &json!({ "error": "unauthorized" })));
        return;
    }

    let method = req.method().clone();
    let path = req.url().split('?').next().unwrap_or("/").to_string();
    let segs: Vec<&str> = path.trim_matches('/').split('/').filter(|s| !s.is_empty()).collect();

    let result = route(app, &method, &segs, &mut req);

    match result {
        Ok(body) => {
            let _ = req.respond(json_response(200, &body));
        }
        Err((code, msg)) => {
            let _ = req.respond(json_response(code, &json!({ "error": msg })));
        }
    }
}

fn summarize(rec: &crate::db::ServerRecord, procs: &tauri::State<ProcessManager>) -> Value {
    let snap = procs.snapshot(&rec.id);
    let mut v = serde_json::to_value(rec).unwrap_or_else(|_| json!({}));
    if let Value::Object(map) = &mut v {
        map.insert("status".into(), serde_json::to_value(&snap.status).unwrap_or(Value::Null));
        map.insert("pid".into(), serde_json::to_value(snap.pid).unwrap_or(Value::Null));
        map.insert("started_at".into(), serde_json::to_value(snap.started_at).unwrap_or(Value::Null));
        map.insert("needs_eula".into(), Value::Bool(snap.needs_eula));
    }
    v
}

fn route(
    app: &AppHandle,
    method: &Method,
    segs: &[&str],
    req: &mut tiny_http::Request,
) -> Result<Value, (u16, String)> {
    match (method, segs) {
        (Method::Get, ["api", "servers"]) => {
            let db = app.state::<Db>();
            let procs = app.state::<ProcessManager>();
            let servers = db.list_servers().map_err(|e| (500, e.to_string()))?;
            let list: Vec<Value> = servers.iter().map(|r| summarize(r, &procs)).collect();
            Ok(json!({ "servers": list }))
        }
        (Method::Get, ["api", "servers", id]) => {
            let db = app.state::<Db>();
            let procs = app.state::<ProcessManager>();
            let rec = db
                .get_server(id)
                .map_err(|e| (500, e.to_string()))?
                .ok_or_else(|| (404, "no such server".to_string()))?;
            Ok(summarize(&rec, &procs))
        }
        (Method::Post, ["api", "servers", id, "start"]) => {
            let db = app.state::<Db>();
            let procs = app.state::<ProcessManager>();
            let snap = commands::start_server(db, procs, id.to_string(), None, None)
                .map_err(|e| (400, e))?;
            Ok(serde_json::to_value(snap).unwrap_or(Value::Null))
        }
        (Method::Post, ["api", "servers", id, "stop"]) => {
            let procs = app.state::<ProcessManager>();
            let pool = app.state::<RconPool>();
            commands::stop_server(procs, pool, id.to_string()).map_err(|e| (400, e))?;
            Ok(json!({ "ok": true }))
        }
        (Method::Get, ["api", "servers", id, "console"]) => {
            let procs = app.state::<ProcessManager>();
            let lines = commands::console_lines(procs, id.to_string());
            Ok(serde_json::to_value(lines).unwrap_or(Value::Null))
        }
        (Method::Post, ["api", "servers", id, "console"]) => {
            let mut body = String::new();
            req.as_reader().read_to_string(&mut body).map_err(|e| (400, e.to_string()))?;
            let line = serde_json::from_str::<Value>(&body)
                .ok()
                .and_then(|v| v.get("line").and_then(|l| l.as_str()).map(|s| s.to_string()))
                .ok_or_else(|| (400, "expected a JSON body like {\"line\": \"say hi\"}".to_string()))?;
            let procs = app.state::<ProcessManager>();
            commands::send_console(procs, id.to_string(), line).map_err(|e| (400, e))?;
            Ok(json!({ "ok": true }))
        }
        (Method::Get, ["api", "servers", id, "players"]) => {
            let db = app.state::<Db>();
            let pool = app.state::<RconPool>();
            let players = commands::rcon_players(db, pool, id.to_string()).map_err(|e| (400, e))?;
            Ok(serde_json::to_value(players).unwrap_or(Value::Null))
        }
        _ => Err((404, "not found".to_string())),
    }
}

#[tauri::command]
pub fn remote_api_status(api: tauri::State<RemoteApi>) -> RemoteApiStatus {
    api.status()
}

#[tauri::command]
pub fn remote_api_set_enabled(
    app: AppHandle,
    api: tauri::State<RemoteApi>,
    enabled: bool,
) -> Result<RemoteApiStatus, String> {
    if enabled {
        api.start(app)
    } else {
        api.stop()
    }
}

#[tauri::command]
pub fn remote_api_regenerate_token(api: tauri::State<RemoteApi>) -> Result<RemoteApiStatus, String> {
    api.regenerate_token()
}

/// The JSON payload the Android app's QR scanner reads to pair itself —
/// same public IP the "join address" QR on each server card already uses,
/// just pointed at this app's own control port instead of a server's game
/// port. Requires the remote API to already be running (there's no point
/// handing out a token for a listener that isn't up).
#[tauri::command]
pub fn remote_api_pair_payload(api: tauri::State<RemoteApi>) -> Result<String, String> {
    let s = api.status();
    if !s.running {
        return Err("Turn on the remote API first.".to_string());
    }
    let host = crate::net::public_ip()
        .ok_or_else(|| "Couldn't detect your public IP — check your internet connection.".to_string())?;
    Ok(json!({ "host": host, "port": s.port, "token": s.token }).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    // No test here actually binds the listener socket: the port is fixed
    // (8642), and a real desktop CraftPanel could be running with the
    // remote API already on that port on the same machine — binding in a
    // test would be exactly the kind of environment-dependent flakiness
    // this codebase has been bitten by before. These tests stick to the
    // pure config load/save + auth-comparison logic instead.

    fn temp_api(tag: &str) -> RemoteApi {
        let d = std::env::temp_dir().join(format!("cp-remote-api-{tag}-{:?}", std::thread::current().id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        RemoteApi::new(&d)
    }

    #[test]
    fn disabled_by_default_with_a_real_token_already_generated() {
        let api = temp_api("default");
        let s = api.status();
        assert!(!s.enabled);
        assert!(!s.running);
        assert!(s.token.starts_with("cp_"));
        assert_eq!(s.port, DEFAULT_PORT);
    }

    #[test]
    fn status_is_stable_across_calls_not_regenerated_each_time() {
        let api = temp_api("stable");
        let a = api.status();
        let b = api.status();
        assert_eq!(a.token, b.token, "reading status twice must not mint a new token");
    }

    #[test]
    fn regenerate_token_changes_the_token_but_leaves_enabled_state_alone() {
        let api = temp_api("regen");
        let before = api.status();
        let after = api.regenerate_token().unwrap();
        assert_ne!(before.token, after.token);
        assert_eq!(before.enabled, after.enabled);
    }

    #[test]
    fn stop_persists_disabled_even_when_nothing_was_running() {
        let api = temp_api("stop-idle");
        let s = api.stop().unwrap();
        assert!(!s.enabled);
        assert!(!s.running);
    }

    #[test]
    fn read_token_matches_a_freshly_saved_config() {
        let api = temp_api("read-token");
        let token = api.status().token;
        assert_eq!(read_token(&api.path), Some(token));
    }

    #[test]
    fn read_token_is_none_when_no_config_file_exists_yet() {
        let d = std::env::temp_dir().join("cp-remote-api-nofile");
        let _ = std::fs::remove_file(d.join("remote_api.json"));
        assert_eq!(read_token(&d.join("remote_api.json")), None);
    }
}
