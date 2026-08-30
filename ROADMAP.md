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
- **Bedrock & cross-play** ~ (batch 11, 2026-08-30) — `crossplay.rs`: one-click
  **Geyser + Floodgate** from GeyserMC's build API into `plugins/` or `mods/`
  (Paper / Spigot / Fabric / NeoForge), so Bedrock-edition friends (phone /
  console / Win10 store) join the Java server with no Java account. Reads
  Geyser's Bedrock UDP port; UPnP UDP forward for it. "Bedrock cross-play" card
  in the Network tab. **TODO:** a full Bedrock *server* adapter (PowerNukkitX /
  BDS) for the other direction.
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

## Batch 12 — full visual + UX redesign (2026-08-30)

The UI read like a dev tool: flat, low-contrast, every panel the same weight,
no onboarding, unclear next action. This batch rebuilds the presentation layer
without touching business logic — every Tauri command, event and type is
unchanged.

**Token system** (`src/index.css`)
- Raw values on `:root` as `--cp-*`; Tailwind maps them with `@theme inline`,
  so themes swap at runtime with no rebuild.
- Full ramp: bg + 4 surfaces + console well, 3 line levels, 4 ink levels,
  accent (hover/press/soft/muted/line/ring/on-accent), 4 semantic statuses each
  with a `-soft` (text) and `-muted` (fill) pair.
- Radius scale (6), shadow scale (3 + inset + glow), 8-step type scale,
  motion tokens (120/160/220 ms, one ease).
- Old token names (`panel`, `panel-2`, `edge`, …) are kept as aliases so no
  feature panel broke during the migration.
- **Light theme is already written** as a `:root[data-theme="light"]` block —
  wiring a switch is the only work left.
- Contrast is measured, not guessed: every ink level clears WCAG AA on every
  surface it can appear on (`ink-faint` was lightened to `#908d98`,
  `ink-ghost` to `#6f6c79` and demoted to placeholders/disabled only).

**Platform skinning — one codebase, two native feels**
- `main.tsx` stamps `<html data-os="mac|win|other">` before first paint.
- `:root[data-os="win"]` overrides radii (tighter), shadows (crisper), border
  strength, control height, the font stack (Segoe UI Variable / Cascadia Mono)
  and the focus ring (Fluent-style light ring). macOS keeps softer corners,
  system-ui/SF and diffuse shadows.
- Rejected a native rewrite (SwiftUI + WinUI, or swift-cross-ui): it turns the
  Rust core into a hand-written C-ABI surface for ~100 commands plus the
  streaming events, and rebuilds the tauri-action release pipeline — for an app
  that is mostly log streams, a Modrinth browser and a file editor, i.e. the
  places a webview is the stronger renderer.

**Bundled display face**
- Space Grotesk (SIL OFL 1.1), latin subset, 22 KB woff2 at
  `public/fonts/space-grotesk-latin.woff2`. Headings + logo only; body stays
  system-ui. No network at runtime.

**`ui.tsx` rebuilt** — Button (6 variants x 3 sizes, loading, icon slots),
IconButton, Badge, Pill, StatusDot, Card, SectionHeader, Field, SettingRow,
TextInput, Textarea, Select, Slider, Toggle, Checkbox, Tabs (with overflow
menu + arrow-key roving focus), Segmented, Modal (portal, focus trap, Esc),
Banner, EmptyState, StateBlock (loading/empty/error/offline), Skeleton,
Spinner, ProgressBar, Tooltip (portal-positioned), CopyField, Kbd,
Toaster + a module-level `toast()`.

**Screens**
- Shell: sidebar with rich status rows (dot + state + type + version + live
  player count), split "New server" CTA, settings footer, ⌘/Ctrl+N.
- First run: welcome hero with a 1-2-3 and one big CTA.
- Server detail: top bar with a large status chip + uptime, Start/Stop, and an
  overflow menu for restart/kill; banners for EULA, crash (with the suspect
  mod named), external-port, restart-required, sync.
