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
npm run spike                           # headless live SDK check, spends API budget (see docs/P0-FINDINGS.md)
```

- `#/design` renders the design system page, `#/debug` the raw event log.
- Add `--remote-debugging-port=9222` to `electron .` to drive the app over CDP (this is how P1 was verified, see `docs/P1-FINDINGS.md`).
- Sessions load the user, project and local Claude settings; a fresh session costs about $0.08 to $0.13 in cache creation.
