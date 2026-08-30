# CraftPanel roadmap

Living doc. Captures scope beyond the original 5-stage brief as it's been added.

## Product shape

A self-hosted Minecraft server manager that makes the whole lifecycle painless:
**create → run → configure → mod → expose to the internet**, with a clean dark
UI. Game-specific logic stays behind the `ServerAdapter` trait so FiveM (or
others) can be added later.

## Server flavours (first-class types)

`Vanilla · Paper · Spigot · Fabric · Forge · NeoForge`

## Minecraft versioning

Two schemes coexist and both must work everywhere:
- **Classic:** `1.8.9`, `1.18.2`, `1.21.9`, … (still shipped / still played)
- **Year scheme (2026+):** `26.0`, `26.2`, `27.1`, … — first component is the
  year, no leading `1.`

Version detection and the Java-compat check treat a plausible MC major as
`1` **or** `20–99`. Never assume a `1.` prefix.

- NeoForge is split out from Forge (own args-file path
  `libraries/net/neoforged/neoforge/**`, own download source).

## Feedback from first real use (2026-08-30)

The user ran the built app for the first time. Findings, split into **bugs**
(broke basic use — fixed in this pass) and **gaps** (real features, scheduled
below).

### Bugs — fixed
- **First-boot orphan → stuck "external".** `first_boot` read stdout with a
  blocking `for line in reader.lines()` and no enforced timeout — a quiet
  server (world-gen, or a "Done" line we didn't recognise) wedged it forever.
  The user force-quit → the JVM was left on port 25565 with no session file, so
  every later launch showed "Running (external)" and couldn't stop or start it.
  Fix: stdout now reads on its own thread via a channel + `recv_timeout`, so the
  240 s timeout always fires; first_boot writes a session file (force-quit →
  re-adopted, not "external"); and it force-kills anything still on the port
  before returning.
- **No way out of "external".** New `stop_on_port` command + **"Stop it"**
  button on the external banner: finds the PID holding the server's port
  (`lsof` / `netstat`), checks it looks like a JVM, SIGTERM → SIGKILL, clears
  the session file. One click to recover.
- **Two servers fought over port 25565.** Create now auto-assigns a free port
  (scans 25565–25664, skips ports other CraftPanel servers use + OS-open ones)
  and writes `server-port` / `query.port` / `rcon.port` line-preserving.
- **Gatekeeper "Move to Bin"** on macOS Sequoia: right-click→Open is gone.
  Documented the fix (`xattr -dr com.apple.quarantine …` or Settings → Privacy
  & Security → Open Anyway). Real fix = notarised build (Phase 7, needs the
  user's Apple Developer account).

### Gaps — scheduled (priority order)
1. ✓ **Create wizard top-up** (2026-08-30) — "+ World & rules": seed, gamemode,
   difficulty, MOTD, max-players; written line-preserving after first-boot.
2. ✓ **Files view + log view** (2026-08-30).
3. ✓ **Admins / ops manager** (2026-08-30).
4. ✓ **Branding** (2026-08-30) — MOTD editor with a live §-code preview +
   colour buttons; server-icon picker (`branding.rs`, `image` crate,
   centre-crop → 64×64 `server-icon.png`). In Settings.
5. ✓ **Worlds** (2026-08-30) — `worlds.rs`: list (active / size / nether·end),
   switch active (`level-name`), create (name + seed), rename (+ `_nether` /
   `_the_end`), delete → trash. Worlds tab; server must be stopped.
6. ✓ **Player logs** (2026-08-30) — `analytics.rs` parses `logs/latest.log` +
   rotated `*.log.gz` (date from filename, midnight-rollover aware): per-player
   first/last seen, session count, total playtime, last IP, online flag.
   Name-keyed. "Player history" in the Players tab.
7. **Custom / shareable address** — bundled tunnel so there's a real
   `name.xxxx` address without port-forwarding. *(Phase 5.)* — **next**
8. **UX pass** — ~ (batch 10, 2026-08-30): design-token refresh (warmer darks,
   richer orange, depth/vignette, MC-style button bevel, `Toggle`/`Card`
   primitives), stroke-icons everywhere, **app-level Settings modal** (gear in
   the sidebar — default Java/RAM, keep-servers-on-quit, expert mode, update
   check), first-run onboarding (3-step + friendly copy), Raw
   `server.properties` tier now gated behind **expert mode**. **Still open:**
   a real Aternos/Bisect-grade visual pass (needs the user iterating on the
   running app), per-field icons in Advanced settings, tooltips, a monochrome
   tray icon, a bundled display font.

### Native look & Windows (asked 2026-08-30)
- **"Real Swift packages / pure native feel"** — not possible inside Tauri
  (Rust + system WebView, not SwiftUI). A SwiftUI rewrite = two separate apps
  (SwiftUI + WinUI), throwing away everything. Instead, the *next* focused pass
  gets the native feel without a rewrite: **`titleBarStyle: "Overlay"`**
  (traffic lights float over the content, no title bar — Linear/Arc style),
  **macOS vibrancy** on the sidebar (`window-vibrancy`, frosted glass),
  system-accent + light/dark following, native context menus. Windows gets
  **Mica** backdrop on Win11.
- **Windows 10 / 11 builds** — the Rust is already Windows-clean (every
  OS-specific bit has a `#[cfg(windows)]` branch: `taskkill` / `tasklist`,
  `SetThreadExecutionState` TODO for keep-awake). You *can't* cross-build a
  Windows installer from macOS (NSIS + WebView2 linking need Windows). Options:
  `.github/workflows/release.yml` is committed — push CraftPanel to a private
  GitHub repo and tag `v0.1.0`, and Actions builds the `.dmg` **and** the
  Windows `.exe`/`.msi`. Or run `npm run tauri build` once on any Windows PC.

### Build bug — fixed (2026-08-30)
- **The batch-3 DMG wouldn't launch.** Adding `src-tauri/src/bin/gen_assets.rs`
  (the logo tool) gave the crate a second binary; the Tauri bundler set
  `CFBundleExecutable` to `gen_assets` and shipped that 1.4 MB tool as the app.
  Fix: moved it to `src-tauri/examples/gen_assets.rs` (run with
  `cargo run --example gen_assets`) + `default-run = "craftpanel"` in Cargo.toml.
  **Rule:** never add a `src/bin/*` to the Tauri crate.

### New bug/UX item (2026-08-30)
- **Tray → Quit stops running servers even with players on.** The window-close
  already hides to tray, but an explicit Quit (or Cmd-Q) runs
  `shutdown_and_release`. For now the escape hatch is force-quit + reattach.
  **TODO:** when Quit is chosen and a server has players, prompt "N players
  online — Stop servers / Leave running in background / Cancel"; a
  "leave running" tray option that exits the app but not the JVMs.

## Phases

Consolidated from the earlier 13-stage list into 7. `✓` = shipped, `~` = partly
done, `·` = not started.

### Phase 1 — Foundations  ✓
- `ServerAdapter` trait; detect Vanilla/Paper/Spigot/Fabric/Forge/NeoForge.
- Java version detection + MC-compat check (both version schemes).
- Add-existing flow with match "evidence" shown; type always overridable.
- Start/stop/kill via `std::process` (no shell); RAM slider (`Xms = Xmx`,
  system-RAM bounded); console ring buffer + live viewer + command input.
- Crash vs clean-stop; **pre-flight EULA** (one "I agree" → writes `eula.txt` →
  boots straight through); "Running (external)" port-probe detection.

### Phase 2 — Provisioning  ✓
- Create-Server wizard: loader → version → name/folder/RAM → EULA → provision.
- Live version lists (Mojang piston-meta, PaperMC Fill v3, FabricMC meta,
  NeoForge + Forge maven). Checksum-verified downloads. NeoForge/Forge run
  their installer. Every new server first-boots once to generate config.
- **Next:** one-click Modrinth/CurseForge **modpack** install (extends the
  wizard — pulls loader + version + mod set).

### Phase 3 — Live control  ~
- **RCON** ✓ — source-RCON client; one-click setup writes *only* the 4 rcon
  keys (never `online-mode`); live player list; kick/ban/pardon/op/deop/
  whitelist±/gamemode, all by **username**; free-form command box.
- **Native Management Protocol** ~ (2026-08-30) — `mgmt.rs` detects MC 1.21.9+ /
  26.x support, reads the `management-server-*` config, and **one-click enable**
  (writes only those keys, generates a 40-char secret, localhost-only). The full
  JSON-RPC-over-WebSocket **client** (no-restart settings, live events, real
  TPS) is still TODO — needs a 1.21.9+ test server. RCON stays the path today
  (now via a **kept-alive connection pool**, `RconPool` — no more reconnect
  churn from the perf poll).
- **Attach to an externally-running server** · — once RCON *or* the mgmt
  protocol is reachable, drive a server CraftPanel didn't spawn; tail
  `logs/latest.log` for its console.

### Phase 4 — Configuration & content  ~
- **Settings** ✓ — `server.properties` in Common / Advanced / Raw tiers
  (Advanced = the perf & behaviour knobs, each explained); line-preserving
  writes; "restart to apply" banner (goes away once the mgmt protocol lands for
  most keys).
- **Ops / whitelist / bans manager** ✓ (2026-08-30) — `admin.rs` reads
  `ops.json` / `whitelist.json` / `banned-players.json` (always, keyed on
  **name**); Players tab shows the lists + add/remove, applied live over RCON
  (offline-safe); whitelist on/off toggle. Config-as-forms for
  `paper-global.yml` / `bukkit.yml` / `spigot.yml` still ·.
- **Mods** ✓ — enable/disable (`mods/` ↔ `mods-disabled/`), import, soft-remove
  to `.craftpanel-trash/`, Fabric-API + offline-auth-mod detection.
- **In-app Modrinth browser** ✓ (2026-08-30) — `modrinth.rs`: search
  mods/plugins/datapacks filtered by loader + MC version; **install with
  required-dependency resolution** (BFS over `dependencies`, sha1-verified),
  routed to `mods/` / `plugins/` / `world/datapacks/`; tracked in
  `.craftpanel-modrinth.json` for update-check + one-click update + remove.
  "Browse" tab. Verified live (REI → auto-pulled Fabric API + Cloth Config +
  Architectury). **TODO:** one-click `.mrpack` modpack install.
- **File manager** ✓ (2026-08-30) — `files.rs`: browse / view / edit / rename /
  mkdir / upload / download; deletes move to `.craftpanel-trash/`; path-escape
  rejected; 2 MB text cap. Files tab. Plus a **Log-file view** (tail
  `logs/latest.log`, auto-refresh) in the Console tab — works for external /
  reattached servers that have no live stream.
- **JVM / performance tuning** ✓ (2026-08-30) — `jvm_args` DB column, injected
  by `build_command` (and `user_jvm_args.txt` for Forge argfiles); one-click
  **Aikar's flags** scaled to the RAM slider (>12 GB gets the big-heap set);
  "show launch command". JvmSection in Settings.
- **Perf & health view** ✓ (2026-08-30) — `perf.rs`: JVM RAM/CPU via `sysinfo`,
  TPS/MSPT over RCON (`/tick query` → `/tps` → `spark tps`). `HealthStrip`
  sparklines on the Console tab. `crashreports.rs` parses `crash-reports/*.txt`
  → latest crash's cause line + best-guess culprit mod (jar hint in the stack,
  else package root); shown in the crash banner.

### Phase 5 — Networking & sharing  ~
- **Expose** ✓ (2026-08-30) — `net.rs` + **Network tab**: LAN address, public
  IP, **CGNAT detection** (100.64/10), **UPnP auto port-forward** (`igd-next` —
  one-click "Forward port N"), **QR code** (`qrcode` → inline SVG), copy
  buttons, "recommended address" logic.
- **In-app tunnel** ✓ (2026-08-30) — `tunnel.rs` bundles the `bore` client
  (downloads the right release on first use, caches in the config dir, tar.gz
  or .zip). **"Start free tunnel"** → `bore local <port> --to bore.pub` → live
  `bore.pub:<port>` parsed from stderr, emitted as `tunnel:status`, feeds the
  "recommended address" + QR. No account, no browser. Killed on app quit.
  Temporary (port changes on restart, shared community server). A paste-in
  **permanent address** (playit.gg) overrides it. **TODO:** self-hosted `bore
  server` option for a stable custom address.
- **Branding** ✓ (2026-08-30) — MOTD editor with live §-preview + server-icon
  picker. See Phase 4.
- **Multi-device sync** (the private-code feature) — see its own section below.

### Phase 6 — Operations  ~

Broken into sub-stages, each shippable + testable on its own:

#### 6.1 — Backups  ~ (in progress, 2026-08-30)
`backups.rs`. A backup is a zip of the whole server folder minus regenerable
junk (`logs/`, `crash-reports/`, `.craftpanel-trash/`, `craftpanel-backups/`
itself, `*.lock`, `.craftpanel-session.json`) — mods/plugins/libraries **are**
kept so a restore actually launches. Stored at
`<server>/craftpanel-backups/<unix-ts>[__label].zip` with a `.json` sidecar
`{ id, createdAt, sizeBytes, label, trigger }` (`trigger` = `manual` |
`pre-restore` | `scheduled`).

- **Backup now** — optional label; zips on a worker thread, emits
  `backup:progress`.
- **List** — scan the sidecars, newest first, with size + age.
- **Restore** — refuses while the server is running/reachable. Always takes a
  fresh `pre-restore` backup first, then **moves** the current worlds + config
  aside to `.craftpanel-pre-restore-<ts>/` (never deletes), then unzips the
  chosen backup over the folder.
- **Delete** one backup (zip + sidecar).
- **Retention** — `settings` table key `backups.keep` (default 20, 0 =
  unlimited); after each new backup, prune the oldest `manual`/`scheduled` ones
  beyond the limit. `pre-restore` backups are never auto-pruned.
- UI: a **Backups** tab in the server detail (list, "Back up now", per-row
  Restore/Delete, keep-count field).
- **Later:** download a backup out of the app; custom folder / R2 target;
  incremental (region-file-level) backups; a "restore preview" diff.

#### 6.2 — Scheduler  ✓ (2026-08-30)
`schedule.rs` — one 15 s background tick thread (`Scheduler`, spawned in
`lib.rs` with the local UTC offset captured on the main thread). Per-server
config is JSON in the `settings` table under `schedule.<id>`:
- **Auto-restart on crash** ✓ — bounded (`maxCrashRestarts`, default 3),
  counter resets after 15 min crash-free, escalating 5·n s backoff, "gave up"
  message in the console.
- **Daily restart** ✓ — `HH:MM` local; `/say` warning ~1 min before, `/say` +
  graceful stop + relaunch at the time.
- **Timed commands** ✓ — `[{at:"HH:MM", command}]`, run once/day over the
  console.
- **Backup on stop** ✓ — running→stopped transition → `backups::backup_now`
  (`trigger = scheduled`) + prune.
- UI: "Automation" section in Settings.
- **Run windows** (only up between set hours) — still ·.

#### 6.3 — World management  ·
- List worlds (dirs with a `level.dat`), show active (`level-name`), seed,
  size; switch active (writes only `level-name`), create, rename, delete
  (backup first), **regenerate** (backup → wipe region data → let it re-gen).
- Upload / download a world as a zip.
- **Chunk pre-generation** — drive Chunky (plugin/mod) over RCON, or a headless
  pre-gen pass; progress bar.

#### 6.4 — Player analytics  ·
Parse `logs/` (+ rotated `*.log.gz`) and/or the mgmt-protocol event stream:
per-player first seen / last seen / total playtime / join count / last IP,
session history. Offline-mode aware — keyed on **name**. Skin heads via a
Bedrock-safe avatar source. No new online connections required beyond avatars.

#### 6.5 — Anti-cheat  ✓ (2026-08-30)
`anticheat.rs` — **Advisor**: catalogue per loader (Paper: Grim / Vulcan / NCP /
Spartan; Fabric: Vulcan / Panda / NCP-port), detect what's in `mods/`+`plugins/`,
**flag when the server is shared publicly (a tunnel address is set) and has
none**, with Modrinth slugs for one-click install via the Browse tab.
**Signals**: parse recent logs for movement kicks / flight / AC-plugin flag
lines / rapid re-joins → per-player suspicion list with sample lines. Advisory
only, never `online-mode`. `SecuritySection` in the Players tab.
- **Later:** live RCON watch (not just log scrape); a starter-config writer.

### Phase 7 — Ship & run anywhere  ~

**MVP shipped (2026-08-30):** tray icon + close-to-tray, session persistence /
reattach, and the keep-awake toggle. Details below; the rest of the phase is
still `·`.

- **Signed installers** · — macOS signed+notarized `.dmg` (drag-to-Applications
  art), Windows one-click NSIS `.exe` (+ MSI). *(Unsigned `.dmg` builds today —
  Gatekeeper: right-click → Open on first launch.)* Also: change the bundle
  identifier off `com.craftpanel.app` (Tauri warns — `.app` suffix); needs a
  one-time config-dir migration so the server list / R2 config carry over.
- **Tray + lifecycle** ~ — **done:** Tauri v2 tray icon; **closing the window
  while any server is starting/running/stopping hides to the tray instead of
  quitting** (servers keep running); left-click the tray icon reopens the
  window; tray menu = *Show CraftPanel* / *Quit CraftPanel*. Quit does a
  graceful stop of everything we run (send `stop` / SIGTERM, wait ≤12 s, then
  force) before exiting. **TODO:** per-server Stop items in the tray menu; a
  "stop N servers?" confirm dialog on Quit; a first-time "still running in the
  menu bar" notification; optional dock-icon hiding (`ActivationPolicy::Accessory`).
- **Session persistence / reattach** ✓ — on start, `ProcessManager` writes
  `<server>/.craftpanel-session.json` = `{pid, launcherPid, startedAt,
  rconPort, rconPassword}` (`session.rs`); the monitor deletes it on exit. On
  launch, `adopt_all` reads every file: if the pid is still a live JVM
  (`ps`/`tasklist` + a `java` cmdline check to survive PID reuse) it's
  re-adopted as **Running (reattached)** — full Stop / Players / Settings, the
  `reattached` flag on `ProcSnapshot` drives a badge and disables the (uncaptured)
  console input; Stop uses RCON `stop` when creds were recorded, else SIGTERM →
  SIGKILL. Stale files are cleared. → a CraftPanel restart never orphans a
  server or mislabels it "external" (which used to block restarting it).
  **TODO:** recapture console via `logs/latest.log` tail; reattach an
  externally-started server the same way once RCON/mgmt is reachable.
- **Keep the server up with the lid closed** ~ — **done (macOS):** opt-in
  per-server toggle (`keep_awake` DB column); on start it spawns
  `caffeinate -i -s -w <pid>`, which holds the assertion for the server's life
  and self-exits with it. UI notes that full clamshell still sleeps unless
  plugged in. **TODO (Windows):** `SetThreadExecutionState(ES_CONTINUOUS |
  ES_SYSTEM_REQUIRED)` held on a helper thread for the server's lifetime (needs
  a tiny `windows`/`winapi` dep or an FFI shim); the toggle already persists and
  currently no-ops there with a console note.
