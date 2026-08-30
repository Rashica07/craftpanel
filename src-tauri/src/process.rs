//! Server process management: spawn/stop, console ring buffer, crash detection.
//!
//! One [`ProcessManager`] lives in Tauri state. It owns a map of per-server
//! runtimes keyed by the DB id. Everything the UI needs is pushed out as
//! `server:log` and `server:status` events; commands are thin wrappers.

use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;

use crate::adapter::{ServerAdapter, ServerStatus};
use crate::db::ServerRecord;
use crate::minecraft::MinecraftAdapter;

const RING_CAPACITY: usize = 500;
const GRACEFUL_STOP_SECS: u64 = 25;

/// Where log lines and status changes go. Production uses a Tauri event
/// emitter; tests use an in-memory collector.
pub trait EventSink: Send + Sync + 'static {
    fn log(&self, line: &LogLine);
    fn status(&self, snap: &ProcSnapshot);
}

/// Adapts a Tauri `AppHandle` into an [`EventSink`].
pub struct TauriSink(pub tauri::AppHandle);

impl EventSink for TauriSink {
    fn log(&self, line: &LogLine) {
        use tauri::Emitter;
        let _ = self.0.emit("server:log", line);
    }
    fn status(&self, snap: &ProcSnapshot) {
        use tauri::Emitter;
        let _ = self.0.emit("server:status", snap);
    }
}

#[derive(Clone, Serialize)]
pub struct LogLine {
    pub server_id: String,
    pub seq: u64,
    /// "stdout" | "stderr" | "system"
    pub stream: &'static str,
    pub text: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcSnapshot {
    pub server_id: String,
    pub status: ServerStatus,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub started_at: Option<i64>,
    pub stop_requested: bool,
    /// Server bailed because the EULA hasn't been accepted.
    pub needs_eula: bool,
    /// Re-adopted from a session file after a CraftPanel restart — it's ours,
    /// not "external", but the console isn't captured.
    pub reattached: bool,
}

#[derive(Clone)]
struct Shared {
    id: String,
    status: Arc<Mutex<ServerStatus>>,
    exit_code: Arc<Mutex<Option<i32>>>,
    started_at: Arc<Mutex<Option<i64>>>,
    pid: Arc<Mutex<Option<u32>>>,
    stop_requested: Arc<AtomicBool>,
    needs_eula: Arc<AtomicBool>,
    reattached: Arc<AtomicBool>,
    ring: Arc<Mutex<VecDeque<LogLine>>>,
    seq: Arc<AtomicU64>,
}

impl Shared {
    fn new(id: &str) -> Self {
        Shared {
            id: id.to_string(),
            status: Arc::new(Mutex::new(ServerStatus::Stopped)),
            exit_code: Arc::new(Mutex::new(None)),
            started_at: Arc::new(Mutex::new(None)),
            pid: Arc::new(Mutex::new(None)),
            stop_requested: Arc::new(AtomicBool::new(false)),
            needs_eula: Arc::new(AtomicBool::new(false)),
            reattached: Arc::new(AtomicBool::new(false)),
            ring: Arc::new(Mutex::new(VecDeque::with_capacity(RING_CAPACITY))),
            seq: Arc::new(AtomicU64::new(0)),
        }
    }

    fn snapshot(&self) -> ProcSnapshot {
        ProcSnapshot {
            server_id: self.id.clone(),
            status: *self.status.lock().unwrap(),
            pid: *self.pid.lock().unwrap(),
            exit_code: *self.exit_code.lock().unwrap(),
            started_at: *self.started_at.lock().unwrap(),
            stop_requested: self.stop_requested.load(Ordering::SeqCst),
            needs_eula: self.needs_eula.load(Ordering::SeqCst),
            reattached: self.reattached.load(Ordering::SeqCst),
        }
    }

    fn push(&self, sink: &Arc<dyn EventSink>, stream: &'static str, text: String) {
        let line = LogLine {
            server_id: self.id.clone(),
            seq: self.seq.fetch_add(1, Ordering::SeqCst),
            stream,
            text,
        };
        {
            let mut ring = self.ring.lock().unwrap();
            if ring.len() == RING_CAPACITY {
                ring.pop_front();
            }
            ring.push_back(line.clone());
        }
        sink.log(&line);
    }

    fn set_status(&self, sink: &Arc<dyn EventSink>, status: ServerStatus) {
        {
            let mut s = self.status.lock().unwrap();
            if *s == status {
                return;
            }
            *s = status;
        }
        sink.status(&self.snapshot());
    }
}

struct Runtime {
    shared: Shared,
    child: Option<Arc<Mutex<Child>>>,
    stdin: Option<Arc<Mutex<ChildStdin>>>,
    /// Set when this runtime was re-adopted after a restart — we only have the
    /// pid, not a `Child` handle or stdin pipe.
    adopted_pid: Option<u32>,
    /// `(port, password)` — lets a fresh app instance stop an adopted server.
    rcon: Option<(u16, String)>,
}

/// Hooks the cloud-sync layer plugs into around start/stop.
pub trait ServerLifecycle: Send + Sync + 'static {
    fn before_start(&self, rec: &ServerRecord, force: bool) -> Result<(), String>;
    /// Called every ~60 s while the server runs — refresh the sync lease.
    fn heartbeat(&self, rec: &ServerRecord);
    fn after_exit(&self, rec: &ServerRecord);
}

