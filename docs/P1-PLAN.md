# P1 Plan (MVP)

Date: 2026-10-30. Inputs: `SPEC.md` (v0.1), `docs/P0-FINDINGS.md`, `docs/design/README.md`, `docs/design/tokens.css`, current `src/`.
P1 scope (SPEC section 8): design tokens, base components, `/design` page; chat UI (markdown, tool cards, diff, thinking collapse); permission dialog; project picker; session list and resume; interrupt; cost meter; test setup (vitest, fixtures).

Out of P1 (deferred on purpose): command palette, inspector panel, terminal, settings/MCP/CLAUDE.md editors (P2); multi-tab (P4, title bar shows one tab only); sqlite (no P1 feature needs it); history rename/delete; lint tooling.

---

## 1. Decisions

### D1. Claude binary: user's installed `claude`, bundled fallback, with a version check
Keep the `resolveClaudeExecutable()` order (`CCWRAP_CLAUDE_PATH` > `where.exe claude` (.exe only) > `~/.local/bin/claude.exe`). Add one rule: run `<path> --version` once at startup (execFile, 5s timeout, cached). If the version is older than the SDK's bundled CLI (`node_modules/@anthropic-ai/claude-agent-sdk/manifest.json` `version`, currently 2.1.312), use the bundled binary instead and log why. The env override always wins.
Why: the user's binary picks up their auto-updates, and P4 packaging gets easier because we don't have to spawn from inside an asar. An older user binary can lack control-protocol features the 0.3.312 SDK sends, so it falls back. Today both report 2.1.312. Main exposes `{path, version, source: 'env'|'user'|'bundled'}` through `app:info` for the status bar and error messages.

### D2. Keep TypeScript 7.0.2 + Vite 8.3.5. Do not pin back.
Checked on npm (2026-10-30):
- vitest 5.0.5: peer `vite ^6.4 || ^7 || ^8`, engines include Node >=26 (system Node is 26.2). OK.
- electron-vite 6.0.0: peer `vite ^6 || ^7 || ^8`. OK (already building).
- tailwindcss / @tailwindcss/vite 4.3.3: already working on Vite 8.
- monaco-editor 0.57 / @monaco-editor/react 4.7 (P2): no dependency on the TS compiler, React 19 peer. OK.
- electron-builder 26.18 (P4): does not use TS. OK.
- radix-ui 1.8, sonner 2, cmdk 1.1, motion 14, lucide-react, react-markdown 10: all peer React 19. OK.
- **Breaks with TS7:** `typescript-eslint` (peer `typescript >=4.8.4 <6.1.0`). So no typescript-eslint. If we add lint later, use `oxlint` (+ `oxlint-tsgolint` >=7.0.2005 for type-aware rules).
- **shadcn CLI:** risky with TS7 because `baseUrl` was removed and the CLI resolves aliases from tsconfig. Decision: don't depend on the CLI. Write shadcn-pattern components by hand (Radix + `class-variance-authority` + `tailwind-merge`), styled from our tokens. That keeps SPEC's shadcn intent (copy-in components), and we restyle everything anyway.

Why keep: it builds, typechecks and runs today. Every P1/P2 piece we need supports it except typescript-eslint, which we don't need. Pinning back costs churn for no gain. Pin-back trigger: a confirmed Vite 8 blocker means drop to Vite 7 (electron-vite and vitest accept it); a TS7-specific blocker means TS 6.0.x. The lead decides; agents report and don't downgrade on their own.

### D3. `node:sqlite` instead of better-sqlite3, and no DB in P1
Verified here: Electron 45.1.0 embeds **Node 24.22.1 (ABI 150), SQLite 3.53.4**. `require('node:sqlite').DatabaseSync` opened an in-memory DB and ran DDL under `ELECTRON_RUN_AS_NODE` with no flag and no warning printed. better-sqlite3 13.0.3 does ship N-API prebuilds (`prebuilds/win32-x64.node`, `win32-arm64.node`, so no compile), but it is still a native module. That means `asarUnpack`, an electron-builder native step, and test-runner (Node 26) vs Electron (Node 24) loading concerns. For "pins, tags, tab layout" metadata, `node:sqlite` has zero packaging cost.
P1 has no feature that needs a DB. The project list comes from session history, and the last-opened project is renderer `localStorage`. When the DB lands (P2+), put it behind `src/main/db/` with a tiny interface so we can swap to better-sqlite3 if the `node:sqlite` API changes (not yet stable in Node 24). SPEC section 1 "Local DB" is amended to `node:sqlite`.

