# CraftPanel Discord bot

A localized Discord companion for CraftPanel. It runs on the same machine (or
LAN) as the desktop app and talks to its Remote API — no hosted backend.

## What it does

| Feature | Where |
| --- | --- |
| **Join to Create** temporary voice lobbies | `src/events/voiceStateUpdate.ts` |
| **Overheating alerts** — 60s CPU/GPU temp check → webhook ping | `src/monitor.ts` |
| `/status` — public IP, tunnel address, server uptimes (admin) | `src/commands/status.ts` |
| `/manage start\|stop\|restart` a server via the Remote API (admin) | `src/commands/manage.ts` |
| `/moderation kick\|ban\|timeout` + mod-log | `src/commands/moderation.ts` |
| `/rank show\|top` — MEE6-style leveling, 60s XP cooldown | `src/commands/rank.ts` |
| Automod (regex blacklist, link spam, mass mention) + XP | `src/events/messageCreate.ts` |
| Slash-command + verify-button dispatch | `src/events/interactionCreate.ts` |
| One-shot server scaffolder (roles/channels/verify button) | `src/scripts/setupServer.ts` |

Leveling data lives in a local SQLite file via the built-in `node:sqlite` —
nothing to compile. `index.ts` auto-wires every `{ name, execute }` module in
`src/events/`.

## Setup

1. **Node 22+** (uses `node:sqlite` and `--env-file-if-exists`).
2. `npm install`
3. `cp .env.example .env` and fill it in. Minimum to boot: `DISCORD_TOKEN`,
   `CLIENT_ID`. Everything else turns a feature on when present.
4. In the [Discord Developer Portal](https://discord.com/developers/applications)
   → your app → **Bot**, enable the **Server Members** and **Message Content**
   privileged intents.
5. Invite the bot with the `bot` + `applications.commands` scopes and at least:
   Manage Channels, Move Members, Manage Messages, Kick/Ban Members, Moderate
   Members.

## Run

```bash
npm run deploy         # register slash commands (once, and after changing any)
npm run setup-server    # optional: scaffold the guild layout (see below)
npm start
```

`npm run dev` runs `tsc --watch`; pair it with `node --watch dist/index.js`.

### `npm run setup-server`

One-shot: creates the `Verified` role, the Welcome / Community / Voice
categories and their channels, and posts the permanent "Click to verify"
button. Idempotent — re-running only fills in what's missing. It prints the
`CREATOR_CHANNEL_ID` / `MOD_LOG_CHANNEL_ID` to paste back into `.env`.

`npm run setup-server -- --wipe` **deletes every existing channel first.** It
warns and waits 3s. Only use it on a throwaway/fresh server.

## CraftPanel Remote API

Turn it on in **CraftPanel → Settings → Remote API**. If the bot runs on the
same machine it auto-reads the bearer token from the app's own
`remote_api.json`, so you can leave `PANEL_TOKEN` blank. Otherwise paste the
token and point `PANEL_URL` at the machine.

The Remote API currently exposes servers (list/get/start/stop/console/players)
but not the tunnel address — `/status` reads that from an optional
`tunnels.json` in the app's config dir and shows "none detected" if absent.

## Offline behaviour

Every outbound call (Remote API, ipify, webhook, `systeminformation`) is
wrapped: a closed panel, no internet, or a machine with no temp sensors just
makes the relevant feature go quiet. Nothing throws into the gateway loop.