pub struct ProcessManager {
    sink: Arc<dyn EventSink>,
    servers: Mutex<HashMap<String, Runtime>>,
    device_id: String,
    lifecycle: Mutex<Option<Arc<dyn ServerLifecycle>>>,
}

impl ProcessManager {
    pub fn new(app: tauri::AppHandle, device_id: String) -> Self {
        ProcessManager {
            sink: Arc::new(TauriSink(app)),
            servers: Mutex::new(HashMap::new()),
            device_id,
            lifecycle: Mutex::new(None),
        }
    }

    pub fn set_lifecycle(&self, lc: Arc<dyn ServerLifecycle>) {
        *self.lifecycle.lock().unwrap() = Some(lc);
    }

    fn lifecycle(&self) -> Option<Arc<dyn ServerLifecycle>> {
        self.lifecycle.lock().unwrap().clone()
    }

    #[cfg(test)]
    pub fn with_sink(sink: Arc<dyn EventSink>) -> Self {
        Self::with_sink_as(sink, "test-device")
    }

    #[cfg(test)]
    pub fn with_sink_as(sink: Arc<dyn EventSink>, device_id: &str) -> Self {
        ProcessManager {
            sink,
            servers: Mutex::new(HashMap::new()),
            device_id: device_id.to_string(),
            lifecycle: Mutex::new(None),
        }
    }

    fn shared_for(&self, id: &str) -> Shared {
        let mut map = self.servers.lock().unwrap();
        map.entry(id.to_string())
            .or_insert_with(|| Runtime {
                shared: Shared::new(id),
                child: None,
                stdin: None,
                adopted_pid: None,
                rcon: None,
            })
            .shared
            .clone()
    }

    pub fn snapshot(&self, id: &str) -> ProcSnapshot {
        self.shared_for(id).snapshot()
    }

    pub fn all_snapshots(&self) -> Vec<ProcSnapshot> {
        self.servers
            .lock()
            .unwrap()
            .values()
            .map(|r| r.shared.snapshot())
            .collect()
    }

    pub fn console(&self, id: &str) -> Vec<LogLine> {
        self.shared_for(id)
            .ring
            .lock()
            .unwrap()
            .iter()
            .cloned()
            .collect()
    }

    pub fn is_running(&self, id: &str) -> bool {
        matches!(
            *self.shared_for(id).status.lock().unwrap(),
            ServerStatus::Starting | ServerStatus::Running | ServerStatus::Stopping
        )
    }

    /// Any server currently starting/running/stopping — used to decide whether
    /// closing the window should hide to tray instead of quitting.
    pub fn any_active(&self) -> bool {
        self.servers.lock().unwrap().values().any(|r| {
            matches!(
                *r.shared.status.lock().unwrap(),
                ServerStatus::Starting | ServerStatus::Running | ServerStatus::Stopping
            )
        })
    }

    /// On launch: re-adopt every server that has a live session file so a
    /// restart never orphans one or mislabels it "external".
    pub fn adopt_all(&self, servers: &[ServerRecord]) {
        for rec in servers {
            let dir = Path::new(&rec.path);
            match crate::session::read(dir) {
                Some(sess) if crate::session::server_alive(sess.pid) => self.adopt(rec, sess),
                Some(_) => crate::session::clear(dir),
                None => {}
            }
        }
    }

    fn adopt(&self, rec: &ServerRecord, sess: crate::session::Session) {
        let shared = self.shared_for(&rec.id);
        *shared.pid.lock().unwrap() = Some(sess.pid);
        *shared.started_at.lock().unwrap() = Some(sess.started_at);
        *shared.exit_code.lock().unwrap() = None;
        shared.stop_requested.store(false, Ordering::SeqCst);
        shared.needs_eula.store(false, Ordering::SeqCst);
        shared.reattached.store(true, Ordering::SeqCst);
        {
            let mut map = self.servers.lock().unwrap();
            let rt = map.get_mut(&rec.id).unwrap();
            rt.adopted_pid = Some(sess.pid);
            rt.rcon = sess.rcon_port.zip(sess.rcon_password.clone());
        }
        shared.set_status(&self.sink, ServerStatus::Running);
        shared.push(
            &self.sink,
            "system",
            format!(
                "Reattached to this server (pid {}) after a CraftPanel restart. \
                 Live console output isn't captured, but Stop, Players (RCON) and Settings work.",
                sess.pid
            ),
        );
        spawn_adopted_monitor(
            self.sink.clone(),
            shared,
            rec.clone(),
            sess.pid,
            self.lifecycle(),
        );
    }