### D4. Design README vs SPEC
| Item | Verdict |
|---|---|
| `--text-tertiary #82828F` (not in SPEC) | **Accept.** SPEC's own quality bar asks for WCAG AA on text. SPEC muted `#62626F` fails AA (3.2:1), so readable meta text needs tertiary. Muted is only for placeholders, disabled and decoration. |
| Deeper filled-button pair `--accent-solid` `#7C3AED -> #2563EB` | **Accept**, same reason: white on the SPEC gradient fails AA (4.23 / 3.68). The SPEC gradient stays for borders, rings, caret, icons and the tab underline. |
| Tailwind mapping written as v3 `theme.extend` | **Superseded by Tailwind v4 syntax**: `@theme inline { --color-bg-0: var(--bg-0); ... }` in CSS. Same names and scale as the README (`bg-0..3`, `fg`, `fg-2`, `fg-3`, `fg-muted`, radii xs/sm/md/lg, font sizes 2xs..2xl, durations instant/fast/base/slow, easings out/spring). No hex values in components. |
| "Always allow writes `Bash(cmd:*)` to `.claude/settings.local.json`" vs SPEC "via ConfigService" | **Design wins on destination (localSettings). Mechanism changes:** return the SDK's `suggestions` as `updatedPermissions` with `destination: 'localSettings'`, so the CLI writes the rule itself. No ConfigService in P1, and we never hand-build rule strings. |
| Custom title bar, 46px window controls, close hover `#C42B1C` | **Accept, implemented natively**: `titleBarStyle: 'hidden'` + `titleBarOverlay {color:'#0A0A0C', symbolColor:'#9A9AA8', height:40}`. These are the native Windows caption buttons, so min/max/close need no IPC. |
| Window min 1024 x 640 | Accept. |
| Palette, inspector, terminal panel, tabs in the prototype | Kept in design scope, **not in P1** (see top). |
| Mica (`backgroundMaterial`) | Optional in SPEC; skip in P1. |

`docs/design/tokens.css` stays the source of truth. The renderer gets a byte-identical copy, and a test enforces that (WP3).

### D5. P0 TODOs folded into P1
| TODO | Resolution | WP |
|---|---|---|
| cwd existence check | `SessionManager.start` does `fs.stat` and requires `isDirectory()` before `startSdkSession`, throwing `Working directory not found: <cwd>`. This replaces the misleading SDK "failed to launch ... libc" error. The project picker flags `exists:false` dirs and disables starting or resuming in them. | WP1, WP2, WP7 |
| `init` is replace, not append | The renderer reducer treats `init` as idempotent: replace meta (model, tools, mcp, slashCommands, permissionMode, sessionId) and never add a chat item. Unit test with two different inits in one turn. | WP4 |
| `remember` scope | `once`: allow with no `updatedPermissions`. `session`: SDK `suggestions` with `destination` rewritten to `'session'`. `always`: suggestions with `destination: 'localSettings'`. The adapter keeps the suggestions per `reqId` (SDK types stay in the adapter) and emits a plain `ruleLabel` (for example `Bash(npm test:*)`) so the dialog shows what "Always allow" writes. No suggestions means `ruleLabel` is undefined and "Always allow" is disabled. P1 UI has Deny / Always allow / Allow once (per design). `session` works in main but has no button yet. | WP0, WP1, WP6 |
| `thinking_delta` unverified | Real transcripts in `~/.claude/projects` DO contain `thinking` blocks, so the final-block path is covered by fixtures. The renderer renders thinking from either deltas or the final `assistant_message` block (reducer handles both). WP1 adds `SPIKE_THINKING=1` to the spike (thinking-capable model, `thinking: {type:'adaptive', display:'summarized'}`) and records whether deltas arrive in `docs/P1-FINDINGS.md`. Don't force `thinking` in normal sessions (respect user settings). | WP1, WP4 |

