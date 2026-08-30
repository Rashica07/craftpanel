import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Button, Card } from "./ui";

const COLORS: Record<string, string> = {
  "0": "#000000", "1": "#0000AA", "2": "#00AA00", "3": "#00AAAA",
  "4": "#AA0000", "5": "#AA00AA", "6": "#FFAA00", "7": "#AAAAAA",
  "8": "#555555", "9": "#5555FF", a: "#55FF55", b: "#55FFFF",
  c: "#FF5555", d: "#FF55FF", e: "#FFFF55", f: "#FFFFFF",
};

type Span = { text: string; color: string; bold: boolean; italic: boolean; underline: boolean };

function parseMotd(raw: string): Span[][] {
  return raw.split("\n").map((line) => {
    const spans: Span[] = [];
    let cur: Span = { text: "", color: "#FFFFFF", bold: false, italic: false, underline: false };
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if ((ch === "§" || ch === "&") && i + 1 < line.length) {
        const code = line[++i].toLowerCase();
        if (cur.text) spans.push(cur);
        cur = { ...cur, text: "" };
        if (COLORS[code]) cur = { text: "", color: COLORS[code], bold: false, italic: false, underline: false };
        else if (code === "l") cur.bold = true;
        else if (code === "o") cur.italic = true;
        else if (code === "n") cur.underline = true;
        else if (code === "r")
          cur = { text: "", color: "#FFFFFF", bold: false, italic: false, underline: false };
        continue;
      }
      cur.text += ch;
    }
    if (cur.text) spans.push(cur);
    return spans.length ? spans : [cur];
  });
}

export function BrandingSection({ serverId }: { serverId: string }) {
  const [motd, setMotd] = useState<string>("");
  const [saved, setSaved] = useState<string>("");
  const [hasIcon, setHasIcon] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(() => {
    api.getSettings(serverId).then((s) => {
      const m = s.all.find(([k]) => k === "motd")?.[1] ?? "";
      setMotd(m);
      setSaved(m);
    });
    api.serverIconStatus(serverId).then(setHasIcon).catch(() => {});
  }, [serverId]);

  useEffect(() => {
    setError(null);
    setNote(null);
    load();
  }, [load]);

  const lines = useMemo(() => parseMotd(motd), [motd]);

  async function guard(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
      if (ok) setNote(ok);
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="How it looks in the server list"
      icon="image"
      description="The description and icon your friends see before they join."
    >

      {/* preview */}
      <div className="mb-2 flex gap-2 rounded-md border border-line bg-[#2b2b2b] p-2">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded bg-[#1b1b1b] text-[10px] text-ink-faint">
          {hasIcon ? (
            <span className="text-ok">icon set</span>
          ) : (
            <span>no icon</span>
          )}
        </div>
        <div className="min-w-0 flex-1 font-mono text-[13px] leading-tight">
          {lines.map((spans, i) => (
            <div key={i} className="truncate">
              {spans.map((s, j) => (
                <span
                  key={j}
                  style={{
                    color: s.color,
                    fontWeight: s.bold ? 700 : 400,
                    fontStyle: s.italic ? "italic" : "normal",
                    textDecoration: s.underline ? "underline" : "none",
                  }}
                >
                  {s.text || " "}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      <textarea
        value={motd}
        onChange={(e) => setMotd(e.target.value.split("\n").slice(0, 2).join("\n"))}
        rows={2}
        placeholder="Welcome to the server!  Use §a §c §l for colour/bold"
        className="w-full resize-none rounded-md border border-line bg-surface-2 p-2.5 font-mono text-xs text-ink outline-none transition-colors focus:border-accent"
      />
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {Object.entries(COLORS).map(([code, hex]) => (
          <button
            key={code}
            title={`§${code}`}
            onClick={() => setMotd((m) => m + "§" + code)}
            className="h-4 w-4 rounded-sm border border-black/30"
            style={{ background: hex }}
          />
        ))}
        {["l", "o", "n", "r"].map((c) => (
          <button
            key={c}
            onClick={() => setMotd((m) => m + "§" + c)}
            className="rounded border border-line px-1 text-[10px] text-ink-dim hover:text-ink"
          >
            §{c}
          </button>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          variant="primary"
          disabled={busy || motd === saved}
          onClick={() => guard(() => api.applySettings(serverId, [["motd", motd]]), "MOTD saved.")}
        >
          Save MOTD
        </Button>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => guard(() => api.pickAndSetIcon(serverId), "Icon set (64×64).")}
        >
          {hasIcon ? "Change icon…" : "Set icon…"}
        </Button>
        {hasIcon && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => guard(() => api.clearServerIcon(serverId), "Icon removed.")}
          >
            Remove icon
          </Button>
        )}
      </div>
      <p className="mt-1 text-2xs text-ink-faint">
        Restart the server for MOTD/icon changes to show in the multiplayer list.
      </p>

      {note && <div className="mt-2 rounded-md border border-line-soft bg-surface-2 px-2.5 py-1.5 text-xs text-ink-dim">{note}</div>}
      {error && (
        <div className="mt-2 rounded-md border border-bad/30 bg-bad-muted px-2.5 py-1.5 text-xs text-bad-soft">
          {error}
        </div>
      )}
    </Card>
  );
}
