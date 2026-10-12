# Space Bench — notes for Claude

Desktop electronics workbench: Tauri 2 (Rust shell in `apps/desktop/src-tauri`) + React/TypeScript UI
(`apps/desktop/src`), ngspice simulation, the Kirk circuit language, PCB, microcontroller emulation.
Display name **Space Bench** (repo/package names still say spicebench).

## Repositories and branches
- **Dev repo (private history):** `github.com/techkush/space-bench` (public visibility, contains plans/history).
  Work happens in the worktree `.claude/worktrees/more-boards`.
- **Public open-source repo:** `github.com/techkush/spacebench` — MIT, clean history, no planning files.
- Branch chain (each builds on the previous, none merged to `main` yet):
  `more-boards` → `live-code` (live pin badges in the code while running) → `kirk-kicad`
  (Kirk `for` / properties / `parts()` / `check`, KiCad `.kicad_sch` import/export) → `open-source`
  (LICENSE, THIRD_PARTY_NOTICES, README with GIFs, CONTRIBUTING/SECURITY/CoC). `open-source` is the latest.
- Never push to `main`; risky features go on a new branch so they can be reverted.

## Syncing the public repo
The public repo is a copy of the `open-source` branch **without** `plan-02.md`, `plan-03.md`,
`docs/engine-spec.md` (and without this file). Copy changed files into a clone of `techkush/spacebench`,
commit, push to its `main`. Don't publish internal references (Figma, plans, engine-spec).

## Commands
```sh
pnpm install
pnpm dev                                   # desktop app (tauri dev) + UI at http://localhost:5173
cd apps/desktop && npx vite --port 5173    # UI only (the dev server stands in for ngspice/arduino-cli)
cd apps/desktop && npx tsc -p tsconfig.app.json --noEmit
cd apps/desktop && npx vitest run          # ~375 tests; ESP32 bridge + Pi LED tests can flake under load
cargo test -p sb-engine
```
Desktop app from the worktree:
`PATH="$HOME/.cargo/bin:$PATH" CARGO_TARGET_DIR=<repo>/target npx tauri dev` (in `apps/desktop`).

## Conventions
- The user tests in the desktop app; light theme for screenshots/videos.
- Installs (in-app or tooling) ask permission first.
- Third-party code only from permissive licences; record it in `THIRD_PARTY_NOTICES.md` and the in-app
  About list (`SettingsView.tsx` `LICENSES`). KiCad symbols in `apps/desktop/public/kicad` stay CC-BY-SA 4.0.
- Kirk changes: parser + compiler + generator + `docs/kirk-language-spec.md` together; the README's Kirk
  example is compiled by `src/kirk/readme.test.ts`.

## Known follow-ups
- App bundle icons (`src-tauri/icons`) are still Tauri's default placeholder — replace with the Space Bench mark
  (black rounded square, white lightning bolt).
- No CI / installers yet; Linux and Windows builds untested (macOS-only paths in `linux.rs`, `esp32.rs`,
  `renode.rs` use `~/Library/Application Support`).
- Consider making the old `techkush/space-bench` repo private (it has plan files).

## Promo media
- README GIFs: `docs/media/*.gif` (frames from the browser, assembled with ffmpeg).
- 56 s promo video: `~/Movies/SpaceBench/spacebench-promo-60s.mp4`, recorded with a headless Chrome driven
  over the DevTools protocol (Node, no extra packages) — screencast frames → ffmpeg, real time, 1920×1080.
