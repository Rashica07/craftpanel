import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { AdminLists, PlayerAction } from "../types";
import { Button } from "./ui";

export function AdminPanel({
  serverId,
  reachable,
  onNeedsRestart,
}: {
  serverId: string;
  reachable: boolean;
  onNeedsRestart?: () => void;
}) {
  const [lists, setLists] = useState<AdminLists | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [add, setAdd] = useState({ op: "", white: "", ban: "" });

  const load = useCallback(() => {
    api.adminLists(serverId).then(setLists).catch((e) => setError(String(e)));
  }, [serverId]);

  useEffect(() => {
    setError(null);
    load();
  }, [load]);

  async function act(action: PlayerAction, player: string) {
    const p = player.trim();
    if (!p) return;
    if (!reachable) {
      setError("Start the server — ops, whitelist and bans are changed live over RCON.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.rconPlayerAction(serverId, action, p);
      setAdd({ op: "", white: "", ban: "" });
      setTimeout(load, 300);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleWhitelist(on: boolean) {
    setBusy(true);
    setError(null);
    try {
      const r = await api.applySettings(serverId, [["white-list", on ? "true" : "false"]]);
      if (r.restartRequired) onNeedsRestart?.();
      if (reachable) await api.rconCommand(serverId, on ? "whitelist on" : "whitelist off").catch(() => {});
      setTimeout(load, 300);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function Section({
    title,
    items,
    onRemove,
    addKey,
    addAction,
    placeholder,
  }: {
    title: string;
    items: string[];
    onRemove: (name: string) => void;
    addKey: "op" | "white" | "ban";
    addAction: PlayerAction;
    placeholder: string;
  }) {
    return (
      <div className="rounded-lg border border-edge bg-panel p-3">
        <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-ink-faint">
          {title} <span className="text-ink-faint">({items.length})</span>
        </div>
        <ul className="mb-2 space-y-1">
          {items.map((n) => (
            <li
              key={n}
              className="flex items-center justify-between rounded bg-panel-2 px-2 py-1 text-sm"
            >
              <span>{n}</span>
              <button
                className="text-[11px] text-ink-faint hover:text-bad"
                onClick={() => onRemove(n)}
                disabled={busy}
              >
                remove
              </button>
            </li>
          ))}
          {items.length === 0 && <li className="px-2 text-xs text-ink-faint">Empty.</li>}
        </ul>
        <div className="flex gap-1.5">
          <input
            value={add[addKey]}
            onChange={(e) => setAdd((s) => ({ ...s, [addKey]: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && act(addAction, add[addKey])}
            placeholder={placeholder}
            className="flex-1 rounded border border-edge bg-panel-2 px-2 py-1 text-sm text-ink outline-none focus:border-accent"
          />
          <Button variant="subtle" disabled={busy} onClick={() => act(addAction, add[addKey])}>
            Add
          </Button>
        </div>
      </div>
    );
  }

  if (!lists) return <div className="text-xs text-ink-faint">Loading…</div>;

  return (
    <div className="space-y-3">
      {!reachable && (
        <div className="rounded border border-warn/30 bg-warn/10 px-2 py-1 text-[11px] text-warn">
          Lists are read-only while the server is stopped. Start it to add or remove
          people (changes go over RCON, offline-name safe).
        </div>
      )}

      <label className="flex items-center gap-2 rounded-lg border border-edge bg-panel p-3 text-sm">
        <input
          type="checkbox"
          checked={lists.whitelistOn}
          disabled={busy}
          onChange={(e) => toggleWhitelist(e.target.checked)}
          className="accent-accent"
        />
        <span>
          Whitelist enabled
          <span className="ml-1 text-[11px] text-ink-faint">
            only listed players may join
          </span>
        </span>
      </label>

      <Section
        title="Operators"
        items={lists.ops}
        addKey="op"
        addAction="op"
        placeholder="username to op"
        onRemove={(n) => act("deop", n)}
      />
      <Section
        title="Whitelist"
        items={lists.whitelist}
        addKey="white"
        addAction="whitelist-add"
        placeholder="username to whitelist"
        onRemove={(n) => act("whitelist-remove", n)}
      />
      <Section
        title="Banned"
        items={lists.banned.map((b) => (b.reason ? `${b.name} — ${b.reason}` : b.name))}
        addKey="ban"
        addAction="ban"
        placeholder="username to ban"
        onRemove={(n) => act("pardon", n.split(" — ")[0])}
      />

      {error && (
        <div className="rounded border border-bad/30 bg-bad/10 px-2 py-1 text-xs text-bad">
          {error}
        </div>
      )}
    </div>
  );
}