- **Bedrock & cross-play** · — Bedrock server as another `ServerAdapter`
  (PowerNukkitX / BDS); one-click Geyser + Floodgate to bridge Java ↔ Bedrock.
- **Self-update** ~ (batch 10) — `updater.rs` checks the GitHub Releases API
  against `CARGO_PKG_VERSION` and shows "vX available →" in app Settings (repo
  is a setting). Full signed auto-download+install via `tauri-plugin-updater`
  needs the CI to sign artifacts + a `latest.json` feed — follow-up.
- **"Keep servers running when I quit"** ✓ (batch 10) — app setting; `on_quit`
  releases share leases but doesn't stop the JVMs, session files stay → next
  launch re-adopts. (Window-close already kept them; this covers Quit.)

## Multi-device sync (the "shared server" / private-code feature)

**Requirement: fully in-app.** No iCloud/Dropbox synced folder, no user file
shuffling. CraftPanel moves the world and the config itself.

### Design — R2 only (no Worker, no database)  ~ built (needs a live token to test)

The two devices are never online together, so there must be a store-and-forward
blob store. Use **Cloudflare R2** (S3-compatible, 10 GB free) and *only* R2 —
the lease is a small object in the same bucket, so there's no Worker and no D1
to run or maintain. Bucket `craftpanel-sync` is created. The user adds an R2 API
token once (dashboard → R2 → Manage API Tokens); CraftPanel stores
`{accountId, bucket, accessKey, secret}` in its config folder.

