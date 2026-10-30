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