- Console: parsed log lines (dim timestamp, coloured level, left rail for
  warn/error), filter, error count, jump-to-latest, command history.
- Health strip: area sparklines with gradient fill and a "now" dot.
- Network: hero join address + QR, a three-rung "who can reach this" ladder
  with per-rung fixes, tunnel/UPnP/Bedrock cards, advanced behind a disclosure.
- Settings: Basics/Advanced/Raw tiers, every key an icon + label + one-line
  help + control, floating save bar, in-app remove confirmation.
- Create wizard: loader cards with marks, searchable version list, friendly
  world & rules step with a live multiplayer-list MOTD preview, confirmation.

**Bugs found and fixed on the way**
- `window.prompt()` is a no-op in Tauri's WKWebView, so **rename in Worlds and
  Files silently did nothing on macOS**. Both now use in-app dialogs, as does
  new-folder; `confirm()` deletes became real modals.
- The create wizard had no way back out of a failed provision — added.
- Favicon was a 276 KB PNG wordmark; now a 0.5 KB SVG mark. `index.html` also
  paints the window background before React mounts, killing the launch flash.

## Batch 13 — mods/errors/attribution (2026-08-30)

- ✓ **Console command autofill** — shipped. `data/mcCommands.ts` (~50
  vanilla/Bukkit-core commands with per-argument suggestions) +
  `CommandInput.tsx`, wired into the live console and the RCON `/` field.
  RCON's field also autocompletes real online player names for `<player>`
  argument slots.