Client: `r2.rs` (presign with `rusty-s3`, execute with `ureq`), `sync.rs` (zip /
world-hash / lease / push / pull), `cloud.rs` (`CloudManager` implements
`ServerLifecycle` — claims the lease + pulls a newer world before start,
heartbeats every 60 s, pushes + releases on stop). `push_if_changed` only
uploads when this device holds the lease, so a stale device can't clobber a
newer world. Weak CAS for now (put-then-verify); real `If-Match` is the
follow-up. Direction detection is heuristic (holder of the lease is "ahead").

Provisioned once, on the user's Cloudflare (via the connected MCP):
- one R2 bucket, one scoped API token (object read/write on that bucket).
- CraftPanel stores `{account_id, bucket, access_key, secret}` in the app
  config (or per-share). Rust client: the `object_store` crate (native R2/S3
  support, conditional puts).

Per shared server, keyed by an 8-char **code**:
```
<code>/manifest.json     { name, loader, mc_version, created_by, world_hash }
<code>/lease.json         { holder, hostname, claimed_at, expires_at }   (ETag CAS)
<code>/world.zip          the world + configs (later: chunked + incremental)
<code>/props.json         server.properties overrides synced across devices
```

**Flows**
- **Share:** generate code → zip world+config → upload `world.zip` + write
  `manifest.json`. Show the code.
