import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { PlayerAction, PlayerList, RconSettings } from "../types";
import {
  Badge,
  Button,
  Card,
  Select,
  StateBlock,
  Tooltip,
  cx,
  toast,
} from "./ui";
import { ErrorBanner } from "./ErrorBanner";
import { Icon } from "./Icon";
import { CommandInput } from "./CommandInput";

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
      toast.ok("Remote console enabled", r.changed.join(", "));
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

  const online = list?.players ?? [];

  return (
    <Card
      title="Who's online"
      icon="users"
      description="Live player list and moderation, over RCON."
      right={
        settings && (
          <Tooltip
            label={
              settings.enabled
                ? `CraftPanel talks to the server on port ${settings.port}`
                : "Remote console is off — CraftPanel can't see players or run commands"
            }
          >
            <Badge tone={settings.enabled ? "ok" : "neutral"} dot>
              {settings.enabled ? `Connected · ${settings.port}` : "Not connected"}
            </Badge>
          </Tooltip>
        )
      }
      pad={false}
    >
      {!settings ? (
        <StateBlock state="loading" title="Checking the connection…" compact />
      ) : !settings.propertiesPresent ? (
        <StateBlock
          state="empty"
          icon="file"
          title="Nothing to connect to yet"
          message={
            <>
              Start the server once so it writes <code>server.properties</code>,
              then CraftPanel can hook into it.
            </>
          }
          compact
        />
      ) : !settings.enabled ? (
        <div className="p-3.5">
          <div className="flex items-start gap-3 rounded-lg border border-line-soft bg-surface-2 p-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent-muted text-accent">
              <Icon name="key" size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <h4 className="text-sm font-medium text-ink">
                Turn on the remote console
              </h4>
              <p className="mt-1 text-2xs leading-relaxed text-ink-faint">
                This is how CraftPanel sees who's playing and runs commands for
                you. It writes exactly four lines —{" "}
                <code>enable-rcon</code>, <code>rcon.port</code>,{" "}
                <code>rcon.password</code> and <code>broadcast-rcon-to-ops</code>{" "}
                — and touches nothing else in your config.
              </p>
              <Button
                variant="primary"
                icon="key"
                className="mt-2.5"
                onClick={enableRcon}
                loading={busy}
              >
                Turn it on
              </Button>
            </div>
          </div>
        </div>
      ) : !reachable ? (
        <StateBlock
          state="offline"
          title="Server isn't running"
          message={`Everything's set up on port ${settings.port} — start the server to see who's online.`}
          compact
        />
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-line-soft px-3.5 py-2">
            <span className="text-xs text-ink-dim">
              {list ? (
                <>
                  <strong className="tabular-nums text-ink">{list.online}</strong>{" "}
                  of {list.max} slots used
                </>
              ) : (
                "Connecting…"
              )}
            </span>
          </div>

          {online.length === 0 ? (
            <StateBlock
              state="empty"
              icon="users"
              title="Nobody's on right now"
              message="Send someone the join address from the Network tab."
              compact
            />
          ) : (
            <ul className="divide-y divide-line-soft">
              {online.map((p) => (
                <li key={p}>
                  <button
                    onClick={() => setSelected(selected === p ? null : p)}
                    aria-expanded={selected === p}
                    className={cx(
                      "flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors",
                      selected === p ? "bg-surface-2" : "hover:bg-surface-2",
                    )}
                  >
                    {/* a stable per-name colour, so faces are recognisable */}
                    <span
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-md font-mono text-2xs font-bold text-ink"
                      style={{
                        background: `hsl(${
                          [...p].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
                        } 32% 26%)`,
                      }}
                    >
                      {p.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">
                      {p}
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-2xs text-ink-faint">
                      Manage
                      <Icon
                        name={selected === p ? "chevron-up" : "chevron-down"}
                        size={12}
                      />
                    </span>
                  </button>

                  {selected === p && (
                    <div className="cp-in flex flex-wrap items-center gap-1.5 bg-surface-2 px-3.5 pb-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon="arrow-right"
                        onClick={() => act("kick", p)}
                        disabled={busy}
                      >
                        Kick
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon="crown"
                        onClick={() => act("op", p)}
                        disabled={busy}
                      >
                        Make operator
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => act("deop", p)}
                        disabled={busy}
                      >
                        Remove operator
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon="list"
                        onClick={() => act("whitelist-add", p)}
                        disabled={busy}
                      >
                        Add to whitelist
                      </Button>
                      <Select
                        onChange={(e) =>
                          e.target.value && act("gamemode", p, e.target.value)
                        }
                        defaultValue=""
                        disabled={busy}
                        className="w-36"
                      >
                        <option value="" disabled>
                          Change mode…
                        </option>
                        <option value="survival">Survival</option>
                        <option value="creative">Creative</option>
                        <option value="adventure">Adventure</option>
                        <option value="spectator">Spectator</option>
                      </Select>
                      <span className="flex-1" />
                      <Button
                        variant="danger"
                        size="sm"
                        icon="ban"
                        onClick={() => act("ban", p)}
                        disabled={busy}
                      >
                        Ban
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-center gap-2 border-t border-line-soft bg-surface-2 px-3.5 py-2">
            <CommandInput
              value={cmd}
              onChange={setCmd}
              onKeyDown={(e) => e.key === "Enter" && sendCmd()}
              players={list?.players}
              placeholder="Run a command — e.g. time set day"
              prefix={
                <span className="select-none font-mono text-xs text-accent">/</span>
              }
            />
            <Button
              variant={cmd.trim() ? "primary" : "subtle"}
              size="sm"
              onClick={sendCmd}
              disabled={busy || !cmd.trim()}
            >
              Run
            </Button>
          </div>
        </>
      )}

      {note && (
        <div className="border-t border-line-soft px-3.5 py-2">
          <p
            data-selectable
            className="whitespace-pre-wrap break-words font-mono text-2xs text-ink-dim"
          >
            {note}
          </p>
        </div>
      )}
      {error && (
        <div className="p-3.5 pt-0">
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        </div>
      )}
    </Card>
  );
}
