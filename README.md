# CraftPanel

Self-hosted Minecraft server manager. Tauri desktop app (macOS + Windows).

- **Frontend:** React + TypeScript + Vite + Tailwind v4 (dark, orange `#FF8C00` accent)
- **Backend:** Rust via Tauri commands — no separate server process
- **Storage:** SQLite (`rusqlite`, bundled) in the app config dir
- **Server comms:** RCON (Stage 3+)

## Installing the build (macOS, unsigned)

The `.dmg` isn't notarised yet, so macOS Sequoia blocks it with
"Apple could not verify…". Fix after dragging to Applications:

```bash
xattr -dr com.apple.quarantine /Applications/CraftPanel.app
```

or: System Settings → Privacy & Security → scroll to "CraftPanel.app was
blocked" → **Open Anyway**. Proper notarisation is Phase 7 (needs an Apple
Developer account).

## Prerequisites

- Node 20+
- Rust (stable). Installed here via Homebrew `rustup`, which is keg-only:
  `export PATH="/usr/local/opt/rustup/bin:$PATH"` (already added to `~/.zshrc`).
- A JDK to actually run Minecraft servers (Temurin 17 or 21).

## Develop

```bash
npm install
npm run tauri dev     # launches the desktop app
```

## Test

```bash
cd src-tauri && cargo test     # adapter detection, Java mapping, DB round-trip
npm run build                  # typecheck + production frontend bundle
```

## Architecture

Game-specific logic sits behind the `ServerAdapter` trait
(`src-tauri/src/adapter.rs`); a FiveM adapter can be added later without
touching the UI or process layer.

| Module | Responsibility |
| --- | --- |
| `adapter.rs` | `ServerAdapter` trait, `ServerType`, `ServerConfig`, `ServerStatus` |
| `minecraft.rs` | Detects Fabric / Forge / Paper / Spigot / vanilla + MC version |
| `java.rs` | `java -version` parsing, MC→Java compatibility rules |
| `db.rs` | SQLite schema + server-list CRUD |
| `system.rs` | Host RAM / CPU facts for the allocation slider |
| `process.rs` | Spawn/stop/kill, console ring buffer, crash detection (via an `EventSink` seam so it's unit-testable), reattach after restart, keep-awake |
| `session.rs` | `<server>/.craftpanel-session.json` — lets a restart re-adopt its own running servers |
| `backups.rs` | zip/restore the server folder; retention |
| `files.rs` | in-app file manager (list/read/write/rename/mkdir/delete-to-trash) + log tail |
| `admin.rs` | ops / whitelist / bans overview (name-keyed) |
| `worlds.rs` | list / switch / create / rename / delete worlds |
| `branding.rs` | 64×64 `server-icon.png` from any image |
| `analytics.rs` | player history from `logs/` (first/last seen, playtime, IP) |
| `commands.rs` | Tauri command surface |

See [ROADMAP.md](ROADMAP.md) for the full plan (create-server wizard, advanced
config menu, NeoForge, packaging).

## Stage status

- [x] **Stage 1** — project setup, server detection, Add Server flow
- [x] **Stage 2** — process management: start/stop/kill (no shell), RAM slider
  (`Xms = Xmx`, system-RAM bounded), console ring buffer (500 lines) + live
  viewer with command input, crash vs clean-stop, **pre-flight EULA**,
  external-running-server detection
- [x] **Stage 2.5** — Create Server wizard: pick loader (Vanilla/Paper/Fabric/
  NeoForge/Forge) → version (live lists from Mojang / PaperMC Fill v3 / FabricMC
  meta / NeoForge + Forge maven) → name/folder/RAM → EULA → download (checksum
  verified) → first-boot to generate config. NeoForge/Forge run their installer.
- [x] **Stage 3** — RCON: source-RCON client, `server.properties` line-preserving
  editor, one-click RCON setup (writes only the 4 rcon keys, never `online-mode`),
  live player list, kick/ban/op/whitelist/gamemode by username, free-form
  RCON command box.

**Stages 2.5 + 3 verified end to end** against real Minecraft: an ignored test
(`cargo test e2e_create_paper_then_rcon -- --ignored`) creates a Paper 1.21.11
server from scratch, first-boots it, enables RCON, launches it, and queries
`/list` over RCON — all green.
- [x] **Stage 4** — tabbed server detail (Console / Players / Settings / Mods).
  `server.properties` editor with **Common / Advanced / Raw** tiers (Advanced =
  the perf & behaviour knobs experienced admins use, each explained); every write
  is line-preserving. Mods: enable/disable (`mods/` ↔ `mods-disabled/`), import
  `.jar`s, soft-remove to `.craftpanel-trash/`, Fabric-API + offline-auth-mod
  detection. "Restart to apply" banner when settings change on a live server.
- [x] **Multi-device sharing** — two modes, both with an advisory lease so only
  one device runs the world at a time:
  - **Cloud (default)** — CraftPanel uploads the world to *your* Cloudflare R2
    bucket on stop and pulls the latest on start. One-time setup: paste an R2 API
    token. Fully in-app, no synced folder. *(Built; needs a live token to test
    end to end.)*
  - **Synced folder** — `craftpanel-share.json` + `craftpanel-lease.json` in a
    folder you keep in iCloud/Dropbox. Offline/LAN friendly.
- [ ] **Phase 4** rest — Modrinth browser, file manager, JVM/Aikar, perf graphs
- [ ] **Phase 5** — port-forward/tunnel + branding
- [ ] **Phase 6** — backups, scheduler, world tools, analytics, anti-cheat
- [~] **Phase 7 MVP** — **tray icon** (close window while a server runs → hides
  to tray, doesn't quit; left-click reopens; menu: Show / Quit), **session
  persistence** (`<server>/.craftpanel-session.json` → a restart re-adopts its
  own servers as "Running (reattached)" instead of "external"), **keep-awake
  toggle** (macOS `caffeinate` for the server's lifetime; Windows pending).
  Still to do: signed installers, per-server tray items, Bedrock/Geyser,
  self-update — see [ROADMAP.md](ROADMAP.md).

See [ROADMAP.md](ROADMAP.md) — the 13 stages are now consolidated into 7 phases.
- [ ] **Stage 5** — UPnP / CGNAT detection, branding
- [ ] **Stage 6** — signed installers (macOS .dmg, Windows NSIS), self-update
