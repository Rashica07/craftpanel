<div align="center">

# OMNIServers

**Run your own Minecraft server — without the config files, the terminal, or the port-forwarding headache.**

A desktop app for macOS, Windows, and Linux that creates, runs, and shares game servers.
Pick a version, press Start, send your friends a link. That's it.

[Download](#download) · [Features](#what-it-does) · [Roadmap](ROADMAP.md)

</div>

---

## What it does

**Create a server in under a minute.**
Choose Vanilla, Paper, Fabric, Forge or NeoForge and a Minecraft version — OMNIServers
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
Share a world with a friend using a private code. OMNIServers moves the world to your own
Cloudflare R2 storage on stop and pulls the latest on start — whoever's playing holds the
lock so you never overwrite each other.

---

## Download

The latest release is **3.1.1**. Download platform builds from the release pages:

| Platform | Latest build |
| --- | --- |
| **Windows 10 / 11** | [OMNIServers for Windows 3.1.1](https://github.com/Rashica07/craftpanel/releases/tag/windows-v3.1.1) |
| **macOS (Apple Silicon)** | [OMNIServers-3.1.1-AppleSilicon.dmg](https://github.com/Rashica07/craftpanel/releases/download/swift-v3.1.1/OMNIServers-3.1.1-AppleSilicon.dmg) |
| **macOS (Intel)** | [OMNIServers-3.1.1-Intel.dmg](https://github.com/Rashica07/craftpanel/releases/download/swift-v3.1.1/OMNIServers-3.1.1-Intel.dmg) |
| **Linux (x64 / ARM64)** | [OMNIServers for Linux 3.1.1](https://github.com/Rashica07/craftpanel/releases/tag/linux-v3.1.1) |

### First launch

Platform builds have different signing status, so your OS may warn you the first time:

- **Windows** — the 3.1.1 build is unsigned; choose **More info** → **Run anyway** if SmartScreen appears.
- **macOS** — the 3.1.1 DMGs are Apple Development signed but not notarized; right-click the app → **Open**. If needed, use System Settings → Privacy & Security → **Open Anyway**.
- **Linux** — the 3.1.1 build is a test build; follow your desktop environment's normal application and firewall prompts.

You'll also need **Java** installed to actually run a server (Temurin 17 or 21).

---

## How it works

OMNIServers is a single native app — there's no background service, no Docker, no account.
It launches the Minecraft server as a normal process on your machine and talks to it over
RCON and its console. Your worlds and files stay on your disk; the only things that leave
your computer are the version downloads (from Mojang / PaperMC / Modrinth), the optional
tunnel traffic, and — if you turn on world sync — your world going to *your* Cloudflare
storage.

The current release includes native Swift support on macOS and Avalonia-based builds on
Windows and Linux. Game-specific logic is shared behind a single adapter, so other games
can be added later.

---

## Status

OMNIServers is under active development. The core — create, run, configure, mod, back up,
expose, cross-play — works today. Some pieces are still maturing:

- FiveM and Terraria servers can be detected, added, and started alongside Minecraft servers.
- Java servers can receive a free tunnel address automatically, while local Join remains available.
- Windows and Linux 3.1.1 artifacts are test/unsigned builds; FiveM still requires your own licence key.
- World sync needs a one-time Cloudflare R2 token and hasn't been battle-tested.
- Android local Minecraft/Paper hosting is not currently supported.

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

Requires Node 20+ and a stable Rust toolchain. Release tags build platform artifacts via GitHub Actions; signing and notarization vary by
platform and release.

---

## Ownership & Rights

**OMNIServers is developed and owned by [kiqa-dev.it](https://kiqa-dev.it).**

This application and all associated code are the exclusive property of kiqa-dev.it. The design, implementation, and intellectual property rights are held by kiqa-dev.it.

**This project has no association with other kiqa-dev.it co-founded companies**, including:
- [Traversar](https://traversar-liart.vercel.app)
- [SpinD](https://spindare.it)

---

## License

TBD.
