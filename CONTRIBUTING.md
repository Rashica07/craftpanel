# Contributing to CraftPanel

Thanks for your interest in CraftPanel! Here's how to get involved:

## Bug Reports

Found a bug? Please open an [issue](../../issues) with:
- What you were doing when it broke
- What happened vs. what you expected
- Your OS, CraftPanel version, and any relevant logs (see **Logs** below)
- Steps to reproduce it

## Feature Requests

Have an idea? Open an [issue](../../issues) with the label `enhancement` and describe:
- What you want to do
- Why it matters to you
- How you'd use it

See [ROADMAP.md](ROADMAP.md) for what's already planned.

## Code Contributions

CraftPanel is built with **Rust** (backend) and **React + TypeScript** (frontend), using **Tauri** to ship as a native desktop app.

### Setup

```bash
# Install dependencies
npm install

# Run in dev mode (hot reload)
npm run tauri dev

# Run tests
cd src-tauri && cargo test
npm run build  # typecheck frontend
```

Requires **Node 20+** and a **stable Rust toolchain**.

### Making Changes

1. Fork the repo
2. Create a feature branch (`git checkout -b my-feature`)
3. Make your changes
4. Run tests: `cargo test` (backend) + `npm run build` (frontend)
5. Commit with a clear message
6. Push and open a pull request

### Code Style

- **Rust:** Follow `cargo fmt` (auto-format with `cargo fmt`)
- **TypeScript/React:** Follow the existing patterns in `src/` (ESLint/Prettier config included)
- **Commit messages:** Clear, lowercase, imperative mood ("add feature" not "added feature")

## Logs & Debugging

CraftPanel stores logs and config in:
- **macOS:** `~/Library/Application Support/com.craftpanel.app/`
- **Windows:** `%APPDATA%\com.craftpanel.app\`

Attach `app.log` or relevant files when reporting bugs.

## Questions?

Open a [discussion](../../discussions) or drop an issue — no such thing as a dumb question.

Thanks for helping make CraftPanel better! 🎮