    pub fn start(&self, rec: &ServerRecord) -> Result<ProcSnapshot, String> {
        self.start_inner(rec, false)
    }

    /// `force`: override a live share lease and the port-in-use guard is done by
    /// the caller.
    pub fn start_forced(&self, rec: &ServerRecord) -> Result<ProcSnapshot, String> {
        self.start_inner(rec, true)
    }

    fn start_inner(&self, rec: &ServerRecord, force: bool) -> Result<ProcSnapshot, String> {
        if self.is_running(&rec.id) {
            return Err("Server is already running.".into());
        }

        let dir = Path::new(&rec.path);
        if !dir.is_dir() {
            return Err(format!("Server folder is missing: {}", rec.path));
        }

        // folder-shared server: take the advisory lease before we touch the world
        let is_shared = crate::share::read_share(dir).is_some();
        if is_shared {
            crate::share::claim(dir, &self.device_id, force)?;
        }
        // cloud-shared server: claim the R2 lease + pull a newer world
        let lifecycle = self.lifecycle();
        if let Some(lc) = &lifecycle {
            lc.before_start(rec, force)?;
        }

        ensure_user_jvm_args(rec);

        let mut cmd = build_command(rec)?;
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        let shared = self.shared_for(&rec.id);
        // fresh run: reset transient state, keep the ring so the user still sees
        // the previous session until the first new line arrives
        *shared.exit_code.lock().unwrap() = None;
        shared.stop_requested.store(false, Ordering::SeqCst);
        shared.needs_eula.store(false, Ordering::SeqCst);
        shared.reattached.store(false, Ordering::SeqCst);

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to launch java ({}): {e}", rec.java_path))?;

        let pid = child.id();
        let now = now_secs();
        *shared.pid.lock().unwrap() = Some(pid);
        *shared.started_at.lock().unwrap() = Some(now);
        shared.set_status(&self.sink, ServerStatus::Starting);
        shared.push(
            &self.sink,
            "system",
            format!("Launched pid {pid}: {}", describe_command(&cmd)),
        );

        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let stdin = child.stdin.take().unwrap();

        let child = Arc::new(Mutex::new(child));
        let stdin = Arc::new(Mutex::new(stdin));

        {
            let mut map = self.servers.lock().unwrap();
            let rt = map.get_mut(&rec.id).unwrap();
            rt.child = Some(child.clone());
            rt.stdin = Some(stdin.clone());
        }

        spawn_reader(self.sink.clone(), shared.clone(), stdout, "stdout");
        spawn_reader(self.sink.clone(), shared.clone(), stderr, "stderr");
        spawn_monitor(
            self.sink.clone(),
            shared.clone(),
            child.clone(),
            rec.clone(),
            lifecycle,
        );

        if is_shared {
            spawn_share_keeper(rec.path.clone(), self.device_id.clone(), child.clone());
        }
        if rec.sync_code.is_some() {
            if let Some(lc) = self.lifecycle() {
                spawn_cloud_keeper(rec.clone(), lc, child.clone());
            }
        }

        // record the session so a CraftPanel restart re-adopts (not "external")
        let (rcon_port, rcon_password) = rcon_endpoint_of(dir);
        crate::session::write(
            dir,
            &crate::session::Session {
                pid,
                launcher_pid: std::process::id(),
                started_at: now,
                rcon_port,
                rcon_password,
            },
        );

        if rec.keep_awake {
            spawn_keep_awake(&self.sink, shared.clone(), pid);
        }

        Ok(shared.snapshot())
    }

