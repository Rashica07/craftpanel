import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { AdminLists, PlayerAction } from "../types";
import {
  Badge,
  Banner,
  Button,
  Card,
  IconButton,
  SettingRow,
  SkeletonList,
  TextInput,
  Toggle,
} from "./ui";
import { ErrorBanner } from "./ErrorBanner";

/**
 * Operators / Whitelist / Banned all share this shape. Deliberately a
 * top-level component, not one nested inside `AdminPanel` — a component
 * defined inside another component's body gets a fresh function identity
 * every render, so React treats it as a brand-new component type each
 * time and remounts it from scratch. That was silently destroying and
 * recreating the "add player" `<input>` on every keystroke (each keystroke
 * updates `AdminPanel`'s own state, which re-renders it, which used to
 * redefine `Section` fresh) — the field lost focus after every single
 * character, which read as "the whole page resets when I type".
 */
function Section({
  title,
  icon,
  tone,
  blurb,
  items,
  onRemove,
  removeLabel,
  value,
  onValueChange,
  onAdd,
  placeholder,
  emptyMsg,
  busy,
  reachable,
}: {
  title: string;
  icon: string;
  tone?: "accent" | "ok" | "bad";
  blurb: string;
  items: string[];
  onRemove: (name: string) => void;
  removeLabel: string;
  value: string;
  onValueChange: (v: string) => void;
  onAdd: () => void;
  placeholder: string;
  emptyMsg: string;
  busy: boolean;
  reachable: boolean;
}) {
  return (
    <Card
      title={title}
      icon={icon}
      tone={tone}
      description={blurb}
      right={<Badge tone="neutral">{items.length}</Badge>}
      pad={false}
    >
      {items.length === 0 ? (
        <p className="px-3.5 py-3 text-2xs text-ink-faint">{emptyMsg}</p>
      ) : (
        <ul className="divide-y divide-line-soft">
          {items.map((n) => (
            <li
              key={n}
              className="group flex items-center gap-2.5 px-3.5 py-2 transition-colors hover:bg-surface-2"
            >
              <span
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md font-mono text-[10px] font-bold text-ink"
                style={{
                  background: `hsl(${
                    [...n].reduce((a, c) => a + c.charCodeAt(0), 0) % 360
                  } 30% 24%)`,
                }}
              >
                {n.slice(0, 2).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {n}
              </span>
              <IconButton
                icon="x"
                title={removeLabel}
                size="sm"
                disabled={busy || !reachable}
                className="opacity-0 transition-opacity hover:text-bad focus-visible:opacity-100 group-hover:opacity-100"
                onClick={() => onRemove(n)}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1.5 border-t border-line-soft p-2.5">
        <TextInput
          value={value}
          disabled={!reachable}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAdd()}
          placeholder={placeholder}
        />
        <Button
          variant="secondary"
          icon="plus"
          disabled={busy || !reachable || !value.trim()}
          onClick={onAdd}
        >
          Add
        </Button>
      </div>
    </Card>
  );
}

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

  if (!lists)
    return (
      <div className="space-y-3">
        <Card pad={false}>
          <SkeletonList rows={1} rowClassName="px-3.5 py-3" iconClassName="h-5 w-9" />
        </Card>
        <Card pad={false}>
          <SkeletonList rows={3} />
        </Card>
      </div>
    );

  return (
    <div className="space-y-3">
      {!reachable && (
        <Banner tone="warn" icon="lock">
          These lists are read-only while the server is stopped. Start it to add
          or remove people — changes go over the live console, which is safe for
          offline usernames too.
        </Banner>
      )}

      <Card
        title="Who's allowed in"
        icon="shield"
        tone={lists.whitelistOn ? "ok" : undefined}
        pad={false}
      >
        <SettingRow
          icon="list"
          label="Whitelist only"
          help={
            lists.whitelistOn
              ? "On — anyone not on the list below is turned away at the door."
              : "Off — anyone with your address can join. Turn this on for a private server."
          }
          control={
            <Toggle
              checked={lists.whitelistOn}
              disabled={busy}
              onChange={toggleWhitelist}
              label="Whitelist only"
            />
          }
        />
      </Card>

      <Section
        title="Operators"
        icon="crown"
        tone="accent"
        blurb="Trusted players who can run commands and bypass rules."
        items={lists.ops}
        value={add.op}
        onValueChange={(v) => setAdd((st) => ({ ...st, op: v }))}
        onAdd={() => act("op", add.op)}
        placeholder="Username to make an operator"
        removeLabel="Remove operator"
        emptyMsg="Nobody is an operator yet. Add yourself so you can run commands in-game."
        onRemove={(n) => act("deop", n)}
        busy={busy}
        reachable={reachable}
      />
      <Section
        title="Whitelist"
        icon="list"
        blurb="The guest list. Only matters while “Whitelist only” is on."
        items={lists.whitelist}
        value={add.white}
        onValueChange={(v) => setAdd((st) => ({ ...st, white: v }))}
        onAdd={() => act("whitelist-add", add.white)}
        placeholder="Username to let in"
        removeLabel="Remove from whitelist"
        emptyMsg="Nobody on the list."
        onRemove={(n) => act("whitelist-remove", n)}
        busy={busy}
        reachable={reachable}
      />
      <Section
        title="Banned"
        icon="ban"
        tone="bad"
        blurb="People who can't join, no matter what."
        items={lists.banned.map((b) =>
          b.reason ? `${b.name} — ${b.reason}` : b.name,
        )}
        value={add.ban}
        onValueChange={(v) => setAdd((st) => ({ ...st, ban: v }))}
        onAdd={() => act("ban", add.ban)}
        placeholder="Username to ban"
        removeLabel="Unban"
        emptyMsg="Nobody is banned."
        onRemove={(n) => act("pardon", n.split(" — ")[0])}
        busy={busy}
        reachable={reachable}
      />

      <ErrorBanner message={error} onDismiss={() => setError(null)} />
    </div>
  );
}
