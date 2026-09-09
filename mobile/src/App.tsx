import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  api,
  clearPairing,
  getPairing,
  parsePairingPayload,
  setPairing,
  type LogLine,
  type PlayerList,
  type ServerSummary,
} from "./api";
import "./App.css";

export default function App() {
  const [paired, setPaired] = useState(() => getPairing() !== null);
  const [openServerId, setOpenServerId] = useState<string | null>(null);

  if (!paired) return <PairScreen onPaired={() => setPaired(true)} />;

  return (
    <div className="app">
      {openServerId ? (
        <ServerScreen id={openServerId} onBack={() => setOpenServerId(null)} />
      ) : (
        <ServersScreen
          onOpen={setOpenServerId}
          onForget={() => {
            clearPairing();
            setPaired(false);
          }}
        />
      )}
    </div>
  );
}

/* ───────────────────────────── Pairing ───────────────────────────── */

function PairScreen({ onPaired }: { onPaired: () => void }) {
  const [payload, setPayload] = useState("");
  const [manual, setManual] = useState(false);
  const [host, setHost] = useState("");
  const [port, setPort] = useState("8642");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function connect(p: { host: string; port: number; token: string }) {
    setBusy(true);
    setError(null);
    try {
      setPairing(p);
      await api.listServers(); // fail fast if the token/host is wrong
      onPaired();
    } catch (e) {
      clearPairing();
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  function submitPayload(e: React.FormEvent) {
    e.preventDefault();
    try {
      connect(parsePairingPayload(payload));
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  function submitManual(e: React.FormEvent) {
    e.preventDefault();
    const p = Number(port);
    if (!host.trim() || !Number.isFinite(p) || !token.trim()) {
      setError("Fill in host, port, and token.");
      return;
    }
    connect({ host: host.trim(), port: p, token: token.trim() });
  }

  return (
    <div className="app">
      <div className="scroll" style={{ paddingTop: 48 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div className="brand" style={{ fontSize: 22 }}>
            Craft<span className="accent">Panel</span>
          </div>
          <div style={{ color: "var(--ink-faint)", fontSize: 13, marginTop: 4 }}>
            Connect to your desktop app
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {!manual ? (
          <form onSubmit={submitPayload}>
            <div className="field">
              <label>Pairing code</label>
              <textarea
                autoFocus
                placeholder='Paste the code from CraftPanel → Settings → Remote access → "Copy"'
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
              />
            </div>
            <button className="action primary" type="submit" disabled={busy} style={{ width: "100%" }}>
              {busy ? "Connecting…" : "Connect"}
            </button>
            <button
              type="button"
              className="iconbtn"
              style={{ display: "block", margin: "14px auto 0" }}
              onClick={() => setManual(true)}
            >
              Enter details manually instead
            </button>
          </form>
        ) : (
          <form onSubmit={submitManual}>
            <div className="field">
              <label>Host or IP</label>
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="203.0.113.4" />
            </div>
            <div className="field">
              <label>Port</label>
              <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="8642" />
            </div>
            <div className="field">
              <label>Token</label>
              <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="cp_…" />
            </div>
            <button className="action primary" type="submit" disabled={busy} style={{ width: "100%" }}>
              {busy ? "Connecting…" : "Connect"}
            </button>
            <button
              type="button"
              className="iconbtn"
              style={{ display: "block", margin: "14px auto 0" }}
              onClick={() => setManual(false)}
            >
              Paste a code instead
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────── Servers list ───────────────────────────── */

function ServersScreen({ onOpen, onForget }: { onOpen: (id: string) => void; onForget: () => void }) {
  const [servers, setServers] = useState<ServerSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .listServers()
      .then((s) => {
        setServers(s);
        setError(null);
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function toggle(s: ServerSummary) {
    setBusyId(s.id);
    try {
      if (s.status === "running") await api.stop(s.id);
      else await api.start(s.id);
      load();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="topbar">
        <h1>
          Craft<span style={{ color: "var(--accent)" }}>Panel</span>
        </h1>
        <button className="iconbtn" onClick={onForget}>
          Disconnect
        </button>
      </div>
      <div className="scroll">
        {error && <div className="error-banner">{error}</div>}
        {servers === null && !error && <div className="empty">Loading servers…</div>}
        {servers?.length === 0 && <div className="empty">No servers on this install yet.</div>}
        {servers?.map((s) => (
          <button key={s.id} className="server-row" onClick={() => onOpen(s.id)}>
            <span className={`dot ${s.status}`} />
            <span className="meta">
              <div className="name">{s.name}</div>
              <div className="sub">
                {s.server_type}
                {s.mc_version ? ` · ${s.mc_version}` : ""}
              </div>
            </span>
            <span className={`pill ${s.status}`}>{s.status}</span>
            <button
              className={`action ${s.status === "running" ? "danger" : "primary"}`}
              disabled={busyId === s.id || s.status === "starting" || s.status === "stopping"}
              onClick={(e) => {
                e.stopPropagation();
                toggle(s);
              }}
            >
              {s.status === "running" ? "Stop" : "Start"}
            </button>
          </button>
        ))}
        <JvmSmokeTest />
      </div>
    </>
  );
}

/* ── Local Java hosting (beta) — proof-of-life for the embedded JVM ── */

function JvmSmokeTest() {
  const [state, setState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const [detail, setDetail] = useState("");

  async function run() {
    setState("busy");
    setDetail("");
    try {
      const version = await invoke<string>("jvm_smoke_test");
      setState("ok");
      setDetail(version);
    } catch (e) {
      setState("err");
      setDetail(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <div className="card" style={{ marginTop: 16, opacity: 0.85 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
        Local Java hosting — engineering check
      </div>
      <div style={{ fontSize: 12, color: "var(--ink-faint)", marginBottom: 10 }}>
        Not a real feature yet — this only proves an embedded JVM can start on this phone at all.
      </div>
      <button className="action ghost" onClick={run} disabled={state === "busy"}>
        {state === "busy" ? "Starting a JVM…" : "Run smoke test"}
      </button>
      {state === "ok" && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--ok)" }}>✓ JVM started — java.version = {detail}</div>
      )}
      {state === "err" && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--bad)" }}>✗ {detail}</div>
      )}
    </div>
  );
}

/* ───────────────────────────── Server detail ───────────────────────────── */

function ServerScreen({ id, onBack }: { id: string; onBack: () => void }) {
  const [server, setServer] = useState<ServerSummary | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [players, setPlayers] = useState<PlayerList | null>(null);
  const [cmd, setCmd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const consoleRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    api.getServer(id).then(setServer).catch((e) => setError(String(e instanceof Error ? e.message : e)));
    api.console(id).then(setLines).catch(() => {});
    api.players(id).then(setPlayers).catch(() => setPlayers(null));
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!cmd.trim()) return;
    try {
      await api.sendConsole(id, cmd.trim());
      setCmd("");
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  async function toggle() {
    if (!server) return;
    try {
      if (server.status === "running") await api.stop(id);
      else await api.start(id);
      load();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  }

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" onClick={onBack}>
          ← Back
        </button>
        <h1 style={{ textAlign: "center" }}>{server?.name ?? "…"}</h1>
        <span style={{ width: 48 }} />
      </div>
      <div className="scroll">
        {error && <div className="error-banner">{error}</div>}

        {server && (
          <div className="card">
            <div className="stat">
              <span>Status</span>
              <span className={`pill ${server.status}`}>{server.status}</span>
            </div>
            <div className="stat">
              <span>Type</span>
              <span>
                {server.server_type}
                {server.mc_version ? ` · ${server.mc_version}` : ""}
              </span>
            </div>
            <div className="stat">
              <span>Players</span>
              <span>{players ? `${players.online} / ${players.max}` : "—"}</span>
            </div>
            <button
              className={`action ${server.status === "running" ? "danger" : "primary"}`}
              style={{ width: "100%", marginTop: 12 }}
              disabled={server.status === "starting" || server.status === "stopping"}
              onClick={toggle}
            >
              {server.status === "running" ? "Stop server" : "Start server"}
            </button>
          </div>
        )}

        <div className="card">
          <div ref={consoleRef} className="console">
            {lines.length === 0 ? "No console output yet." : lines.map((l) => l.text).join("\n")}
          </div>
          <form className="consoleform" onSubmit={send}>
            <input
              placeholder="Type a command…"
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
            />
            <button className="action primary" type="submit">
              Send
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
