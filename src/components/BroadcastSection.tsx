import { useEffect, useState } from "react";
import { api } from "../api";
import {
  Badge,
  Button,
  Card,
  Segmented,
  Select,
  TextInput,
  Toggle,
  Tooltip,
  toast,
} from "./ui";
import { Icon } from "./Icon";
import { ErrorBanner } from "./ErrorBanner";

type Mode = "screen" | "chat" | "warn";

/** Minecraft's named chat colours — not the same set as the §-code palette
 * BrandingSection uses for the MOTD, but the same swatch idea. */
const MSG_COLORS: { name: string; hex: string }[] = [
  { name: "white", hex: "#FFFFFF" },
  { name: "yellow", hex: "#FFFF55" },
  { name: "gold", hex: "#FFAA00" },
  { name: "red", hex: "#FF5555" },
  { name: "light_purple", hex: "#FF55FF" },
  { name: "aqua", hex: "#55FFFF" },
  { name: "green", hex: "#55FF55" },
  { name: "gray", hex: "#AAAAAA" },
];

/** A Minecraft JSON text component, and the `/tellraw`/`/title` command that
 * carries it — always built by JSON.stringify-ing a real object, never by
 * hand-splicing strings, so a player typing a `"` or `\` in a chat can't
 * break the command. */
function tellrawCmd(target: string, parts: object[]) {
  return `tellraw ${target} ${JSON.stringify(parts)}`;
}
function titleCmd(target: string, kind: "title" | "subtitle", part: object) {
  return `title ${target} ${kind} ${JSON.stringify(part)}`;
}

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {MSG_COLORS.map((c) => (
        <Tooltip key={c.name} label={c.name.replace("_", " ")}>
          <button
            type="button"
            onClick={() => onChange(c.name)}
            aria-label={c.name}
            aria-pressed={value === c.name}
            className={`h-6 w-6 rounded-full border-2 transition-transform ${
              value === c.name
                ? "scale-110 border-accent"
                : "border-transparent hover:scale-105"
            }`}
            style={{ background: c.hex }}
          />
        </Tooltip>
      ))}
    </div>
  );
}

/**
 * A screen-size preview of the "Full screen" mode — the actual on-screen
 * proportions matter here (title is huge, subtitle is small underneath), so
 * a plain text description wouldn't tell you what you're about to send.
 */
