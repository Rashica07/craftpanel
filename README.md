<div align="center">

# CraftPanel

**Run your own Minecraft server — without the config files, the terminal, or the port-forwarding headache.**

A desktop app for macOS and Windows that creates, runs, and shares Minecraft servers.
Pick a version, press Start, send your friends a link. That's it.

[Download](#download) · [Features](#what-it-does) · [Roadmap](ROADMAP.md)

</div>

---

## What it does

**Create a server in under a minute.**
Choose Vanilla, Paper, Fabric, Forge or NeoForge and a Minecraft version — CraftPanel
downloads the server, sets up the config, accepts the EULA, and first-boots it for you.
Pick a seed, gamemode, difficulty and MOTD right in the wizard.

**Start and stop it like an app.**
A real console, a live player list, one-click RCON, and RAM/CPU/TPS graphs so you can
see how it's running. Crashes are caught and explained — it even points at the mod that
likely caused it.

**Let friends join from anywhere.**
Built-in tunnel: one click gives you an address that works over the internet with no
router setup. Or auto-forward your port over UPnP. Copy the address, or scan the QR code.
Bedrock players (phone, console, Windows 10/11) can join too — one click installs Geyser.

**Manage everything without leaving the app.**
Browse and install mods & plugins from Modrinth with automatic dependency resolution.
Edit `server.properties` as friendly toggles. Switch worlds. Manage ops, whitelist and
bans. Browse and edit files. Take backups and restore them — the old world is always
moved aside, never deleted.

**Keep it running.**
Auto-restart on crash, scheduled daily restarts with an in-game countdown, timed commands,
and automatic backups on stop. Close the window and it keeps running in the menu bar / tray.
Optionally keep your computer awake so the server stays up while you're away.

**Play together across computers.**
Share a world with a friend using a private code. CraftPanel moves the world to your own
Cloudflare R2 storage on stop and pulls the latest on start — whoever's playing holds the
lock so you never overwrite each other.

---

## Download

Grab the latest installer from the [**Releases**](../../releases) page:

| Platform | File |
| --- | --- |
| **Windows 10 / 11** | `CraftPanel_*_x64-setup.exe` |
| **macOS (Apple Silicon)** | `CraftPanel_*_aarch64.dmg` |
| **macOS (Intel)** | `CraftPanel_*_x64.dmg` |

### First launch

The app isn't code-signed yet, so your OS will warn you the first time:

- **Windows** — "Windows protected your PC" → **More info** → **Run anyway**.
- **macOS** — right-click the app → **Open** → **Open**. If that doesn't work,
  System Settings → Privacy & Security → **Open Anyway**, or run
  `xattr -dr com.apple.quarantine /Applications/CraftPanel.app`.

You'll also need **Java** installed to actually run a server (Temurin 17 or 21).

---

## How it works

CraftPanel is a single native app — there's no background service, no Docker, no account.
It launches the Minecraft server as a normal process on your machine and talks to it over
RCON and its console. Your worlds and files stay on your disk; the only things that leave
your computer are the version downloads (from Mojang / PaperMC / Modrinth), the optional
tunnel traffic, and — if you turn on world sync — your world going to *your* Cloudflare
storage.

Built with [Tauri](https://tauri.app) (Rust) and React. Game-specific logic lives behind a
single adapter, so other games can be added later.

---

## Status

CraftPanel is under active development. The core — create, run, configure, mod, back up,
expose, cross-play — works today. Some pieces are still maturing:

- Installers aren't signed/notarised yet (see *First launch* above).
- World sync needs a one-time Cloudflare R2 token and hasn't been battle-tested.
- The full Minecraft 1.21.9+ management API and a Bedrock *server* mode are planned.

See [ROADMAP.md](ROADMAP.md) for the whole picture.

---

## Building from source

```bash
npm install
npm run tauri dev          # run the app
npm run tauri build        # produce an installer for your platform

cd src-tauri && cargo test # backend tests
npm run build              # typecheck + bundle the frontend
```

Requires Node 20+ and a stable Rust toolchain. Pushing a `v*` tag builds signed-off
installers for macOS and Windows via GitHub Actions.

---

## Ownership & Rights

**CraftPanel is developed and owned by [kiqa-dev.it](https://kiqa-dev.it).**

This application and all associated code are the exclusive property of kiqa-dev.it. The design, implementation, and intellectual property rights are held by kiqa-dev.it.

**This project has no association with other kiqa-dev.it co-founded companies**, including:
- [Traversar](https://traversar-liart.
  vercel.app)
- [SpinD](https://spindare.it)

---

## License

TBD.
