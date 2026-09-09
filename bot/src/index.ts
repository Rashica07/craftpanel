/**
 * CraftPanel Discord companion bot — entry point.
 *
 * Boot sequence:
 *   1. build the gateway client with the intents every feature needs,
 *   2. scan `events/` and wire each `{ name, once?, execute }` module up with
 *      `client.on` / `client.once`,
 *   3. open the leveling DB and start the 60s hardware-temperature monitor,
 *   4. log in.
 *
 * Run `npm run deploy` once to register the slash commands, then `npm start`.
 */
import { readdirSync } from "node:fs";
import { Client, GatewayIntentBits } from "discord.js";
import { config } from "./config.js";
import type { BotEvent } from "./events/types.js";
import { startMonitor } from "./monitor.js";
import { closeDb, openDb } from "./services/database.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
  ],
});

// ── dynamically wire every events/ module ───────────────────────────────────
const eventsDir = new URL("./events/", import.meta.url);
for (const file of readdirSync(eventsDir)) {
  if (!file.endsWith(".js")) continue; // skip types.js? it has no `name`, but cheap to filter anyway
  const mod = (await import(new URL(file, eventsDir).href)) as Partial<BotEvent>;
  if (!mod.name || typeof mod.execute !== "function") continue;
  const { name, once, execute } = mod;
  const handler = (...args: unknown[]) => (execute as (...a: unknown[]) => unknown)(...args);
  // name is a runtime string from a scanned module — the generic overload can't
  // narrow it, so widen the call site rather than the handler.
  (client[once ? "once" : "on"] as (e: string, l: (...a: unknown[]) => unknown) => unknown)(name, handler);
  console.log(`[events] wired ${file} → ${name}${once ? " (once)" : ""}`);
}

// ── non-gateway setup ──────────────────────────────────────────────────────
openDb(); // fail fast on a bad LEVELING_DB_PATH rather than on the first message
const monitor = startMonitor();

process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
client.on("error", (e) => console.error("[client]", e));

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} — shutting down`);
  if (monitor) clearInterval(monitor);
  closeDb();
  void client.destroy().finally(() => process.exit(0));
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

client.login(config.discord.token).catch((err) => {
  console.error("Login failed:", (err as Error).message);
  process.exit(1);
});