- ✓ **Mod dependencies auto-install** — already existed
  (`modrinth.rs::install`, doc'd as "install with required-dependency
  resolution", covered by `live_install_with_deps`). No work needed; just
  didn't know about it until I read the backend.
- ✓ **"Players need this too" warning** — Modrinth's `client_side` field
  (required/optional/unsupported/unknown) was fetched by the API but never
  read; only `server_side` was. Now threaded through
  (`modrinth::Hit.client_side` → `ModrinthHit.clientSide`) and surfaced as a
  clear badge in the Add-ons browser. Message is loader-aware: Fabric/Forge
  already refuse a mismatched client at the door (their own handshake, real
  MC protocol behaviour, nothing CraftPanel does) so the copy says so;
  Paper/Spigot plugins have no such mechanism, so the copy tells the admin
  to say something themselves (the join-address screen is one click away).
- ✓ **Hidden per-install attribution marker** — `.craftpanel-meta.json`
  written into every server folder on create *and* add (`attribution.rs`),
  carrying a random install id (generated once, persisted in the existing
  settings KV store — no new schema), the CraftPanel version, a timestamp,
  and whether the server was `created` or `added`. Plain dotfile, not
  hidden by any trick — same convention as `.craftpanel-trash/` and
  `.craftpanel-modrinth.json` elsewhere in this codebase. No PII: it
  identifies the *install*, not the person.
- ✓ **Toggle switch overflow** — the knob could render outside the track on
  "on" (see Batch 12 postscript below); this batch also hardened the "New
  server" split-button's dropdown against a same-click race and dropped its
  entrance animation, in case a WebView2 compositing quirk on first paint
  was swallowing it — flagged as unconfirmed, see note below.
- ✓ **Humanized errors app-wide** — new `data/humanizeError.ts` +
  `ErrorBanner.tsx`. Recognizes the error shapes that are genuinely
  technical (OS error codes, DNS/network failures, `os error N`, a raw Rust
  `Err(...)` debug dump, port-in-use, disk-full, locked database) and gives
  *those* a plain headline + one concrete next step, with the original text
  behind a "Show technical details" toggle. Everything else — which is most
  of this backend's error strings, they're already written in plain English
  — passes straight through as the headline with no wrapping, so already-good
  messages don't get worse. Replaced the raw `<Banner tone="bad">{error}</Banner>`
  pattern in all 21 places it appeared.

**Not confirmed — needs your eyes:** the "New server" dropdown not opening.
I reproduced something that looked like it through my own browser-automation
testing, but that same session I *also* found three separate quirks in my
own testing tool (arrow keys and Enter reporting an empty `key`, and a 1.6x
coordinate-scaling mismatch between screenshots and click coordinates) — the
"reproduction" turned out to be my click landing on an unrelated Tabs button,
not your bug. I hardened the two most plausible real causes (a same-click
race in the outside-click handler; a possible animation/compositing quirk on
first paint) rather than claim a fix I couldn't actually verify. If it's
still broken after this build, I need a screen recording or the exact steps
— I don't have a way to see your screen from here.

## Batch 14 — broadcast, doctor check, crash quick-fix (2026-08-30)

- ✓ **Message players** (`BroadcastSection.tsx`, new) — three modes, all over
  the existing RCON connection, no new backend needed:
  - **Full screen**: `/title` + `/subtitle`, with a live screen-accurate
    preview (big bold text + small text underneath) so what you're about to
    send is never a guess.
  - **Chat**: `/tellraw @a`, optional bold "[Server]" tag, 8-colour picker.
  - **Warn one**: `/tellraw <player>`, player picked from who's actually
    online right now (same RCON player list RconPanel already polls) — sent
    privately, nobody else sees it.
  All three build the command by `JSON.stringify`-ing a real object and
  interpolating *that* — never hand-spliced strings — so a player's message
  containing `"` or `\` can't break the command or inject anything.
- ✓ **"Doctor" pre-flight check** — new `doctor.rs` + a "Run check" button in
  CraftPanel settings. Four checks, three built from code that already
  existed (`java::probe`, the same free-port scan `create_server` uses,
  `CloudManager`'s existing R2 round-trip check) plus one new one (disk
  space, via `sysinfo::Disks` — already a dependency, just unused for this).
  Surfaces the reasons a create/start would fail *before* it fails.
- ✓ **One-click "disable it" on the crash banner** — when the named suspect
  looks like an actual mod file (ends in `.jar`) and the server type has a
  mods folder, the crash banner gets a second button next to "Start again"
  that calls the same `setModEnabled` the Mods tab already uses. No new
  backend code — this one was purely wiring.

**Explicitly not attempted this batch**, and why: Java auto-install,
standalone Bedrock, and one-click modpacks are each large enough (Java
auto-install downloads and executes a third-party binary; Bedrock is a new
`ServerAdapter`; modpacks touch the wizard, provisioning, and need a curated
catalog) that doing all three alongside everything above in one pass would
mean rushing the riskiest one. Java auto-install specifically needs a
checksum-verification review pass before it ships — see the plan below,
unchanged from last batch, still the next one up.

## Java & dependency auto-install — planned, not built

Currently CraftPanel only *detects* Java (`java::probe` scans PATH) — there's
no download/install path. This is genuinely the largest ask in the pile, so
here's the actual plan rather than just a size guess:

1. **Source**: Eclipse Temurin via the Adoptium API
   (`api.adoptium.net/v3/assets/latest/{feature}/hotspot?os=..&arch=..`) —
   free, no auth, gives a direct download URL + checksum per OS/arch. Ship
   Java **17** and **21** (covers every MC version in the wild; the existing
   Java-major-vs-MC-version compat check in `java.rs` already knows which one
   a given server needs).
2. **Where it lives**: `<app data dir>/jre/{17,21}/{os}-{arch}/` — shared
   across all servers, not copied per-server. One 17 + one 21 download ever,
   not one per server.
3. **Flow**: `detect_java` fails or the detected major doesn't match what the
   server needs → instead of the current dead-end error, a banner offering
   **"Download Java {N} (≈45 MB)"** → download with progress (same
   `provision:progress`-style event the create wizard already uses) →
   extract → checksum-verify → write the resolved path into that server's
   `java_path` automatically. No PATH edits, no admin/sudo, nothing global.
4. **Risk/cost**: this is the first feature that downloads and *executes* a
   third-party binary users didn't explicitly fetch themselves — checksum
   verification is not optional here, and macOS Gatekeeper/quarantine on the
   extracted `java` binary needs the same `xattr` treatment already documented
   for CraftPanel's own DMG (see [[craftpanel-build-gotchas]]). Budget a
   review pass specifically on the download/verify/exec path before shipping.
5. Natural follow-on once this exists: fold it into `humanizeError.ts`'s
   Java-missing case (it currently just explains the problem; it could offer
   the fix inline).

## Batch 15 — Java auto-install (2026-08-30)

✓ **Shipped.** New `javainstall.rs` (~300 lines) downloads Eclipse Temurin
via the Adoptium API, verifies its SHA256 checksum before touching it, and
extracts it — shared across every server, installed once per major version
(17 and 21; see the module doc for why 8 and the narrow 1.17-only 16 aren't
covered). Wired into the UI as a real inline fix on the "no Java" error
banner: `ErrorBanner` recognizes the error, offers an "Install Java N now"
button with live progress, and points the server's `java_path` at the result
on success.

- `offerable_feature(required)` — maps a Minecraft version's Java
  requirement to a bundled major, or `None` when there isn't a safe match.
- `install()` — fetch → download-with-progress → sha256 verify (mismatch =
  delete + hard fail, never run unverified bytes) → extract → chmod +x on
  Unix → probe.
- New commands: `java_offerable_for`, `java_install_status` (disk-only, no
  network), `install_java`, `set_server_java_path`.
- Frontend: `JavaInstallFix.tsx`, rendered inline by `ErrorBanner` when the
  error is Java-shaped and a `serverId` is available — currently that's only
  `ServerDetail`'s top-level error banner (a failed Start). The create
  wizard's own EULA/provisioning failure isn't wired to this yet — no server
  record exists at that point in the flow, so there's nowhere to persist the
  installed path to; a real fast-follow, not attempted here.

**A real bug the live test caught before it shipped:** Adoptium packages
macOS builds as a full `.jdk` *bundle* — `JAVA_HOME` is nested at
`<archive-root>/Contents/Home/`, not `<archive-root>/` directly like
Linux and Windows. First implementation assumed the same flat layout on all
three platforms and would have installed "successfully" on macOS while
leaving `bin/java` unfindable. Caught by actually running the (`#[ignore]`d,
network-hitting) end-to-end test against the real API before considering
this done — same convention as `modrinth.rs`'s `live_install_with_deps`.
Fixed with an OS-aware `java_home()` lookup; re-ran the live test to confirm
a real `java -version` on the extracted binary now reports major 17.