### D6. Session history: use the SDK's history API, not a hand-written jsonl parser
SDK 0.3.312 exports `listSessions({dir?, limit, offset})`, `getSessionInfo`, `getSessionMessages(sessionId, {dir?})`, `renameSession`, `deleteSession`, `forkSession`. I ran them read-only against the real `~/.claude/projects`: 56 sessions listed in 61 ms, a 42-message transcript loaded in 11 ms. `SDKSessionInfo` has `summary`, `customTitle`, `firstPrompt`, `lastModified`, `createdAt`, `cwd`, `gitBranch`, `fileSize`. `SessionMessage.message` is Messages-API shaped (text / thinking / tool_use / tool_result), so it maps with the same logic as live messages. This is the "adapter over an unstable format" that SPEC section 9 asks for, maintained upstream.
**SPEC deviation:** SDK imports are allowed in **two** boundary files, `src/main/services/sdk-adapter.ts` (live) and `src/main/services/sdk-history.ts` (history). SDK types still never leave them.
Things to handle:
- cwd casing differs between sessions of one project (`D:\Development_Projects\ccwrap` vs `d:\...`, both present today). Group by a normalized key (Windows: lowercase drive letter, backslashes, no trailing separator, case-insensitive) and display the most recent original spelling.
- `listSessions({dir:'D:/Development_Projects/ccwrap'})` returned results; the backslash probe was inconclusive (shell quoting artifact). WP2 tests both forms, uses whichever works, and normalizes in `paths.ts`.
- Transcripts include meta user turns (system reminders, `<command-name>` / `<local-command-stdout>` wrappers). Map them tolerantly: skip, or show a compact "command" line. Never crash on unknown blocks.
- Cost on resume: `total_cost_usd` is cumulative per `query()`, and a resumed query *continues from the transcript's saved total*. The cost meter shows the **latest** `result.costUsd`. Never sum results.