- **Join with code:** download `world.zip`, unpack to a local folder, add the
  server entry. (No lease taken yet.)
- **Start:** CAS-claim `lease.json` (read ETag → conditional put). If another
  device holds a live lease → refuse, UI shows "In use on <name>", with a
  "Start anyway" for a genuinely-dead holder. Heartbeat every 30 s (re-put with
  fresh `expires_at`, TTL 120 s).
- **Stop:** if the local world changed (hash differs), re-zip + upload, bump
  `manifest.world_hash`, then release the lease (delete `lease.json`).
- **Next Start on the other device:** claim lease → if
  `manifest.world_hash` != local hash, pull `world.zip` first → then launch.
- **Conflict / crash:** stale lease (past `expires_at`) is takeable with a
  warning. Local world is never deleted — on a forced pull it's moved to
  `world.conflict-<ts>/`.

**Later:** incremental sync (upload only changed region files, not the whole
zip), background pre-fetch of the latest world so Start is instant, and a
"transfer progress" view (reuse `provision:progress`).

**Multi-user:** sub-profiles with scoped access (start/stop only, no file
access) once a server is shared.

### The folder+lease code already written

`share.rs` (the lease state machine, code generator, per-device id) and the
Share/Join UI stay — the lease logic is identical, only the transport swaps from
"a file in a synced folder" to "an object in R2". `share.rs` grows an R2 backend
alongside the folder one; the folder mode can stay as an offline/LAN option.

