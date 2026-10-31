# ccwraper

Desktop GUI wrapper for Claude Code (Electron + TypeScript + React, Agent SDK).
See [SPEC.md](SPEC.md) for the plan.

## Run

```
npm install
node node_modules/electron/install.js   # only if node_modules/electron/dist is missing
npm run dev                             # electron-vite dev (HMR)
npm run build && npx electron .         # run the built app
npm run typecheck && npm test           # checks (no live API calls)
npm run smoke                           # CDP smoke of the built app: every view + terminal, screenshots (no model calls unless CCWRAP_SMOKE_LIVE=1)
npm run spike                           # headless live SDK check, spends API budget (see docs/P0-FINDINGS.md)
```

- `#/design` renders the design system page, `#/debug` the raw event log.
- Add `--remote-debugging-port=9222` to `electron .` to drive the app over CDP (this is how P1 was verified, see `docs/P1-FINDINGS.md`).
- Sessions load the user, project and local Claude settings; a fresh session costs about $0.08 to $0.13 in cache creation.

## Sandboxed runs (P2)

- Launch with a scratch config so editors can write safely: `CLAUDE_CONFIG_DIR=D:\claude-tmp\p2-cfg npx electron . --user-data-dir=D:\claude-tmp\p2-ud --remote-debugging-port=9333`. Do not redirect `USERPROFILE` / `HOME` for the Electron process itself (it crashes); a sandboxed config has no login, so live chat needs the real config.
- `scripts/cdp-smoke.ts` / `scripts/cdp-client.ts` launch the built app, visit Settings / MCP / Memory, open the terminal and save PNGs to `D:\claude-tmp\p2-shots` (`CCWRAP_SMOKE_*` env vars override paths, see the file header). They never send messages or save anything.
- Config backups are written under `<userData>/backups/` (last 5 per file).

## Live checks (P3)

- Sandbox for the skills / commands / agents / hooks editors: `CLAUDE_CONFIG_DIR=D:\claude-tmp\p3-cfg npx electron . --user-data-dir=D:\claude-tmp\p3-ud --remote-debugging-port=9444`. Deleted items go to `<userData>\trash` (the delete dialog shows the path). Never start a chat in a sandbox that has a saved hook; hooks are real code (ccwraper itself never runs them).
- `npm run smoke` also visits Skills, Commands, Agents, Hooks (scopes and Effective view) and the lazy JSON editor. `CCWRAP_SMOKE_LIVE=1 npm run smoke` adds one cheap haiku subagent turn (needs the login in the real config, costs about $0.02). Findings: `docs/P3-FINDINGS.md`.

## Packaging (P4)

- `npm run dist:dir` builds the unpacked app to `dist\win-unpacked\ccwraper.exe`; `npm run dist:win` also builds the NSIS installer `dist\ccwraper Setup <version>.exe` (per-user, no admin, user data survives an uninstall). Both pass `--publish never`; `dist\` is git-ignored. Config: `electron-builder.yml`.
- The installer is unsigned (SmartScreen will warn) and there is no auto-update yet. Never run the installer on a dev machine you care about; test the unpacked build instead.
- `node-pty` and the SDK's `claude.exe` are `asarUnpack`ed; `paths.ts` maps `app.asar` to `app.asar.unpacked` so the bundled CLI always spawns from disk. `npm run icon` regenerates `build\icon.png` (runs under Electron).
- `npx tsx scripts/check-main-deps.ts` (after `npm run build`) asserts the main bundle only requires declared dependencies or Node builtins.
- `npx tsx scripts/pkg-smoke.ts` launches the unpacked app (sandbox `CLAUDE_CONFIG_DIR`, `--user-data-dir` under `D:\claude-tmp`) and checks fonts and CSP from `file://`, `app.info`, pwsh and Git Bash with `OpenConsole.exe` running from `app.asar.unpacked`, no DevTools or reload shortcuts, and single instance. `CCWRAP_PKG_LIVE=1` instead runs one haiku turn against the real config to prove the bundled `claude.exe` spawns from `app.asar.unpacked` (about $0.01).

## Auto-resume (P4)

- When a plan limit (for example the 5-hour limit) stops a session, the tab shows a countdown and, if "Auto-resume after usage limit" is on in Preferences (off by default), sends the continuation message once the limit resets (plus a 15 s margin). **Auto-resume only works while ccwraper is running**: closing the app, or a sleeping or powered-off machine, cancels nothing but sends nothing either. A pause that was pending when the app was closed is restored on the next start and resumes at once if its reset time has passed. It never approves permission requests, and at most 3 automatic resumes per session per hour are sent. The app keeps the PC awake while a pause is pending.
- `npm run smoke` also covers Usage, Git, Preferences, the command palette and opening and closing a tab. `CCWRAP_SMOKE_EXE=dist\win-unpacked\ccwraper.exe npm run smoke` runs the same checks against the packaged app.

## CI and releases (GitHub Actions)

- **CI** (`.github/workflows/ci.yml`): every push to `main` and every pull request runs typecheck, tests, build and the main-bundle dependency check on `windows-latest` (Node 26). Pushes to `main` also build the unpacked app (`npm run dist:dir`) to catch packaging breakage. Nothing is published by CI.
- **Release** (`.github/workflows/release.yml`) builds the NSIS installer and publishes a GitHub release with `ccwraper-Setup-<version>.exe` and a `.sha256` file, using generated release notes. A version with a `-` (for example `1.0.0-rc.1`) is published as a pre-release. It refuses to overwrite an existing release and re-runs typecheck, tests and the dependency check first. Two ways to start it:
  1. **Tag push:** `npm version minor` (or `patch`, `major`, `1.0.0`), then `git push --follow-tags`. The tag must equal `v<package.json version>`.
  2. **Manual:** Actions, Release, Run workflow, from `main`, choose a bump. The workflow bumps `package.json`, commits `chore(release): x.y.z`, tags, pushes, then builds and publishes. If the build fails after the push, delete the tag (`git push origin :refs/tags/vX.Y.Z`) and fix forward; the version commit stays.
- The installer is **unsigned**, so Windows SmartScreen warns on first run. It bundles Anthropic's `claude.exe` from the Agent SDK (about 300 MB): check the SDK's license terms before making the repository or its releases public.
- Auto-update is not implemented: users download new releases manually.