### D7. Cross-cutting rules for all agents
- **Lockfile has one writer.** WP0 installs every P1 dependency. No other WP edits `package.json` / `package-lock.json` or runs `npm install`; a missing dep is reported to the lead.
- **Contracts freeze after WP0.** `src/shared/**`, `src/preload/**`, tsconfigs and `vitest.config.ts` change only through the lead.
- The sandboxed preload can only bundle `src/shared/channels.ts` (zod-free). New channel names go there, never into a zod-importing module.
- CSP (`src/renderer/index.html`) stays `script-src 'self'`. Shiki must use its **JavaScript regex engine** (`createJavaScriptRegexEngine`), not WASM oniguruma (that would need `wasm-unsafe-eval`). Lazy-load it with a fixed language subset. Fonts come from `@fontsource-variable/geist` / `geist-mono` (self-hosted); add `font-src 'self'`.
- Live SDK runs cost money (about $0.13 per first turn with user settings). Only WP1 and WP9 run live checks, with `settingSources: []` unless they are testing settings. Unit tests never spawn the CLI.
- Never commit real transcripts. Fixtures are synthetic or hand-sanitized (no real prompts, paths like `C:\fixture\proj`).
- P0 quirk: if `node_modules/electron/dist` is missing, run `node node_modules/electron/install.js`.
- Every WP verifies with `npm run typecheck`, `npm test`, `npm run build`. UI WPs add Testing Library component tests (agents can't eyeball the app). Visual checks go into the WP9 manual checklist.

---

## 2. Work packages

Waves: **W0** WP0 alone -> **W1** WP1, WP2, WP3, WP4 in parallel -> **W2** WP5, WP6, WP7 in parallel -> **W3** WP8 in parallel with WP9 (WP9 finishes last).

| WP | Title | Wave | Depends on |
|---|---|---|---|
| WP0 | Foundation: deps, test harness, contracts, skeletons | W0 | - |
| WP1 | Main: session hardening (binary, cwd, permissions, window) | W1 | WP0 |
| WP2 | Main: HistoryService (SDK history API) | W1 | WP0 |
| WP3 | Design system: tokens, theme, fonts, UI primitives | W1 | WP0 |
| WP4 | Chat model: reducer, stores, IPC bridge | W1 | WP0 |
| WP5 | Chat stream UI: list, markdown, thinking, composer, interrupt | W2 | WP3, WP4 |
| WP6 | Tool cards, diff view, permission dialog | W2 | WP3, WP4 |
| WP7 | App shell: title bar, rail (project picker, sessions), status bar + cost meter | W2 | WP3, WP4 (real data from WP2; builds against the WP0 stubs) |
| WP8 | `/design` page | W3 | WP3, WP5, WP6 |
| WP9 | Integration, live verification, findings | W3 | all |

### WP0. Foundation (serial, first)
**Owns:** `package.json`, `package-lock.json`, `vitest.config.ts` (new), `tsconfig*.json`, `src/shared/**`, `src/preload/**`, `src/main/index.ts` (only the switch to `registerIpc`), `src/main/ipc/{index,session,history,app}.ts` (new), `src/main/paths.ts` (adds `normalizeCwdKey` only), `src/renderer/index.html` (CSP font-src), `src/renderer/app/App.tsx`, `src/renderer/features/debug/RawLogPage.tsx`, the placeholders in step 7, `tests/fixtures/README.md`, `src/main/services/sdk-adapter.test.ts`.
**Do:**
1. One install. Runtime: `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, `motion`, `sonner`, `@fontsource-variable/geist`, `@fontsource-variable/geist-mono`, `react-markdown`, `remark-gfm`, `shiki`, `diff`, `@tanstack/react-query`, `@tanstack/react-virtual`. Dev: `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/dom`, `@testing-library/user-event` (+ `@types/diff` only if `diff` 9 lacks types). Exact versions, as the repo pins today.
2. `vitest.config.ts` with `test.projects`: `node` (`src/main/**`, `src/shared/**`, env node) and `web` (`src/renderer/**`, env jsdom, `@vitejs/plugin-react`). Same `@shared` / `@` aliases as `electron.vite.config.ts`. Scripts `test` = `vitest run`, `test:watch`. Tests are colocated `*.test.ts(x)` and import from `vitest` explicitly (no globals; `tsconfig.web.json` has `types: []`). Add `vitest.config.ts` and `tests/**` to `tsconfig.node.json` include.
3. `src/shared/events.ts` contract:
   - add `{ t: 'user_message'; text: string; uuid?: string }` (history replay; live prompts are added optimistically by the renderer)
   - `permission_request` adds `ruleLabel?: string`
   - `result` adds `contextWindow?: number`
   - export `ProjectInfo { key; cwd; exists; sessionCount; lastModified }`, `HistorySessionInfo { sessionId; title; firstPrompt?; cwd; gitBranch?; lastModified; createdAt?; fileSize? }`, `AppInfo { claudePath?; claudeVersion?; claudeSource: 'env'|'user'|'bundled'; sdkVersion; platform }`
4. `channels.ts` + `ipc.ts`: `history:listProjects`, `history:list {cwd}`, `history:load {sessionId, cwd?}` -> `SessionEvent[]`, `app:info`. Add Zod schemas, extend `CcwrapApi` (`history.*`, `app.info()`), wire in `src/preload/index.ts`. `permissionReply` already carries `remember`.
5. Move the IPC handlers from `src/main/index.ts` into `src/main/ipc/session.ts` (verbatim). Add `src/main/ipc/index.ts#registerIpc(deps)`, stub `ipc/history.ts` (empty results) and stub `ipc/app.ts` (minimal AppInfo), so the renderer works before WP1/WP2 merge.
6. `paths.ts`: add `normalizeCwdKey(p)` (resolve, strip trailing separator; on Windows lowercase the whole key for comparison).
7. Renderer skeleton: `App.tsx` becomes a hash router (`#/design` -> `DesignPage`, `#/debug` -> `RawLogPage`, default -> `AppShell`). Move the P0 raw-log App to `features/debug/RawLogPage.tsx`; it keeps `stores/session-store.ts` as a dev tool. Placeholders with **frozen props**:
   - `src/renderer/app/shell/AppShell.tsx`: `AppShell()`
   - `src/renderer/app/design/DesignPage.tsx`: `DesignPage()`
   - `src/renderer/features/chat/ChatView.tsx`: `ChatView({ target }: { target: ChatTarget })`
   - `src/renderer/features/chat/tools/ToolCard.tsx`: `ToolCard({ convId, toolUseId }: { convId: string; toolUseId: string })`
   - `src/renderer/features/chat/permission/PermissionDialog.tsx`: `PermissionDialog({ convId }: { convId: string })`
   - `src/renderer/features/chat/model/types.ts`: `ChatTarget = { convId: string; cwd: string; localId?: string; resumeSessionId?: string }` (WP4 owns and extends it afterwards)
8. First test, `src/main/services/sdk-adapter.test.ts`: `mapMessage` on hand-written init / stream_event / assistant / user tool_result / result messages (WP1 owns it afterwards).
**Accept:** `npm run typecheck`, `npm test` (at least one passing test in each vitest project) and `npm run build` are green; `npm run dev` shows the placeholder shell; `#/debug` still runs a live session as in P0.

### WP1. Main: session hardening
**Owns:** `src/main/index.ts`, `src/main/paths.ts`, `src/main/services/sdk-adapter.ts` (+test), `src/main/services/session-manager.ts` (+ new test), `src/main/ipc/session.ts`, `src/main/ipc/app.ts`, `scripts/spike.ts`, `tests/fixtures/sdk/**`.
**Do:**
1. D1 binary selection: the resolver returns `{path?, version?, source}`. It parses the `x.y.z` prefix of `--version`, compares it with the SDK `manifest.json` version (pure, tested compare function), and caches the result. `ipc/app.ts` returns a real `AppInfo` (sdkVersion read from the SDK package.json via fs, no SDK import).
2. cwd check in `SessionManager.start` (D5).
3. Permissions (D5): `canUseTool` stores `{resolve, suggestions}` per reqId and emits `ruleLabel` (`toolName(ruleContent)` of the first `addRules` suggestion, or just `toolName` without ruleContent). `replyPermission(reqId, decision, remember, updatedInput)` builds `updatedPermissions`. `SessionManager.permissionReply` passes `remember` through.
4. `result` mapping sets `contextWindow` from `m.modelUsage` (the entry for the init model, else the max).
5. Interrupt: keep the P0 idle mapping, make `interrupt()` a safe no-op when idle, and release pending permission promises on interrupt (deny, `interrupt: true`).
6. Window (D4): `minWidth 1024`, `minHeight 640`, `titleBarStyle: 'hidden'`, `titleBarOverlay {color:'#0A0A0C', symbolColor:'#9A9AA8', height:40}`. External links open via `shell.openExternal`; in-app `window.open` is denied (`setWindowOpenHandler`).
7. Spike: `SPIKE_THINKING=1` path (D5); optional `SPIKE_RECORD=<dir>` dumps raw SDK messages to build sanitized fixtures.
8. Make the SDK `query` injectable (optional `queryImpl` in `AdapterOptions`) so unit tests use a fake `Query`. Tests: ruleLabel emitted; `always` -> `updatedPermissions` with `destination:'localSettings'`; `session` -> `'session'`; `once` -> none; deny; interrupted turn -> `idle` not `error`; missing cwd -> friendly error; version compare.
**Accept:** tests, typecheck and build green. One live `SPIKE_SKIP_123=1 npm run spike` run still passes permission + interrupt. One live "always" reply on a Write adds a rule to `D:\claude-tmp\spike-cwd\.claude\settings.local.json` (inspect it, then delete the file).

### WP2. Main: HistoryService
**Owns:** `src/main/services/sdk-history.ts` (+test), `src/main/services/history-service.ts` (+test), `src/main/ipc/history.ts`, `tests/fixtures/history/**`.
**Do:**
1. `sdk-history.ts` (second SDK boundary file, D6): wrap `listSessions` and `getSessionMessages` via dynamic `import()` (CJS main bundle, same pattern as the adapter). Export `mapHistoryMessage(m): SessionEvent[]`. It reuses `mapMessage` from `sdk-adapter.ts` for assistant / tool_result content (import only; signature unchanged), emits `user_message` for real prompts, and skips or compacts meta wrappers.
2. `history-service.ts`: `listProjects()` groups all sessions by `normalizeCwdKey(cwd)`, sets `exists` via `fs.existsSync`, sorts by lastModified desc. `list(cwd)` uses `listSessions({dir})` (test both slash forms; fall back to filtering `listSessions()` by key). `title = customTitle ?? summary ?? firstPrompt`. `load(sessionId, cwd?)` returns `SessionEvent[]`.
3. Inject the SDK functions so tests run on fixtures: `tests/fixtures/history/*.json` with synthetic `SDKSessionInfo[]` / `SessionMessage[]`, covering thinking, tool_use + tool_result pairs, an Edit with old/new strings, a meta command turn, an unknown block type, and mixed-case cwds.
**Accept:** tests cover case-variant grouping, a missing cwd producing `exists:false`, mapping order and tool pairing, unknown blocks ignored, meta turns not rendered as user prompts. Read-only manual check from `#/debug` or a one-off: `history:listProjects` returns the real projects.

### WP3. Design system
**Owns:** `src/renderer/styles.css`, `src/renderer/styles/**` (new: `tokens.css` copy, `theme.css`, `base.css`), `src/renderer/components/ui/**`, `src/renderer/lib/cn.ts`, `src/renderer/lib/motion.ts`, `src/renderer/main.tsx` (font imports and `<Toaster>` only), plus the class-name rename in `features/debug/RawLogPage.tsx`.
**Do:**
1. `styles/tokens.css` is a byte-identical copy of `docs/design/tokens.css`. `theme.css` maps tokens with Tailwind v4 `@theme inline` (D4). `base.css` covers body font/size, thin scrollbars, `::selection`, the `:focus-visible` ring, the noise overlay and `prefers-reduced-motion`. Delete the P0 `--text/--text-2/--text-3` vars.
2. Components (Radix + cva, shadcn pattern, from the README "Components and states" table): `Button` (primary/secondary/ghost/danger, sizes 30/24, icon 28/24), `Input`, `Textarea`, `Chip` (neutral/selected/ok/warn/danger/running), `StatusPill` (run/done/err with glyph crossfade and one shake), `Toggle`, `Kbd`, `Spinner`, `Tooltip`, `Dialog` (glass, 55% scrim, scale 0.96 + 6px blur entry), `Toaster` (sonner themed: glass-strong, 340 wide, max 3). `lib/motion.ts` exports the spring `{type:'spring', stiffness:500, damping:32}` and the duration constants.
3. Tests: `styles/tokens.test.ts` (copy equals source); a no-hex guard (scan `components/**` and `features/**` for `#[0-9a-fA-F]{3,8}\b` and fail on any hit); component tests for variants, disabled, and StatusPill state changes.
**Accept:** tests green; every component works with the keyboard; the accent ring shows only on `:focus-visible`; reduced motion zeroes the duration vars.

### WP4. Chat model (pure, heavily tested)
**Owns:** `src/renderer/features/chat/model/**` (`types.ts`, `reducer.ts`, `selectors.ts`, tests), `src/renderer/stores/chat-store.ts`, `src/renderer/lib/ipc-bridge.ts`, `tests/fixtures/events/**`.
**Do:**
1. View model per conversation (`convId`): ordered items (`user`, `assistant` with text and thinking parts, `tool` refs, `error`); `tools: Record<toolUseId, ToolCallView>` (name, input, status `running|done|error|needs_approval`, result, startedAt/endedAt, parentToolUseId); a `pending` permission queue; `meta` from init (sessionId, model, tools, mcp, slashCommands, permissionMode, cwd); `status`; `lastResult` (cost, usage, contextWindow, durationMs).
2. `reduce(conv, event)` rules:
   - deltas append to the message keyed by msgId
   - `assistant_message` finalizes and replaces streamed text with the canonical blocks (no duplication)
   - thinking comes from deltas or final blocks
   - `init` replaces meta and never adds an item
   - `tool_result` attaches to its tool by id
   - `permission_request` queues; if it matches a running tool by name and input, that tool becomes `needs_approval`
   - `result` sets `lastResult` (latest wins, never summed, D6)
   - `error` becomes an inline error item; `user_message` becomes a user item
3. `chat-store.ts` (zustand): `convs`, a `localId -> convId` map, and actions:
   - `createConv(target)`, `seedFromHistory(convId, events)`, `bindLocalId`, `applyEvent(localId, e)`
   - `submit(convId, text)`: adds the user item optimistically, then `session.send` if bound, otherwise `session.start({cwd, prompt, resumeId})` and bind
   - `interrupt(convId)`, `replyPermission(convId, reqId, decision, remember)`, `setPermissionMode`
   - coalesce deltas so the store updates at most once per animation frame (60fps bar)
4. `ipc-bridge.ts`: subscribes to `window.ccwrap.session.onEvent` once and routes to `applyEvent`.
5. Event-sequence fixtures (`tests/fixtures/events/*.json`): text turn, tool turn with Edit, permission flow, interrupted turn, double init, history replay. WP5, WP6 and WP8 reuse them.
**Accept:** reducer tests for every rule, including "two inits -> no init items, latest meta", "deltas then assistant_message -> one text part", "resumed result cost not summed", "interrupted result -> status idle".

### WP5. Chat stream UI
**Owns:** `src/renderer/features/chat/ChatView.tsx`, `MessageList.tsx`, `UserMessage.tsx`, `AssistantMessage.tsx`, `Markdown.tsx`, `CodeBlock.tsx`, `StreamingText.tsx`, `ThinkingBlock.tsx`, `Composer.tsx` (+tests), `src/renderer/lib/highlight.ts`.
**Do:**
1. `MessageList`: `@tanstack/react-virtual` with dynamic `measureElement`. It sticks to the bottom while streaming unless the user scrolled up. Content max 760, side padding 24, gap 14. No layout animation inside the list; only newly appended items get a transform/opacity enter.
2. `Markdown`: react-markdown + remark-gfm. Code blocks go through `highlight.ts` (shiki JS engine, lazy, fixed language set, theme built from tokens). Links rely on WP1's `setWindowOpenHandler` / `openExternal`.
3. `StreamingText`: token fade-in (blur 2px -> 0, 240ms) and a gradient caret while streaming; respects reduced motion.
4. `ThinkingBlock`: collapsed by default, labelled "Thought for Ns", shimmer while active, opens with grid-rows 0fr -> 1fr (250ms).
5. `Composer`: textarea; Enter sends, Shift+Enter adds a newline.
   - Running state: conic sweep, send becomes stop, "Esc to interrupt" hint. A global `Esc` calls `interrupt(convId)` while running.
   - Mode chip calls `setPermissionMode` (cycles default / acceptEdits / plan). Model chip is display-only in P1.
   - Disabled when the target cwd doesn't exist.
6. `ChatView({target})` renders the list (with `ToolCard` by id from WP6), `PermissionDialog` (WP6) and the Composer.
**Accept:** component tests on WP4 fixtures: text turn renders; thinking is collapsed and expands on click; Esc while running calls interrupt; Enter submits. A 2,000-item synthetic conversation renders without errors and the DOM row count stays bounded (virtualization works).

### WP6. Tool cards, diff, permission dialog
**Owns:** `src/renderer/features/chat/tools/**`, `src/renderer/features/chat/diff/**`, `src/renderer/features/chat/permission/**` (+tests).
**Do:**
1. `ToolCard({convId, toolUseId})`:
   - 38px header: icon, name, mono arg with ellipsis, meta (duration or +/- counts), StatusPill. Collapsible body.
   - States: running, done, error (danger border, tinted body), needs approval. Enters with a 6px slide-up and fade.
   - Renderers: Bash (command + mono output), Read (path + range), Edit / MultiEdit (DiffView), Write (all-add DiffView of `content`), Grep/Glob (pattern + count), Generic (pretty JSON input + text result). Long output renders the first N lines plus "show more".
2. `diff/compute-diff.ts`: jsdiff `structuredPatch` from `old_string` / `new_string` into a unified row model with line numbers. `DiffView`: two 36px gutters, 18px sign column, 20px rows, add/del 9% tints, flashes once when the tool turns done.
3. `PermissionDialog({convId})`:
   - Shows the head of the pending queue (count badge if more), the title (`title ?? toolName`), and an input preview (Bash command, DiffView for Edit, JSON otherwise).
   - Buttons: Deny (ghost, Esc), Always allow (secondary, shows `ruleLabel`, disabled without one, success toast), Allow once (primary, autofocus, Enter).
   - Glass, 520 wide.
**Accept:**
- compute-diff unit tests: multi-hunk, CRLF content, empty old string, Write.
- Component tests: Enter allows once; Esc denies; Always allow sends `remember:'always'`; Always allow is disabled without ruleLabel; an error result shows the error state.

### WP7. App shell, project picker, session list, cost meter
**Owns:** `src/renderer/app/shell/**` (`AppShell.tsx`, `TitleBar.tsx`, `LeftRail.tsx`, `ProjectPicker.tsx`, `SessionList.tsx`, `StatusBar.tsx`, `CostMeter.tsx`), `src/renderer/stores/workspace-store.ts`, `src/renderer/lib/query-client.ts`, `src/renderer/features/sessions/**` (TanStack Query hooks).
**Do:**
1. Layout: 40px title bar (drag region; right side left clear for `titleBarOverlay`; one session tab with the accent underline), 232px left rail, chat column, 26px status bar. No inspector.
2. `ProjectPicker`: projects from `history:listProjects` plus "Open folder..." (`dialog:pickDirectory`). Missing dirs are greyed out with a tooltip. The selected cwd persists in `localStorage` (D3).
3. `SessionList`:
   - `history:list {cwd}`, two-line rows (title; relative time and branch), a "New session" button, 30ms stagger for at most 8 items.
   - Selecting a session calls `history:load`, then `seedFromHistory`, and shows it in `ChatView` with `resumeSessionId` set. The first send resumes.
   - Refetch on window focus and after each `result`.
4. `StatusBar`: model, mode, ctx % (`(input + cacheRead + cacheCreation) / contextWindow` from `lastResult`, hidden when unknown), `CostMeter` (latest `costUsd`, tick-up of at most 600ms, tabular numbers), cwd, and claude source/version from `app:info`.
**Accept:** component tests with a mocked `window.ccwrap`: the picker lists projects; a missing project is disabled; selecting a session calls `history:load` and renders ChatView with `resumeSessionId`; the cost meter shows the latest value, not a sum. Works against the WP0 stubs if WP2 hasn't merged yet.

### WP8. `/design` page
**Owns:** `src/renderer/app/design/**`.
**Do:** a Storybook-lite page at `#/design`. Token swatches (surfaces, text with the README contrast numbers, accent, semantic, diff), type scale, radii, shadows, motion samples, and every WP3 component in all its states. Chat pieces (StreamingText, ThinkingBlock, ToolCard states, DiffView, PermissionDialog, Composer idle/focus/running) are fed WP4 fixtures through a throwaway `convId`.
**Accept:** a jsdom smoke test renders `DesignPage` with no errors; every P1 row of the README components table appears on the page.

### WP9. Integration and verification (finishes last)
**Owns:** `src/renderer/app/App.tsx`, `src/renderer/main.tsx` (providers: QueryClientProvider, ipc-bridge init), `README.md` (run notes), `docs/P1-FINDINGS.md` (new). Cross-file fixes only with the lead's OK.
**Do:** wire the providers, run the manual checklist in `npm run dev`, fix integration gaps, and record findings: the thinking-delta result, live `setPermissionMode` behavior, and any SDK surprises.
**Manual checklist:**
1. Pick a project.
2. A new session streams markdown with a highlighted code block.
3. Bash and Edit tool cards render; the Edit diff shows.
4. Permission dialog: Allow once, Deny, and Always allow all work, and Always allow writes the rule to `.claude/settings.local.json`.
5. Esc interrupts; status returns to idle with no error.
6. The cost meter updates and doesn't double after a resume.
7. An old session renders (thinking collapsed, tools paired); sending resumes it, and init carries the same session id.
8. A project with a missing cwd can't start.
9. `#/design` renders.
10. The OS reduced-motion setting stops shimmer, sweep and caret.
11. typecheck, test and build are green.
**Accept:** the checklist passes and `docs/P1-FINDINGS.md` is written.

---

## 3. Collision map (who may edit what after WP0)
- `package.json`, lockfile, `src/shared/**`, `src/preload/**`, tsconfigs, `vitest.config.ts`: lead only.
- `src/main/**`: WP2 owns `sdk-history.ts`, `history-service.ts` and `ipc/history.ts`; WP1 owns everything else. WP2 imports `mapMessage` and `normalizeCwdKey` read-only.
- `src/renderer/styles*`, `components/ui/**`, `lib/{cn,motion}.ts`: WP3. `main.tsx`: WP3 (fonts, Toaster), then WP9.
- `features/chat/model/**`, `stores/chat-store.ts`, `lib/ipc-bridge.ts`: WP4.
- `features/chat/*.tsx` (top level), `lib/highlight.ts`: WP5. `features/chat/{tools,diff,permission}/**`: WP6.
- `app/shell/**`, `features/sessions/**`, `stores/workspace-store.ts`, `lib/query-client.ts`: WP7. `app/design/**`: WP8. `app/App.tsx`: WP0, then WP9.
- Fixtures: `tests/fixtures/sdk` WP1, `tests/fixtures/history` WP2, `tests/fixtures/events` WP4.