function ScreenPreview({
  title,
  subtitle,
  color,
}: {
  title: string;
  subtitle: string;
  color: string;
}) {
  const hex = MSG_COLORS.find((c) => c.name === color)?.hex ?? "#FFFFFF";
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-line-soft bg-console px-4 [background-image:radial-gradient(circle_at_50%_40%,#ffffff08,transparent_65%)]">
      <div
        className="max-w-full truncate text-center font-display text-xl font-bold [text-shadow:0_2px_4px_rgba(0,0,0,0.6)]"
        style={{ color: hex }}
      >
        {title || "Big message"}
      </div>
      {subtitle && (
        <div className="max-w-full truncate text-center text-xs text-ink-dim [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
          {subtitle}
        </div>
      )}
    </div>
  );
}

export function BroadcastSection({
  serverId,
  reachable,
}: {
  serverId: string;
  reachable: boolean;
}) {
  const [mode, setMode] = useState<Mode>("chat");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [players, setPlayers] = useState<string[]>([]);

  // screen mode
  const [bigText, setBigText] = useState("");
  const [smallText, setSmallText] = useState("");
  const [screenColor, setScreenColor] = useState("yellow");

  // chat mode
  const [chatText, setChatText] = useState("");
  const [chatColor, setChatColor] = useState("white");
  const [tagged, setTagged] = useState(true);

  // warn mode
  const [warnTarget, setWarnTarget] = useState("");
  const [warnText, setWarnText] = useState("");

  useEffect(() => {
    if (!reachable) return;
    api
      .rconPlayers(serverId)
      .then((l) => setPlayers(l.players))
      .catch(() => {});
  }, [serverId, reachable, mode]);

  async function guard(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast.ok(ok);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendScreen() {
    await guard(async () => {
      // fade-in 0.5s, hold 3.5s, fade-out 1s — Minecraft's defaults, ticks
      await api.rconCommand(serverId, "title @a times 10 70 20");
      await api.rconCommand(
        serverId,
        titleCmd("@a", "title", { text: bigText, color: screenColor, bold: true }),
      );
      if (smallText.trim()) {
        await api.rconCommand(
          serverId,
          titleCmd("@a", "subtitle", { text: smallText, color: "gray" }),
        );
      }
    }, "Sent to every screen.");
    setBigText("");
    setSmallText("");
  }

  async function sendChat() {
    const parts: object[] = tagged
      ? [{ text: "[Server] ", color: "gold", bold: true }, { text: chatText, color: chatColor }]
      : [{ text: chatText, color: chatColor }];
    await guard(async () => {
      await api.rconCommand(serverId, tellrawCmd("@a", parts));
    }, "Sent to everyone.");
    setChatText("");
  }

  async function sendWarn() {
    await guard(async () => {
      await api.rconCommand(
        serverId,
        tellrawCmd(warnTarget, [
          { text: "⚠ Warning — ", color: "red", bold: true },
          { text: warnText, color: "yellow" },
        ]),
      );
    }, `Sent privately to ${warnTarget}.`);
    setWarnText("");
  }

  return (
    <Card
      title="Message players"
      icon="message-circle"
      description="A full-screen announcement, a chat broadcast, or a private warning to one player — all sent live over RCON."
      right={
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "screen" as Mode, label: "Full screen", icon: "monitor" },
            { value: "chat" as Mode, label: "Chat", icon: "message-circle" },
            { value: "warn" as Mode, label: "Warn one", icon: "alert" },
          ]}
        />
      }
    >
      {!reachable ? (
        <p className="flex items-center gap-1.5 text-xs text-ink-faint">
          <Icon name="info" size={13} />
          Start the server and turn on the remote console above to send
          messages to players.
        </p>
      ) : mode === "screen" ? (
        <div className="space-y-3">
          <ScreenPreview title={bigText} subtitle={smallText} color={screenColor} />
          <TextInput
            value={bigText}
            onChange={(e) => setBigText(e.target.value)}
            placeholder="Big message — e.g. Restarting in 5 minutes"
            maxLength={80}
          />
          <TextInput
            value={smallText}
            onChange={(e) => setSmallText(e.target.value)}
            placeholder="Small message underneath (optional)"
            maxLength={100}
          />
          <div className="flex items-center justify-between gap-3">
            <ColorPicker value={screenColor} onChange={setScreenColor} />
            <Button
              variant="primary"
              icon="monitor"
              loading={busy}
              disabled={!bigText.trim()}
              onClick={sendScreen}
            >
              Show on everyone's screen
            </Button>
          </div>
        </div>
      ) : mode === "chat" ? (
        <div className="space-y-3">
          <TextInput
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && chatText.trim() && sendChat()}
            placeholder="Message everyone in chat…"
            maxLength={200}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <ColorPicker value={chatColor} onChange={setChatColor} />
              <label className="flex items-center gap-1.5 text-2xs text-ink-faint">
                <Toggle size="sm" checked={tagged} onChange={setTagged} />
                “[Server]” tag
              </label>
            </div>
            <Button
              variant="primary"
              icon="message-circle"
              loading={busy}
              disabled={!chatText.trim()}
              onClick={sendChat}
            >
              Send to everyone
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {players.length === 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-ink-faint">
              <Icon name="users" size={13} />
              Nobody's online right now.
            </p>
          ) : (
            <>
              <Select value={warnTarget} onChange={(e) => setWarnTarget(e.target.value)}>
                <option value="" disabled>
                  Choose a player…
                </option>
                {players.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
              <TextInput
                value={warnText}
                onChange={(e) => setWarnText(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && warnTarget && warnText.trim() && sendWarn()
                }
                placeholder="Only this player will see it…"
                maxLength={200}
              />
              <div className="flex items-center justify-between gap-3">
                <Badge tone="warn" icon="alert" size="sm">
                  Private — only {warnTarget || "the chosen player"} sees this
                </Badge>
                <Button
                  variant="primary"
                  icon="alert"
                  loading={busy}
                  disabled={!warnTarget || !warnText.trim()}
                  onClick={sendWarn}
                >
                  Send private warning
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      <ErrorBanner message={error} onDismiss={() => setError(null)} className="mt-3" />
    </Card>
  );
}