    /// Graceful: send `stop`, then force-kill after a timeout.
    pub fn stop(&self, id: &str) -> Result<(), String> {
        let shared = self.shared_for(id);
        if !self.is_running(id) {
            return Err("Server is not running.".into());
        }

        // re-adopted server: no stdin pipe — stop over RCON, else terminate the pid
        let (adopted_pid, rcon) = {
            let map = self.servers.lock().unwrap();
            let r = map.get(id);
            (
                r.and_then(|r| r.adopted_pid),
                r.and_then(|r| r.rcon.clone()),
            )
        };
        if let Some(pid) = adopted_pid {
            shared.stop_requested.store(true, Ordering::SeqCst);
            shared.set_status(&self.sink, ServerStatus::Stopping);
            let sent_rcon = match &rcon {
                Some((port, pw)) => {
                    match crate::rcon::RconClient::connect(("127.0.0.1", *port), pw) {
                        Ok(mut c) => {
                            shared.push(&self.sink, "system", "Stop requested — 'stop' over RCON…".into());
                            let _ = c.command("save-all");
                            let _ = c.command("stop");
                            true
                        }
                        Err(_) => false,
                    }
                }
                None => false,
            };
            if !sent_rcon {
                shared.push(&self.sink, "system", "Stop requested — terminating the process…".into());
                crate::session::terminate(pid);
            }
            let sink = self.sink.clone();
            let shared2 = shared.clone();
            thread::spawn(move || {
                for _ in 0..(GRACEFUL_STOP_SECS * 2) {
                    thread::sleep(Duration::from_millis(500));
                    if !crate::session::server_alive(pid) {
                        return;
                    }
                }
                shared2.push(&sink, "system", "Graceful stop timed out — killing process.".into());
                crate::session::force_kill(pid);
            });
            return Ok(());
        }

        shared.stop_requested.store(true, Ordering::SeqCst);
        shared.set_status(&self.sink, ServerStatus::Stopping);
        shared.push(&self.sink, "system", "Stop requested — sending 'stop'…".into());

        let _ = self.write_stdin(id, "stop");

        // watchdog: kill if it hasn't exited in time
        let child = self.servers.lock().unwrap().get(id).and_then(|r| r.child.clone());
        if let Some(child) = child {
            let sink = self.sink.clone();
            let shared = shared.clone();
            thread::spawn(move || {
                for _ in 0..(GRACEFUL_STOP_SECS * 2) {
                    thread::sleep(Duration::from_millis(500));
                    if child.lock().unwrap().try_wait().ok().flatten().is_some() {
                        return;
                    }
                }
                shared.push(&sink, "system", "Graceful stop timed out — killing process.".into());
                let _ = child.lock().unwrap().kill();
            });
        }
        Ok(())
    }

    /// Force kill now.
    pub fn kill(&self, id: &str) -> Result<(), String> {
        let shared = self.shared_for(id);
        shared.stop_requested.store(true, Ordering::SeqCst);

        let adopted_pid = self.servers.lock().unwrap().get(id).and_then(|r| r.adopted_pid);
        if let Some(pid) = adopted_pid {
            shared.push(&self.sink, "system", "Force killing process.".into());
            crate::session::force_kill(pid);
            return Ok(());
        }

        let child = self.servers.lock().unwrap().get(id).and_then(|r| r.child.clone());
        match child {
            Some(child) => {
                shared.push(&self.sink, "system", "Force killing process.".into());
                child.lock().unwrap().kill().map_err(|e| e.to_string())
            }
            None => Err("Server is not running.".into()),
        }
    }

    pub fn write_stdin(&self, id: &str, line: &str) -> Result<(), String> {
        let (stdin, adopted) = {
            let map = self.servers.lock().unwrap();
            let r = map.get(id);
            (
                r.and_then(|r| r.stdin.clone()),
                r.map(|r| r.adopted_pid.is_some()).unwrap_or(false),
            )
        };
        match stdin {
            Some(stdin) => {
                let mut w = stdin.lock().unwrap();
                writeln!(w, "{line}").map_err(|e| e.to_string())?;
                w.flush().map_err(|e| e.to_string())
            }
            None if adopted => Err(
                "This server was reattached after a restart — send commands from the Players tab (RCON)."
                    .into(),
            ),
            None => Err("Server is not running.".into()),
        }
    }

    /// Write `eula=true` to eula.txt so the next launch proceeds.
    pub fn accept_eula(&self, rec: &ServerRecord) -> Result<(), String> {
        write_eula_true(Path::new(&rec.path)).map_err(|e| e.to_string())?;
        self.shared_for(&rec.id).needs_eula.store(false, Ordering::SeqCst);
        Ok(())
    }

    /// On app exit (tray → Quit): stop every server we're running — gracefully
    /// if we can, then force — drop any share leases we hold, and clear session
    /// files so the next launch starts clean.
    /// Quit but leave running servers alive (the "keep servers running" pref).
    /// Drop only the share leases we hold; session files stay so the next
    /// launch re-adopts.
    pub fn release_leases_only(&self, server_dirs: &[String]) {
        for dir in server_dirs {
            crate::share::release(Path::new(dir), &self.device_id);
        }
    }

    pub fn shutdown_and_release(&self, server_dirs: &[String]) {
        let children: Vec<(String, Arc<Mutex<Child>>)> = {
            let map = self.servers.lock().unwrap();
            map.iter()
                .filter_map(|(id, r)| r.child.clone().map(|c| (id.clone(), c)))
                .collect()
        };
        let adopted: Vec<u32> = {
            let map = self.servers.lock().unwrap();
            map.values().filter_map(|r| r.adopted_pid).collect()
        };

        for (id, _) in &children {
            self.shared_for(id).stop_requested.store(true, Ordering::SeqCst);
            let _ = self.write_stdin(id, "stop");
        }
        for pid in &adopted {
            crate::session::terminate(*pid);
        }

        // wait up to ~12 s for clean exits (cloud servers upload their world here)
        for _ in 0..24 {
            let still_up = children
                .iter()
                .any(|(_, c)| c.lock().unwrap().try_wait().ok().flatten().is_none())
                || adopted.iter().any(|p| crate::session::server_alive(*p));
            if !still_up {
                break;
            }
            thread::sleep(Duration::from_millis(500));
        }

        for (_, c) in &children {
            let _ = c.lock().unwrap().kill();
        }
        for pid in &adopted {
            crate::session::force_kill(*pid);
        }
        for dir in server_dirs {
            crate::share::release(Path::new(dir), &self.device_id);
            crate::session::clear(Path::new(dir));
        }
    }
}