**Security posture, stated plainly:** this is the one feature in CraftPanel
that downloads and executes a third-party binary the user didn't fetch
themselves. Mitigations in place: HTTPS-only source (GitHub Releases via the
official Adoptium API, no mirrors), SHA256 verified against Adoptium's own
published checksum before extraction — mismatch deletes the file and fails
loudly rather than warns-and-continues, and the runtime lives in CraftPanel's
own app-data directory rather than anywhere on PATH, so it can't shadow or
be confused with anything else on the system. Not done: signature
verification against Adoptium's GPG key (checksum-only) and no macOS
notarization check on the extracted binary — both reasonable hardening for
later, not blockers for what shipped.

## Batch 17 — standalone Bedrock servers, shipped (2026-08-30)

Built the plan below, same day. `ServerType::Bedrock` added — the compiler's
exhaustiveness checking on that enum found every real site that needed a
decision (4 non-exhaustive-match errors: anticheat.rs, crossplay.rs, db.rs,
modrinth.rs), which is exactly the systematic way to do this kind of change
without missing a spot.

**What works:**
- New `bedrock.rs`: detect an existing install, download+extract a fresh one
  from Mojang's real download-links API (Windows/Linux zip, confirmed live),
  parse "running" from console output. The startup line (`Server started.`)
  was confirmed with `strings` on the actual `bedrock_server` ELF binary,
  since running it to observe real output isn't possible from this Mac.