## Cracked / offline-mode servers (hard constraints)

The reference server is `online-mode=false` (cracked) with its own grief
protection. CraftPanel must not fight that:

- **Never write `online-mode`.** Not in RCON setup, not in the settings panel's
  "apply", not on first-boot provisioning. When editing `server.properties`,
  only the keys the user actually changed are rewritten; everything else is
  byte-preserved (see Stage 4 "structured writes, never regex").
- The settings panel *shows* `online-mode` with a plain-language note
  ("offline/cracked — anyone can join with any name unless an auth mod is
  running") but the toggle is the user's call, defaulting to whatever the file
  says.
- **Player identity is by name, not UUID.** RCON kick/ban/whitelist/op all key
  on username; offline UUIDs are name-derived and unstable, so don't cache or
  display them as identity.
- **Auth-mod awareness (Stage 4):** detect common offline-auth mods in `mods/`
  (EasyAuth, SimpleAuth, Fabric Auth, AuthMe-style) and surface "protection: on"
  instead of warning about online-mode. The dependency checker treats them as
  known mods.
- RCON auto-config only ever adds/sets `enable-rcon`, `rcon.port`,
  `rcon.password`, `broadcast-rcon-to-ops` — nothing else.

## Cross-cutting

- Keep `ServerAdapter` the only game-aware seam.
- Every stage independently testable against a real local server.
- Dark theme, orange `#FF8C00`.

---

## Feature-parity map (Aternos · exaroton · Anvil-MC · MC Server Manager)

Studied the big players to size what a "complete" panel does. CraftPanel is
*local self-hosted* (not cloud), but the feature surface is the same. Grouped by
where each lands.

### Content browser — **Stage 4.6** (high priority; all three do this)
- **In-app Modrinth browser**: search mods / plugins / datapacks / modpacks,
  filter by loader + MC version, one-click install into the right folder.
- **Dependency resolution**: when a mod needs deps, list exactly which and offer
  "install all" in one button (Anvil-MC / exaroton both do this).
- **One-click modpacks**: install a Modrinth (later CurseForge) modpack — pulls
  the loader, version, and mod set. Extends the Stage 2.5 wizard.
- **Update checks**: flag installed mods/plugins with a newer build available.
- Keep the drag-drop / file import from Stage 4 as the manual path.

### Native Management Protocol — **Stage 3.5** (MC 1.21.9+ / the 26.x line)
The reference server (MCServ, 26.2) already has `management-server-*` keys.
Minecraft now ships a **JSON-RPC-over-WebSocket** management API:
- Query + update players, allowlist, ops, settings, game rules **without a
  restart**, and receive live events (joins, gamerule changes, …).
- 40-char bearer secret (auto-generated if blank), TLS on by default.
- CraftPanel should **auto-detect** it and prefer it over RCON when present;
  fall back to RCON for older servers. This kills most "restart to apply"
  banners and gives a real event stream instead of log-scraping.
- Also exposes **TPS / MSPT** (RCON can't) — feeds the perf view below.

### Backups — **Stage 9**
- Manual "backup now" (zip of world(s) + configs), listed with size/date.
- Scheduled backups (hourly/daily/on-stop) with a retention count.
- One-click restore (world moved aside, not deleted).
- Download a backup; optional cloud target (reuse the Stage 7 Cloudflare R2
  wiring, or a user-picked folder / iCloud / Dropbox).

### Scheduled tasks & automation — **Stage 10**
- Auto-restart on a schedule (with in-game warning countdown).
- Auto-restart on crash (bounded retries, backoff).
- Scheduled console/RCON commands (e.g. nightly `save-all`, announcements).
- Start/stop windows (only run 4pm–midnight, etc.).

### File manager — **Stage 4.7**
- Browse the server folder in-app: view, edit (text), upload, download, rename,
  delete, mkdir. SFTP-parity for the things people open an SFTP client for.
- **Config-as-forms** beyond `server.properties`: `bukkit.yml`, `spigot.yml`,
  `config/paper-global.yml`, common Fabric mod configs — rendered as forms
  (exaroton does this), raw editor underneath.

### World management — **Stage 11**
- Multiple worlds: list, switch active (`level-name`), create, delete, rename.
- Upload / download a world (zip).
- **Chunk pre-generation** (Anvil-MC & MSM both ship this) — run a
  pregenerator to warm the world and cut in-game lag spikes.
- World border, seed display, "regenerate world" (with a backup first).

### Performance & health — **Stage 4.5** (merge with JVM tuning)
- Live **TPS / MSPT** graph (from the management protocol, or `/spark` / `/tps`).
- RAM + CPU of the server process over time.
- Parse `crash-reports/` — show the latest crash, highlight the offending mod,
  link out.
- `/spark` or `/mspt` integration for a flame-graph-ish profile on demand.

### Networking / sharing — **Stage 5** (expand)
- First-class **tunnel** so no port-forward is needed at all (playit.gg agent
  bundled, or an ngrok-style option) — Aternos/Anvil-MC give a free address;
  match that.
- Copyable join address + **QR code** for quick invites.
- Rich **MOTD editor**: colour codes / gradients / two-line, live preview;
  server-icon picker (auto-resize to 64×64 PNG).

### Bedrock & cross-play — **Stage 12** (big; fits the adapter design)
- Bedrock server support (PowerNukkitX or BDS) as another `ServerAdapter`.
- **Geyser + Floodgate** one-click to bridge Java ↔ Bedrock into one world.

### Player analytics — **Stage 13**
- Per-player: first seen, last seen, total playtime, join count, last IP
  (offline-mode aware).
- Session history / online-now with skin heads.

### Multi-user — folds into **Stage 7**
- Sub-profiles with scoped access (start/stop only, no file access, …) — matters
  once a server is shared via the private code.

## Cross-cutting

- Keep `ServerAdapter` the only game-aware seam.
- Every stage independently testable against a real local server.
- Dark theme, orange `#FF8C00`.
- Prefer the **native management protocol** over RCON wherever the server
  supports it; RCON stays the compatibility path.