/// Has the Minecraft EULA been accepted in this folder? (`eula=true` in eula.txt)
pub fn eula_accepted(dir: &Path) -> bool {
    match fs::read_to_string(dir.join("eula.txt")) {
        Ok(text) => text.lines().any(|l| {
            let l = l.trim();
            !l.starts_with('#') && l.replace(char::is_whitespace, "").eq_ignore_ascii_case("eula=true")
        }),
        Err(_) => false,
    }
}

fn write_eula_true(dir: &Path) -> std::io::Result<()> {
    fs::write(
        dir.join("eula.txt"),
        "# Accepted via CraftPanel — https://aka.ms/MinecraftEULA\neula=true\n",
    )
}

fn spawn_reader<R: std::io::Read + Send + 'static>(
    sink: Arc<dyn EventSink>,
    shared: Shared,
    pipe: R,
    stream: &'static str,
) {
    thread::spawn(move || {
        let adapter = MinecraftAdapter;
        let reader = BufReader::new(pipe);
        for line in reader.lines() {
            let Ok(text) = line else { break };

            if text.contains("You need to agree to the EULA") {
                shared.needs_eula.store(true, Ordering::SeqCst);
            }
            // promote Starting -> Running once the server reports ready
            if *shared.status.lock().unwrap() == ServerStatus::Starting {
                if adapter.parse_status(&text) == ServerStatus::Running {
                    shared.set_status(&sink, ServerStatus::Running);
                }
            }
            shared.push(&sink, stream, text);
        }
    });
}

/// Refresh the share lease while the server runs; release it when it exits.
fn spawn_share_keeper(dir: String, device_id: String, child: Arc<Mutex<Child>>) {
    thread::spawn(move || {
        let path = Path::new(&dir);
        loop {
            for _ in 0..60 {
                thread::sleep(Duration::from_millis(500));
                if child.lock().unwrap().try_wait().ok().flatten().is_some() {
                    crate::share::release(path, &device_id);
                    return;
                }
            }
            crate::share::heartbeat(path, &device_id);
        }
    });
}

/// Refresh the R2 sync lease every 60 s while a cloud server runs.
fn spawn_cloud_keeper(
    rec: ServerRecord,
    lc: Arc<dyn ServerLifecycle>,
    child: Arc<Mutex<Child>>,
) {
    thread::spawn(move || loop {
        for _ in 0..120 {
            thread::sleep(Duration::from_millis(500));
            if child.lock().unwrap().try_wait().ok().flatten().is_some() {
                return;
            }
        }
        lc.heartbeat(&rec);
    });
}

/// RCON `(port, password)` from a server's `server.properties`, if enabled.
fn rcon_endpoint_of(dir: &Path) -> (Option<u16>, Option<String>) {
    let props = crate::properties::Properties::load(dir);
    if props.get_or("enable-rcon", "false") != "true" {
        return (None, None);
    }
    (
        props.get("rcon.port").and_then(|s| s.parse::<u16>().ok()),
        props.get("rcon.password").filter(|s| !s.is_empty()),
    )
}