- Create wizard: a genuinely different-feeling "Bedrock" card (blue mark, a
  divider separating it from the Java loaders, its own pitch text), disabled
  with a clear one-line explanation on macOS, skips the meaningless
  version-picker step entirely (Mojang's API has no historical versions —
  just "current"), hides the RAM slider (Bedrock isn't a JVM, `-Xmx` doesn't
  apply and the backend never reads it), and the EULA checkbox's copy
  changes since there's no `eula.txt` to write.
- Launch: `process::build_command` runs the binary directly from its own
  folder — no heap flags, no `-jar`. `eula_accepted` short-circuits `true`
  for Bedrock (nothing to check). `spawn_reader` dispatches the right status
  parser by server type.
- Settings tab: real Bedrock keys (`server-name`, `gamemode` without
  "spectator", `allow-cheats`, `allow-list`, `tick-distance`,
  `default-player-permission-level`, …) confirmed against the actual
  server.properties shipped in Mojang's zip — not guessed. Two fields
  (`compression-algorithm`, `chat-restriction`) left as free text rather
  than a guessed-at enum, so a real value can't get silently hidden.
- Server creation writes `server-name` (not `motd`) and skips `query.port`/
  `rcon.port` (Bedrock has neither) — these would previously have been
  written as inert-but-wrong keys.
- Network tab, Backups, and Files all work unchanged — they were already
  generic enough (port read from the shared `server-port` key, whole-folder
  zip, plain file browsing).

**Deliberately hidden, not built:** Players/RCON (Bedrock has no RCON at
all — confirmed, no `rcon.*` keys anywhere in server.properties or the
bundled docs), Add-ons (no Modrinth ecosystem for Bedrock in this sense),
Worlds (different, LevelDB-based world format). Console still works — both
editions take commands on stdin the same way.

**Verified, not just compiled:**
- `cargo test`: 105 passed, 0 failed, 11 ignored, real (non-piped) exit
  code 0 — see the process note below.
