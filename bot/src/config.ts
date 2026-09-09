/**
 * Env loading + validation, all in one place. The bot refuses to start if the
 * few genuinely-required values are missing; everything optional degrades to a
 * sensible default and the affected feature just goes quiet.
 *
 * The CraftPanel Remote API token is special: if you don't paste it into .env
 * we read it straight out of the desktop app's own `remote_api.json` on this
 * machine, so a bot running next to the app needs almost no configuration.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function req(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`[config] missing required env var ${name} — copy .env.example to .env and fill it in`);
    process.exit(1);
  }
  return v;
}

function opt(name: string, fallback = ""): string {
  return process.env[name]?.trim() || fallback;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** `~/Library/Application Support/com.craftpanel.app` and friends. */
function panelConfigDir(): string {
  const id = "com.craftpanel.app";
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", id);
    case "win32":
      return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), id);
    default:
      return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), id);
  }
}

/** Read `{ token, port }` from the desktop app's remote_api.json, if present. */
function readPanelConfigFile(): { token?: string; port?: number } {
  try {
    const raw = readFileSync(join(panelConfigDir(), "remote_api.json"), "utf8");
    const parsed = JSON.parse(raw) as { token?: unknown; port?: unknown; enabled?: unknown };
    return {
      token: typeof parsed.token === "string" ? parsed.token : undefined,
      port: typeof parsed.port === "number" ? parsed.port : undefined,
    };
  } catch {
    return {};
  }
}

function resolvePanel(): { url: string; token: string; tokenSource: "env" | "file" | "none" } {
  const fromFile = readPanelConfigFile();
  const envToken = opt("PANEL_TOKEN");
  const token = envToken || fromFile.token || "";

  let url = opt("PANEL_URL");
  if (!url) {
    const port = fromFile.port ?? 8642;
    url = `http://127.0.0.1:${port}`;
  }

  return {
    url: url.replace(/\/+$/, ""),
    token,
    tokenSource: envToken ? "env" : fromFile.token ? "file" : "none",
  };
}

const panel = resolvePanel();

export const config = {
  discord: {
    token: req("DISCORD_TOKEN"),
    clientId: req("CLIENT_ID"),
    guildId: opt("GUILD_ID") || null,
    ownerId: opt("OWNER_ID") || null,
  },
  monitor: {
    webhookUrl: opt("WEBHOOK_URL") || null,
    thresholdC: num("TEMP_THRESHOLD_C", 85),
    cooldownMs: num("ALERT_COOLDOWN_MIN", 10) * 60_000,
  },
  panel: {
    url: panel.url,
    token: panel.token,
    tokenSource: panel.tokenSource,
  },
  moderation: {
    logChannelId: opt("MOD_LOG_CHANNEL_ID") || null,
    // automod is OFF unless explicitly enabled — if you already run carl-bot /
    // AutoMod / Dyno you do not want a second bot deleting messages.
    automodEnabled: /^(1|true|yes|on)$/i.test(opt("AUTOMOD_ENABLED")),
    blockedPatterns: opt("BLOCKED_PATTERNS")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  },
  voice: {
    creatorChannelId: opt("CREATOR_CHANNEL_ID") || null,
    lobbyCategoryId: opt("LOBBY_CATEGORY_ID") || null,
  },
  leveling: {
    dbPath: opt("LEVELING_DB_PATH", "leveling.sqlite"),
    cooldownMs: num("XP_COOLDOWN_SEC", 60) * 1000,
  },
} as const;

/** One-line summary of what's wired up, printed at boot. */
export function describeConfig(): string {
  const bits = [
    `panel=${config.panel.url}${config.panel.token ? ` (token from ${config.panel.tokenSource})` : " (no token!)"}`,
    config.monitor.webhookUrl ? `monitor@${config.monitor.thresholdC}°C` : "monitor=off (no WEBHOOK_URL)",
    config.voice.creatorChannelId ? "join-to-create=on" : "join-to-create=off",
    config.moderation.automodEnabled ? "automod=ON" : "automod=off",
    config.moderation.logChannelId ? "modlog=on" : "modlog=off",
  ];
  return bits.join("  ·  ");
}
