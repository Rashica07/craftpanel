import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { PlayerAction, PlayerList, RconSettings } from "../types";
import { Badge, Button } from "./ui";

export function RconPanel({
  serverId,
  reachable,
  onNeedsRestart,
}: {
  serverId: string;
  /** server is up (our process or external) so RCON could connect */
  reachable: boolean;
  onNeedsRestart?: () => void;
}) {
  const [settings, setSettings] = useState<RconSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [list, setList] = useState<PlayerList | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [cmd, setCmd] = useState("");

  const loadSettings = useCallback(() => {
    api.rconSettings(serverId).then(setSettings).catch((e) => setError(String(e)));
  }, [serverId]);

  useEffect(() => {
    setSettings(null);
    setList(null);
    setNote(null);
    setError(null);
    loadSettings();
  }, [serverId, loadSettings]);

  // poll players while RCON is enabled and the server is reachable
  useEffect(() => {
    if (!settings?.enabled || !reachable) {
      setList(null);
      return;
    }
    let alive = true;
    const tick = () =>
      api
        .rconPlayers(serverId)
        .then((l) => {
          if (!alive) return;
          setList(l);
          setError(null);
        })
        .catch((e) => alive && setError(String(e)));
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [serverId, settings?.enabled, reachable]);

  async function enableRcon() {
    setBusy(true);
    setError(null);
    try {
      const r = await api.rconSetup(serverId);
      setNote(
        `Wrote ${r.changed.join(", ")} to server.properties.` +
          (r.restartRequired ? "" : " RCON is ready on next start."),
      );
      if (r.restartRequired) onNeedsRestart?.();
      loadSettings();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function act(action: PlayerAction, player: string, arg?: string) {
    setBusy(true);
    setError(null);
    try {
      const out = await api.rconPlayerAction(serverId, action, player, arg);
      setNote(out.trim() || `${action} ${player} ✓`);
      setSelected(null);
      api.rconPlayers(serverId).then(setList).catch(() => {});
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendCmd() {
    const c = cmd.trim();
    if (!c) return;
    setCmd("");
    setBusy(true);
    setError(null);
    try {
      const out = await api.rconCommand(serverId, c);
      setNote(out.trim() || `${c} ✓`);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-edge bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
          Players &amp; RCON
        </span>
        {settings && (
          <Badge tone={settings.enabled ? "ok" : "neutral"}>
            {settings.enabled ? `RCON :${settings.port}` : "RCON off"}
          </Badge>
        )}
      </div>

      {!settings ? (
        <div className="text-xs text-ink-faint">Checking…</div>
      ) : !settings.propertiesPresent ? (
        <div className="text-xs text-ink-faint">
          Start the server once so it writes <code>server.properties</code>, then
          you can enable RCON here.
        </div>
      ) : !settings.enabled ? (
        <div className="space-y-2">
          <p className="text-xs text-ink-dim">
            RCON lets CraftPanel read the player list and run commands. Enabling it
            writes only <code>enable-rcon</code>, <code>rcon.port</code>,{" "}
            <code>rcon.password</code> and <code>broadcast-rcon-to-ops</code> —
            nothing else is touched.
          </p>
          <Button variant="primary" onClick={enableRcon} disabled={busy}>
            {busy ? "Writing…" : "Enable RCON"}
          </Button>
        </div>
      ) : !reachable ? (
        <div className="text-xs text-ink-faint">
          RCON is configured on port {settings.port}. Start the server to see who's
          online.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-ink-dim">
            {list ? `${list.online} / ${list.max} online` : "Connecting to RCON…"}
          </div>
          <ul className="space-y-1">
            {list?.players.map((p) => (
              <li key={p} className="rounded-md bg-panel-2">
                <button
                  onClick={() => setSelected(selected === p ? null : p)}
                  className="flex w-full items-center justify-between px-2 py-1.5 text-left text-sm hover:bg-panel-3"
                >
                  <span>{p}</span>
                  <span className="text-xs text-ink-faint">manage</span>
                </button>
                {selected === p && (
                  <div className="flex flex-wrap gap-1 border-t border-edge p-2">
                    <Button variant="subtle" onClick={() => act("kick", p)} disabled={busy}>
                      Kick
                    </Button>
                    <Button variant="danger" onClick={() => act("ban", p)} disabled={busy}>
                      Ban
                    </Button>
                    <Button variant="subtle" onClick={() => act("op", p)} disabled={busy}>
                      Op
                    </Button>
                    <Button variant="subtle" onClick={() => act("deop", p)} disabled={busy}>
                      De-op
                    </Button>
                    <Button
                      variant="subtle"
                      onClick={() => act("whitelist-add", p)}
                      disabled={busy}
                    >
                      Whitelist +
                    </Button>
                    <select
                      onChange={(e) => e.target.value && act("gamemode", p, e.target.value)}
                      defaultValue=""
                      disabled={busy}
                      className="rounded-md border border-edge bg-panel-2 px-2 py-1 text-xs text-ink"
                    >
                      <option value="" disabled>
                        gamemode…
                      </option>
                      <option value="survival">survival</option>
                      <option value="creative">creative</option>
                      <option value="adventure">adventure</option>
                      <option value="spectator">spectator</option>
                    </select>
                  </div>
                )}
              </li>
            ))}
            {list && list.players.length === 0 && (
              <li className="px-2 py-1 text-xs text-ink-faint">Nobody online.</li>
            )}
          </ul>

          <div className="flex items-center gap-2 border-t border-edge pt-2">
            <span className="font-mono text-xs text-ink-faint">/</span>
            <input
              value={cmd}
              onChange={(e) => setCmd(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendCmd()}
              placeholder="RCON command"
              className="flex-1 bg-transparent font-mono text-xs text-ink outline-none placeholder:text-ink-faint"
            />
            <Button variant="subtle" onClick={sendCmd} disabled={busy || !cmd.trim()}>
              Run
            </Button>
          </div>
        </div>
      )}

      {note && <div className="mt-2 rounded bg-panel-2 px-2 py-1 text-xs text-ink-dim">{note}</div>}
      {error && (
        <div className="mt-2 rounded border border-bad/30 bg-bad/10 px-2 py-1 text-xs text-bad">
          {error}
        </div>
      )}
    </div>
  );
}