/// Hold a power assertion for the server's lifetime so the Mac doesn't idle-
/// sleep. `caffeinate -w <pid>` exits by itself when the server does.
fn spawn_keep_awake(sink: &Arc<dyn EventSink>, shared: Shared, pid: u32) {
    #[cfg(target_os = "macos")]
    {
        match Command::new("caffeinate")
            .args(["-i", "-s", "-w", &pid.to_string()])
            .spawn()
        {
            Ok(mut child) => {
                thread::spawn(move || {
                    let _ = child.wait();
                });
                shared.push(
                    sink,
                    "system",
                    "Keep-awake on — this Mac won't idle-sleep while the server runs. \
                     (With the lid shut it still sleeps unless plugged in.)"
                        .into(),
                );
            }
            Err(e) => shared.push(sink, "system", format!("Keep-awake couldn't start: {e}")),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = pid;
        shared.push(
            sink,
            "system",
            "Keep-awake is macOS-only for now — this setting has no effect here yet.".into(),
        );
    }
}

/// Watch a re-adopted server (we only have its pid). When the pid goes away,
/// mark it stopped and clear the session file; heartbeat the cloud lease
/// meanwhile so another device doesn't grab a still-running world.
fn spawn_adopted_monitor(
    sink: Arc<dyn EventSink>,
    shared: Shared,
    rec: ServerRecord,
    pid: u32,
    lifecycle: Option<Arc<dyn ServerLifecycle>>,
) {
    thread::spawn(move || {
        let mut ticks: u32 = 0;
        loop {
            thread::sleep(Duration::from_secs(2));
            if !crate::session::server_alive(pid) {
                *shared.pid.lock().unwrap() = None;
                shared.push(&sink, "system", "Reattached server exited.".into());
                shared.set_status(&sink, ServerStatus::Stopped);
                crate::session::clear(Path::new(&rec.path));
                if let Some(lc) = &lifecycle {
                    lc.after_exit(&rec);
                }
                return;
            }
            ticks += 1;
            if rec.sync_code.is_some() && ticks % 30 == 0 {
                if let Some(lc) = &lifecycle {
                    lc.heartbeat(&rec);
                }
            }
        }
    });
}

fn spawn_monitor(
    sink: Arc<dyn EventSink>,
    shared: Shared,
    child: Arc<Mutex<Child>>,
    rec: ServerRecord,
    lifecycle: Option<Arc<dyn ServerLifecycle>>,
) {
    thread::spawn(move || loop {
        thread::sleep(Duration::from_millis(400));
        let exit = { child.lock().unwrap().try_wait() };
        match exit {
            Ok(Some(status)) => {
                let code = status.code();
                *shared.exit_code.lock().unwrap() = code;
                *shared.pid.lock().unwrap() = None;

                let requested = shared.stop_requested.load(Ordering::SeqCst);
                let clean = code == Some(0);
                let final_status = if requested || clean {
                    ServerStatus::Stopped
                } else {
                    ServerStatus::Crashed
                };
                let how = match code {
                    Some(c) => format!("exit code {c}"),
                    None => "terminated by signal".to_string(),
                };
                shared.push(
                    &sink,
                    "system",
                    format!(
                        "Process ended ({how}) — {}",
                        match final_status {
                            ServerStatus::Crashed => "crash",
                            _ => "stopped",
                        }
                    ),
                );
                shared.set_status(&sink, final_status);
                crate::session::clear(Path::new(&rec.path));
                if let Some(lc) = &lifecycle {
                    lc.after_exit(&rec);
                }
                return;
            }
            Ok(None) => {}
            Err(_) => return,
        }
    });
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Ensure `-Xms`/`-Xmx` land even when we launch via a Forge args file, which
/// reads JVM flags from `user_jvm_args.txt` rather than argv.
fn ensure_user_jvm_args(rec: &ServerRecord) {
    if rec.server_type != crate::adapter::ServerType::Forge {
        return;
    }
    let dir = Path::new(&rec.path);
    if forge_args_file(dir).is_none() {
        return;
    }
    let path = dir.join("user_jvm_args.txt");
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let kept: Vec<&str> = existing
        .lines()
        .filter(|l| {
            let t = l.trim_start();
            !t.starts_with("-Xmx") && !t.starts_with("-Xms")
        })
        .collect();
    // drop any of our previously-written extra flags too, then re-add
    let extra = jvm_arg_tokens(rec);
    let kept: Vec<&str> = kept
        .into_iter()
        .filter(|l| !extra.iter().any(|e| e == l.trim()))
        .collect();
    let mut out = kept.join("\n");
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(&format!("-Xms{}M\n-Xmx{}M\n", rec.ram_mb, rec.ram_mb));
    for t in &extra {
        out.push_str(t);
        out.push('\n');
    }
    let _ = fs::write(path, out);
}

/// Extra JVM flags for this server (Aikar's / GC tuning), whitespace-split.
pub(crate) fn jvm_arg_tokens(rec: &ServerRecord) -> Vec<String> {
    rec.jvm_args
        .as_deref()
        .unwrap_or("")
        .split_whitespace()
        .filter(|t| t.starts_with('-'))
        .map(|t| t.to_string())
        .collect()
}

pub(crate) fn forge_args_file(dir: &Path) -> Option<String> {
    let file = if cfg!(windows) { "win_args.txt" } else { "unix_args.txt" };
    for base in [
        "libraries/net/minecraftforge/forge",
        "libraries/net/neoforged/neoforge",
    ] {
        let root = dir.join(base);
        if let Ok(rd) = fs::read_dir(&root) {
            for entry in rd.flatten() {
                let candidate = entry.path().join(file);
                if candidate.is_file() {
                    // return path relative to the server dir, forward slashes
                    let rel = candidate.strip_prefix(dir).unwrap_or(&candidate);
                    return Some(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
    }
    None
}

pub(crate) fn build_command(rec: &ServerRecord) -> Result<Command, String> {
    use crate::adapter::ServerType;
    let dir = Path::new(&rec.path);
    let mut cmd = Command::new(&rec.java_path);
    cmd.current_dir(dir);

    let target_lower = rec.launch_target.to_ascii_lowercase();

    if rec.server_type == ServerType::Forge {
        if let Some(argfile) = forge_args_file(dir) {
            // JVM heap flags come from user_jvm_args.txt (written by ensure_user_jvm_args)
            cmd.arg("@user_jvm_args.txt");
            cmd.arg(format!("@{argfile}"));
            cmd.arg("nogui");
            return Ok(cmd);
        }
        if target_lower.ends_with(".sh") || target_lower.ends_with(".bat") {
            return Err(
                "This Forge server only has a run script and no args file. \
                 Re-run the Forge installer, or point the launch target at the forge jar."
                    .into(),
            );
        }
    }

    cmd.arg(format!("-Xms{}M", rec.ram_mb));
    cmd.arg(format!("-Xmx{}M", rec.ram_mb));
    for t in jvm_arg_tokens(rec) {
        cmd.arg(t);
    }
    cmd.arg("-jar").arg(&rec.launch_target).arg("nogui");
    Ok(cmd)
}

fn describe_command(cmd: &Command) -> String {
    let prog = cmd.get_program().to_string_lossy().to_string();
    let args: Vec<String> = cmd
        .get_args()
        .map(|a| a.to_string_lossy().to_string())
        .collect();
    format!("{prog} {}", args.join(" "))
}

/// The exact `java …` line this server would launch with (for the UI).
pub(crate) fn describe_launch(rec: &ServerRecord) -> String {
    match build_command(rec) {
        Ok(cmd) => describe_command(&cmd),
        Err(e) => format!("(can't resolve: {e})"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::adapter::ServerType;

    fn rec(dir: &Path, ty: ServerType, target: &str) -> ServerRecord {
        ServerRecord {
            id: "x".into(),
            name: "x".into(),
            path: dir.to_string_lossy().to_string(),
            server_type: ty,
            launch_target: target.into(),
            mc_version: None,
            java_path: "java".into(),
            ram_mb: 3072,
            created_at: 0,
            sync_code: None,
            keep_awake: false,
            jvm_args: None,
        }
    }

    #[test]
    fn builds_jar_command_with_equal_heap() {
        let d = std::env::temp_dir();
        let cmd = build_command(&rec(&d, ServerType::Paper, "paper.jar")).unwrap();
        let s = describe_command(&cmd);
        assert!(s.contains("-Xms3072M"));
        assert!(s.contains("-Xmx3072M"));
        assert!(s.ends_with("-jar paper.jar nogui"));
    }

    #[test]
    fn eula_accepted_reads_the_file() {
        let d = std::env::temp_dir().join("cp-eula");
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        assert!(!eula_accepted(&d));
        fs::write(d.join("eula.txt"), "#comment\neula=false\n").unwrap();
        assert!(!eula_accepted(&d));
        fs::write(d.join("eula.txt"), "# a comment\neula = TRUE\n").unwrap();
        assert!(eula_accepted(&d));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn forge_with_args_file_uses_at_syntax() {
        let d = std::env::temp_dir().join("cp-forge-args");
        let libs = d.join("libraries/net/minecraftforge/forge/1.20.4-49.0.3");
        let _ = fs::create_dir_all(&libs);
        fs::write(libs.join("unix_args.txt"), b"-jar\nforge.jar").unwrap();

        let r = rec(&d, ServerType::Forge, "run.sh");
        ensure_user_jvm_args(&r);
        let cmd = build_command(&r).unwrap();
        let s = describe_command(&cmd);
        assert!(s.contains("@user_jvm_args.txt"));
        assert!(s.contains("@libraries/net/minecraftforge/forge/1.20.4-49.0.3/unix_args.txt"));

        let jvm = fs::read_to_string(d.join("user_jvm_args.txt")).unwrap();
        assert!(jvm.contains("-Xmx3072M"));
        let _ = fs::remove_dir_all(&d);
    }

    // --- live process lifecycle (unix; uses a stand-in for `java`) ----------

    #[derive(Default)]
    struct CollectSink {
        logs: Mutex<Vec<LogLine>>,
        statuses: Mutex<Vec<ServerStatus>>,
    }
    impl EventSink for CollectSink {
        fn log(&self, l: &LogLine) {
            self.logs.lock().unwrap().push(l.clone());
        }
        fn status(&self, s: &ProcSnapshot) {
            self.statuses.lock().unwrap().push(s.status);
        }
    }

    #[cfg(unix)]
    fn fake_java(dir: &Path, crash: bool) -> String {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join("fake-java.sh");
        let body = if crash {
            "#!/bin/sh\necho 'Starting minecraft server version 1.21.1'\necho 'Exception in server tick loop' 1>&2\nexit 1\n".to_string()
        } else {
            "#!/bin/sh\n\
             echo 'Starting minecraft server version 1.21.1'\n\
             echo 'Done (0.1s)! For help, type \"help\"'\n\
             while IFS= read -r line; do\n\
               if [ \"$line\" = stop ]; then echo 'Stopping the server'; exit 0; fi\n\
               echo \"Unknown command: $line\"\n\
             done\n\
             exit 0\n".to_string()
        };
        fs::write(&path, body).unwrap();
        let mut p = fs::metadata(&path).unwrap().permissions();
        p.set_mode(0o755);
        fs::set_permissions(&path, p).unwrap();
        path.to_string_lossy().to_string()
    }

    fn wait_until(label: &str, mut cond: impl FnMut() -> bool) {
        for _ in 0..100 {
            if cond() {
                return;
            }
            thread::sleep(Duration::from_millis(100));
        }
        panic!("timed out waiting for: {label}");
    }

    #[test]
    #[cfg(unix)]
    fn full_lifecycle_start_ready_stop() {
        let d = std::env::temp_dir().join("cp-life");
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("server.jar"), b"").unwrap();

        let mut r = rec(&d, ServerType::Vanilla, "server.jar");
        r.id = "life".into();
        r.java_path = fake_java(&d, false);

        let sink = Arc::new(CollectSink::default());
        let pm = ProcessManager::with_sink(sink.clone());
        pm.start(&r).unwrap();

        wait_until("running", || pm.snapshot("life").status == ServerStatus::Running);
        assert!(pm.console("life").iter().any(|l| l.text.contains("Done (")));

        pm.write_stdin("life", "list").unwrap();
        wait_until("echo of command", || {
            pm.console("life").iter().any(|l| l.text.contains("Unknown command: list"))
        });

        pm.stop("life").unwrap();
        wait_until("stopped", || pm.snapshot("life").status == ServerStatus::Stopped);
        assert_eq!(pm.snapshot("life").exit_code, Some(0));

        let seen = sink.statuses.lock().unwrap().clone();
        assert!(seen.contains(&ServerStatus::Starting));
        assert!(seen.contains(&ServerStatus::Running));
        assert!(seen.contains(&ServerStatus::Stopping));
        assert!(seen.contains(&ServerStatus::Stopped));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    #[cfg(unix)]
    fn crash_is_detected() {
        let d = std::env::temp_dir().join("cp-crash");
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("server.jar"), b"").unwrap();

        let mut r = rec(&d, ServerType::Vanilla, "server.jar");
        r.id = "crash".into();
        r.java_path = fake_java(&d, true);

        let pm = ProcessManager::with_sink(Arc::new(CollectSink::default()));
        pm.start(&r).unwrap();

        wait_until("crashed", || pm.snapshot("crash").status == ServerStatus::Crashed);
        assert_eq!(pm.snapshot("crash").exit_code, Some(1));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    #[cfg(unix)]
    fn shared_server_lease_blocks_second_device() {
        let d = std::env::temp_dir().join("cp-share-life");
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("server.jar"), b"").unwrap();
        crate::share::create_share(&d, "shared").unwrap();

        let mut r = rec(&d, ServerType::Vanilla, "server.jar");
        r.id = "sh".into();
        r.java_path = fake_java(&d, false);

        let pm_a = ProcessManager::with_sink_as(Arc::new(CollectSink::default()), "device-A");
        let pm_b = ProcessManager::with_sink_as(Arc::new(CollectSink::default()), "device-B");

        // A starts → holds the lease
        pm_a.start(&r).unwrap();
        wait_until("running", || pm_a.snapshot("sh").status == ServerStatus::Running);
        assert!(d.join(crate::share::LEASE_FILE).exists());

        // B is refused while A holds a live lease
        let err = pm_b.start(&r).unwrap_err();
        assert!(err.contains("In use on"), "got: {err}");

        // A stops → lease released → B can start
        pm_a.stop("sh").unwrap();
        wait_until("released", || !d.join(crate::share::LEASE_FILE).exists());
        pm_b.start(&r).unwrap();
        wait_until("B running", || pm_b.snapshot("sh").status == ServerStatus::Running);
        pm_b.kill("sh").unwrap();
        wait_until("B stopped", || {
            !matches!(pm_b.snapshot("sh").status, ServerStatus::Running | ServerStatus::Starting)
        });
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    #[cfg(unix)]
    fn kill_marks_crashed_when_not_requested() {
        let d = std::env::temp_dir().join("cp-kill");
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("server.jar"), b"").unwrap();

        let mut r = rec(&d, ServerType::Vanilla, "server.jar");
        r.id = "kill".into();
        r.java_path = fake_java(&d, false);

        let pm = ProcessManager::with_sink(Arc::new(CollectSink::default()));
        pm.start(&r).unwrap();
        wait_until("running", || pm.snapshot("kill").status == ServerStatus::Running);

        // kill() sets stop_requested, so the monitor should report Stopped, not Crashed
        pm.kill("kill").unwrap();
        wait_until("stopped", || {
            matches!(
                pm.snapshot("kill").status,
                ServerStatus::Stopped | ServerStatus::Crashed
            )
        });
        assert_eq!(pm.snapshot("kill").status, ServerStatus::Stopped);
        let _ = fs::remove_dir_all(&d);
    }
}