- A live end-to-end test (`#[ignore]`d, same discipline as
  `javainstall`'s) downloads the real Mojang zip and confirms the binary +
  server.properties land correctly — skips gracefully with a clear message
  on macOS rather than failing, since there's genuinely nothing to install
  here.
- A real Rust test (`bedrock_gets_bedrock_shaped_fields_not_java_ones`)
  reads an actual properties file through `settings::read()` and asserts
  the Bedrock keys/values come back correctly and the Java-only keys
  (`motd`, `pvp`, `query.port`, `level-type`) are entirely absent, not
  just empty.
- Visually walked the wizard end-to-end in the browser preview: confirmed
  the disabled macOS state, the enabled Windows state, that selecting
  Bedrock skips straight from step 1 to step 3, and that the RAM slider is
  actually gone rather than just decorative. Confirmed the sidebar and tab
  bar both show the right thing for a Bedrock server (Console / Network /
  Settings / Backups / Files only).

**Process note, worth remembering:** found mid-batch that every
`cargo test 2>&1 | tail -N` invocation this session reported the wrong exit
code — a pipeline's exit status is its *last* command's by default, so
`tail`'s success (always 0) was masking real `cargo test` failures. It
mattered here: the `eula_accepted`/`settings::read` signature changes broke
three existing tests, and `cargo check` doesn't build test code, so nothing
caught it until a properly-captured `cargo test` run did. Fixed and
reverified for real. Going forward: redirect to a file and check `$?`
directly (`cargo test > log 2>&1; echo $?`), never pipe through `tail` when
the exit code is what's being trusted.

## Batch 18 — one-click modpacks, shipped (2026-08-30)

Built the plan below, same day. Modrinth `.mrpack` format confirmed against
a real downloaded pack (Fabulously Optimized) before writing a line of code
— `modrinth.index.json`'s exact shape, the `dependencies` map's real keys
(`minecraft`, `fabric-loader`/`forge`/`neoforge`), the `env.server`
required/optional/unsupported convention, and that `overrides/` +
`server-overrides/` are both genuinely optional per pack.

**Also fixed, as planned:** the "Modpacks" search category that already
existed in the Add-ons browser — it downloaded a `.mrpack` file and dropped
it inert into `mods/`, reporting success while doing nothing. Removed;
modpacks are a create-time wizard flow now, which is the only place they
ever could have worked (a pack dictates its own loader + Minecraft version,
which can't change after a server already exists).

**What works:**
- `provision.rs` gets `create_from_modpack()`: fetch the pack's newest
  version → download the `.mrpack` → verify its sha1 (delete + fail loudly
  on mismatch, same as every other download in this app) → parse the index
  → derive loader + Minecraft version from `dependencies` → run the
  *existing* Fabric/Forge/NeoForge/Vanilla provisioning for that combo (no
  duplicated logic) → download every file whose `env.server` isn't
  "unsupported", each individually hash-verified → extract `overrides/`
  then `server-overrides/` on top (later wins, per spec) → first-boot as
  normal. A pack needing Quilt gets a clear, honest error rather than being
  silently mis-provisioned as Fabric — CraftPanel doesn't provision Quilt.
- **Path-traversal guarded explicitly**: every file path in a pack's index
  and every override entry is untrusted input from a third-party-authored
  zip. `safe_relative_path()` rejects absolute paths and any `..`
  component before it ever becomes a filesystem write — covered by its own
  test with real traversal payloads, not just the happy path.
- Wizard: a "Browse a modpack instead" card (separated from the Java
  loaders, like Bedrock is), leading to a real search-and-pick step, a
  simplified "Your world" step (name/folder/RAM only — no seed/gamemode/
  motd fields, since the pack's own overrides already cover that ground),
  and a Ready screen showing the pack's own icon and title instead of
  loader/version badges.

**Verified, not just compiled:**
- `cargo test`: 108 passed, 0 failed, 12 ignored, real exit code 0
  (checked without piping through `tail`, per the process fix from the
  Bedrock batch).
- A live end-to-end test (`#[ignore]`d) installs the actual Fabulously
  Optimized pack from the real Modrinth CDN — 50 real mod files, a real
  `overrides/config/` folder, a real Fabric provision, a real first-boot.
  Passed in 74 seconds. This is the highest-surface-area new code in this
  batch (network fetch, zip parsing, hash verification, filesystem writes
  from untrusted paths, reusing three different provisioning paths), so it
  earned an actual run against the network rather than trusting the
  compile.
- `safe_relative_path` has its own dedicated test with real `../../../etc/
  passwd`-shaped inputs, given it's the one thing standing between a
  malicious pack's file list and a write outside the server folder.
- Walked the wizard in the browser preview end to end: the modpack card,
  the step rail correctly relabeling "Version" → "Modpack", search results,
  picking a pack, the simplified world step, and the Ready screen showing
  pack branding instead of loader/RAM badges.

## Batch 19 — app auto-update, shipped (2026-08-30)

`updater.rs` used to only check GitHub for a newer tag. Now it can actually
install one: `tauri-plugin-updater` + `tauri-plugin-process` registered,
CI signs release artifacts and publishes a `latest.json` manifest, and
Settings → Updates has a real "Install & restart" button with progress.

**What works:**
- `updater::install()` builds the update endpoint at install time from the
  per-install `githubRepo` setting (not baked into `tauri.conf.json`) —
  `https://github.com/{repo}/releases/latest/download/latest.json` — since
  different forks/builds of CraftPanel can point at different release repos.
  Only ever resolves against the latest *published* release; the workflow
  still drafts releases for manual review before anything ships to users.
- Downloads, signature-verifies (against the pubkey baked into
  `tauri.conf.json`), and installs the update, emitting `update:progress`
  events (reused `provision::Progress`'s shape) the same way Java install
  and server provisioning already do. Settings shows a progress bar, then
  "Restart now" (`@tauri-apps/plugin-process`'s `relaunch()`).
- CI (`release.yml`) signs with `TAURI_SIGNING_PRIVATE_KEY`/
  `_PASSWORD` repo secrets — build still succeeds without them, it just
  won't produce signed updater artifacts, so nothing breaks for a fork
  that hasn't set them up.
- Generated the real signing keypair locally (`npx tauri signer generate`).
  Private key lives outside git at `.updater-key-DO-NOT-COMMIT/` (gitignored)
  — never committed, never pushed. Public key is in `tauri.conf.json`.

**Verified:**
- `cargo check` and `cargo test` both clean against the real
  `tauri-plugin-updater` v2.10.1 / `tauri-plugin-process` v2.3.1 APIs —
  108 passed, 0 failed, real exit code 0 (checked directly, not piped).
- `tsc --noEmit` and `vite build`: both clean.
- **Not yet live-tested end to end** — unlike Bedrock/modpacks, this one
  genuinely can't be: it needs a real signed, *published* release to update
  to, which needs the CI secrets set first (they aren't yet — see chat).
  The first real tag pushed after those secrets exist is the real test.

## Batch 20 — Settings promoted to a full page (2026-08-30)

Researched what CraftPanel's app-wide settings actually cover now (versus
when the modal was written) before touching anything: updates (Batch 19),
Java auto-install (Batch 15), R2 cloud config (buried in a per-server
Network tab, even though it's device-wide), the doctor check (Batch 14),
and the attribution install id (Batch 13) had no home a user would think to
look in. The old single-scroll modal couldn't fit all of that without
becoming a wall of text, so it's now a full page — same header+Tabs chrome
`ServerDetail` already uses, reached from the sidebar's settings button
instead of popping a dialog over whatever server you had open.

**Tabs:** General (Java/RAM defaults, expert mode, keep-on-quit — unchanged
from the old modal), Updates (Batch 19, unchanged), **Java** (new — shows
both installable runtime features with install status/progress in one
place, not just reactively on a crash banner; "Make default" points
`defaultJava` at one with a click), **Cloud & Backups** (new — promotes R2
config to a first-class connected/not-connected status card instead of
something you only discover mid-share-flow, plus the already-existed-but-
buried global backup retention setting), Diagnostics (the doctor check,
unchanged), **About** (new — app version, and the install id from
`attribution.rs` with a copy button and a plain-language explainer of what
it is and why it exists, since the person running their own app should be
able to see it, not just have it be invisible).

Two new backend commands, both trivial reads: `app_install_id` (wraps the
existing `attribution::install_id`) and reusing the *already-existing*
`java_install_status` per feature — no new Java-runtime-listing logic
needed. Deleted the old `AppSettingsModal.tsx`; nothing referenced it after
the move.

**Verified:**
- `cargo check`: clean. `tsc --noEmit` and `vite build`: both clean.
- Walked all six tabs in the browser preview: General, Updates (including
  triggering a fake "2.1.0 available" → install → progress → "Restart now",
  same event-driven flow as Batch 19), Java (install-from-empty →
  progress → installed → "Make default"), Cloud & Backups in both the
  not-connected and connected (`?r2on`) states, Diagnostics (ran the check,
  saw the real 4-check shape), About (version, install id, copy button, all
  populated).

## Batch 21 — scheduled backups to R2 (2026-08-30)

Two real gaps closed together: `schedule.rs` could only ever back up *on
stop* — a server nobody restarts never got backed up at all — and R2 had no
role in backups whatsoever, only world-sync. Both fixed without touching
the local backup code's actual zip/verify logic.

**What works:**
- `Schedule` gets two fields: `intervalBackupHours` (back up every N hours
  while running — independent of, and on top of, `backupOnStop`) and
  `cloudBackup` (push whichever backup just ran, either trigger, to R2).
  Both wired into `AutomationSection.tsx` — a disabled-when-off hours input
  for the interval, and a toggle for cloud push whose hint says plainly
  what it needs and that it's silently skipped without it, rather than
  erroring on every tick for someone who never turned R2 on.
- The on-stop and interval triggers now share one `Scheduler::run_backup`
  helper (previously the on-stop path had this logic inline) — local backup
  → local prune → cloud push if opted in, one place instead of two.
- **Cloud side, deliberately minimal:** no `ListObjectsV2` XML parsing —
  same spirit as r2.rs's own "no AWS SDK" doc comment. Each server keeps a
  single `backups/<id>/index.json` object; push does a read-modify-write
  (fold the new backup in, sort newest-first, split off anything past
  `keep`, delete the dropped zips) instead of listing the bucket. That
  read-modify-write logic is pulled into a pure `merge_and_prune()` so it's
  actually unit-tested, not just compiled — see below.
- New `cloud_backups` command + a compact "N backups also in the cloud —
  newest Xh ago" strip in `BackupsPanel.tsx`. Deliberately **not** a full
  remote browse-and-restore UI — that's meaningfully more scope than "push
  scheduled backups off-machine," which is what was actually asked for; a
  restore-from-cloud flow is its own future batch if it's wanted.

**Verified:**
- `cargo test`: 112 passed (4 new), 0 failed, 12 ignored, real exit code 0.
  The 4 new tests cover `merge_and_prune` (newest-first sort, prune-to-keep,
  re-pushing a backup id replaces rather than duplicates it, `keep=0` is
  unlimited) and `Schedule::is_default()`/JSON-roundtrip with the two new
  fields.
- `tsc --noEmit` and `vite build`: both clean.
- **The actual R2 network calls are unverified live** — same honest status
  as the rest of cloud sync in this app right now: per project memory, R2
  sync was built but never tested against a real bucket, since the
  credentials on hand aren't the S3 key pair R2 needs. `merge_and_prune`
  being pulled out and unit-tested is exactly *because* the network calls
  around it can't be tested yet — it's the one part of this batch that
  could be, so it was. Walked `AutomationSection`'s two new controls and
  `BackupsPanel`'s cloud-status strip in the browser preview — rendering
  and interaction only, no real R2 call involved there either.

## Bugfix — Java requirement for the 26.x version scheme (2026-08-30)

User-reported: `java::required_java_for_mc` treated *any* non-"1.x" version
(i.e. the new year-based scheme — 26.0 and up, replacing "1.x") as needing
Java 21, when 26.0+ actually needs Java 25+. Fixed to require 25 for
`major >= 26`. Also added Java 25 to `javainstall.rs`'s offerable/auto-
install list (was only 17/21) and to the Settings → Java tab, so a 26.x
server actually gets a working "Install Java 25" fix instead of detecting
the right requirement but having nothing to offer for it. Confirmed
Adoptium really does publish Java 25 JRE builds for mac (both arches),
windows, and linux via a live (keyless) API check before shipping this —
same download/verify/extract code path already covered by the Batch 15
live end-to-end test, just parameterized differently, so no new live test
was needed to trust it. `cargo test`: 112 passed, 0 failed, real exit 0.

## Other future ideas — sized, not yet scheduled

- ✓ **A "doctor" pass in CraftPanel settings** — shipped, Batch 14.
- ✓ **One-click "disable the suspect mod" on the crash banner** — shipped,
  Batch 14.
- **Marketing/landing site** — a real site for CraftPanel, styled after the
  user's own kiqa-dev.it. Not app code; own repo/deploy target.
- **Cookies / Privacy Policy / ToS pages** — needed once there's a landing
  site or any account/subscription surface collecting data. Blocked on
  deciding what data is actually collected (currently: none beyond the new
  install-id marker above, which is anonymous and local-only; R2 cloud-sync
  is opt-in and BYO-credentials).
- **Subscription model** — mentioned as "idk", i.e. undecided. Needs a real
  decision on what's paid (hosting? cloud sync? nothing, and it stays free?)
  before it's actionable — this one blocks on a product decision, not code.
