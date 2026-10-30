# P4 Plan (multi-tab, usage, notifications + hotkey, git panel, command palette, packaging, v1 polish)

Date: 2026-10-30. Inputs: `SPEC.md` (v0.1, sections 1, 5, 8, 9, 10, 11), `docs/P3-PLAN.md` (format), `docs/P3-FINDINGS.md` (P4 follow-ups, known gaps), `docs/P2-FINDINGS.md` (asar note), `docs/P1-PLAN.md` D3 / `docs/P2-PLAN.md` D8 (sqlite decisions), `docs/design/README.md` + `tokens.css`, the current `src/` (P3 complete, 615 tests), `package.json`, `node_modules/node-pty/lib/*.js`, `node_modules/@anthropic-ai/claude-agent-sdk*/`.

P4 scope (SPEC section 8 P4 plus the deferred items):
- **Stream A, workspace:** multi-tab sessions, command palette (Ctrl+K, deferred since P1), notifications, global hotkey.
- **Stream B, data views:** usage dashboard, git panel (read-only).
- **Stream C, shipping:** packaging (electron-builder, Windows NSIS), first-run experience, preferences, hardening.
- **Stream D, P3 follow-ups:** live Stop agent / Esc interrupt with a running agent, a frame-time sample while a subagent streams, ctx % on the first turn of a fresh profile, lenient frontmatter read, polish items, flaky timing tests.

Out of P4 (deferred on purpose):
- auto-update (D10) and code signing (D8)
- git write actions (stage, commit, checkout, push)
- the right inspector panel (the git panel is a main view, D6)
- a tray icon (D4) and a light theme (D12)
- tab drag-reorder and tab groups; terminal split panes
- sqlite (D1)
- macOS / Linux packaging, and running the NSIS installer automatically
- plugin-agent precedence verification and the Claude Design pixel comparison
- `agentProgressSummaries` and past-session subagent metrics

---

## 1. Decisions

All probing was read-only. Nothing was installed into the repo.
- The npm registry was queried read-only: `electron-builder` 26.18.0, `electron-updater` 6.8.11, `cmdk` 1.1.1 (peer React ^18 || ^19; depends on separate `@radix-ui/react-dialog`, `-primitive`, `-id` and `-compose-refs` packages).
- `claude auth --help` and `claude auth status --help` were run against the SDK's bundled binary. That printed help text only: no status call, no credentials read.
- The user's real `~/.claude` was not read.

### D1. Persistence: still no sqlite; tabs in `localStorage`, main-process state as JSON files in userData
- P1 D3 and P2 D8 said `node:sqlite` waits for a feature that needs queries. P4 has none:
  - the tab layout is a list of a few dozen small records at most
  - usage aggregation runs in memory over a per-file cache (D5)
- **Renderer (`localStorage`):** `ccwrap.tabs.v1` (D2) and `ccwrap.palette.recent` (D7). This is the same style as `ccwrap.lastCwd`, `ccwrap.ctxWindow` and the terminal keys.
- **Main (`<userData>/*`, written with the existing `atomic-write`):** `prefs.json` (D4), `window-state.json`, `usage-cache.json` and `usage-ledger.jsonl` (D5).
- Prefs live in main, not in `localStorage`, because main needs them before the renderer exists: for hotkey registration, window bounds and the notification policy.
- **SPEC deviation:** the SPEC section 1 "Local DB" stays unused in v1. Recorded.

### D2. Multi-tab: tabs are a view over the existing per-conversation chat store
Facts read from the code:
- `chat-store` already holds `convs: Record<convId, ConvState>`. It applies every `session:event` to its conversation, shown or not (`applyBatch` routes by `localToConv`). So background sessions already keep their full state. Only `workspace-store.activeConvId` is singular.
- `AppShell` renders `<ChatView key={target.convId}>`, so a tab switch remounts the chat. `Composer` keeps its text in `useState`, so **today a tab switch would lose the draft**.
- `SessionManager` caps live sessions at 5 (`MAX_SESSIONS`). A session stays live (its streaming-input query stays open) after its turn ends, until `close`.
- `PermissionDialog` lives inside `ChatView`, so only the active tab can show it.

Decisions:
- **Model:**
  - `workspace-store` gains `tabs: TabRef[]` (contract 2.10). A tab is `{convId, cwd, sessionId?, title?, openedAt, lastActiveAt}`.
  - `activeConvId` stays the single source of what is shown.
  - The workspace `cwd` follows the active tab, so the config pages always show the active tab's project.
- **Opening:**
  - Clicking a history session activates its tab if it is open, else opens a new tab.
  - "New session" (the rail button, Ctrl+T) reuses an empty draft tab of the same project if one exists, else opens a new draft tab.
  - `selectProject(cwd)` activates the most recent tab of that project, else opens a draft tab.
  - Every switch that changes the view or the project goes through `useDirtyRegistry.guard`, as today.
- **Closing (Ctrl+W, the tab's x, or a middle click):**
  - If the conversation is running, waiting for permission, or has a running non-hidden task, a confirm dialog comes first ("Stop the running turn and close this tab?"). Then `interrupt` (when running), `session.close(localId)` and `removeConv`.
  - Idle tabs close without asking.
  - Closing the last tab leaves the "Select a project" or draft state, as today.
- **The 5-session cap:**
  - Before `session.start`, the renderer counts the bound conversations that are not closed.
  - At 5, it **suspends** the least recently active idle conversation (no running turn, no pending permission, no running task): it calls `session.close(localId)`, unbinds it and sets `resumeSessionId = meta.sessionId`. That conversation's next submit then resumes the session transparently. Its tab and transcript stay.
  - If no conversation is idle, the submit fails with "5 sessions are active. Stop or close one to start another."
  - Main's cap stays as the backstop.
- **Drafts:** the composer text moves to `chat-store.drafts[convId]`. It is not persisted across restarts.
- **Per-tab status** (derived in `features/tabs/tab-status.ts`, memoized per conversation reference):
  - `running`: an info dot with a slow pulse (static under reduced motion)
  - `waiting`: a warn dot
  - `error`: a danger dot
  - `unread`: an accent dot. A `result` arrived while the tab was not active; cleared on activation.
  - `idle`: no dot
  - The tab tooltip shows the project path, the model, the session cost (`lastResult.costUsd`), the session tokens (`session.usage`) and the status text.
- **Background attention (renderer):**
  - While the window is focused, a background tab that enters `waiting_permission` raises a sonner toast "<tab title> needs approval" with a **Show** action that activates the tab.
  - A background turn that finishes only gets the `unread` mark (no toast).
  - OS notifications are main's job and fire only when the window is unfocused (D3).
- **Persistence:**
  - `ccwrap.tabs.v1 = {tabs: [{convId, cwd, sessionId?, title?}], activeConvId}`, written on each tab-list or active change (debounced 300 ms).
  - On start, tabs with a `sessionId` come back as history conversations whose transcript loads **lazily on first activation**. Draft tabs without a session id are dropped.
  - Live sessions never survive an app restart; they become resumable history, as today.
- **Title bar** (40 px; the `titleBarOverlay` already reserves the right edge through `env(titlebar-area-width)`):
  - Left to right: the `ccwrap` label; a `no-drag` tab strip; a `+` button; the drag gap; the palette trigger (D7, 260 x 26, shrinking to 120); the Interrupt button.
  - Tabs are 28 high, 72 to 240 wide, with an 8 px radius. The active tab gets `bg-2` plus the 2 px accent underline that the current single tab has.
  - On overflow the strip scrolls horizontally: the mouse wheel maps to `scrollLeft`, the active tab is scrolled into view, and the edges fade.
  - The drag region is the gap between the strip and the trigger. Every interactive element is `no-drag`.
- **Shortcuts:**
  - Ctrl+T new tab, Ctrl+W close tab, Ctrl+Tab / Ctrl+Shift+Tab cycle through tabs, Ctrl+1..8 jump to tab N, Ctrl+9 jumps to the last tab.
  - All of them are ignored while the focus is inside the terminal (`.xterm`), because bash itself uses Ctrl+W and others.
- **App menu:** see D11. Without the default menu, Ctrl+W no longer closes the window and Ctrl+R no longer reloads the renderer. A reload would orphan the live main sessions.
- **Active session reported to main:**
  - On every active-tab or binding change, the renderer calls `app.setActiveSession(localId | null)` (fire-and-forget).
  - Main routes a notification click back as `app:focusSession {localId}` (D3).

### D3. Notifications: decided in main, only when the window is unfocused
- **Why main decides:**
  - Main sees every session event before IPC.
  - It knows `win.isFocused()` and `isMinimized()`.
  - It keeps working while the renderer's `requestAnimationFrame` is paused in a hidden window.
  - The renderer is not trusted to know whether the user is looking.
- **When** (each case has a prefs toggle; all default to on):
  - `permission`: a `permission_request` event. Title "Approval needed · <project folder name>", body "Claude wants to use <toolName>". Main also calls `win.flashFrame(true)`, which stops on focus.
  - `turnDone`: a main-thread `result` with `durationMs >= turnDoneMinSeconds * 1000` (default 15 s, so quick replies do not spam). Body "Turn finished in 42s" or "Turn ended with an error".
  - `backgroundTask`: a `task_ended` for a task that was not `hidden` or `ambient` (main tracks the flags from `task_started`). Body "<subagentType or 'Agent'> completed / failed / stopped".
- **Privacy:**
  - Windows keeps toasts in the Action Center, so notification text never contains a prompt, a response, tool input, a task description or file content.
  - Allowed: tool names, agent types, the project folder's base name and durations.
- **Gating:**
  - Notify only when `!win.isFocused()`.
  - At most one toast per session per 5 s (the latest wins).
  - `prefs.notifications.enabled` is the master switch.
- **Click:**
  - Restore, show and focus the window, then send `app:focusSession {localId}`. The renderer activates that tab and the chat view.
  - Notification objects are kept in a Set until `close` or `click`, so they are not garbage collected. A collected notification loses its click handler (a known Electron pitfall).
- **Windows identity:**
  - Main calls `app.setAppUserModelId('com.ccwraper.app')`, equal to the electron-builder `appId`, so the NSIS Start-menu shortcut attributes the toasts to "ccwraper".
  - In dev and in `win-unpacked` there is no shortcut, and Windows may not show toasts from an unregistered AUMID. WP2 measures this.
  - If the toasts do not show, the fallback always works: `flashFrame` (permission) plus a taskbar overlay badge (`win.setOverlayIcon`, cleared on focus).
  - The toast check for the installed app becomes a human step in WP13.

### D4. Global hotkey: off by default; no tray
- **Off by default:**
  - `globalShortcut` steals the chord system-wide, and every plausible default collides with something: Ctrl+Shift+Space is a VS Code shortcut, and Alt+Space opens the window menu (and PowerToys Run).
  - So the hotkey is disabled by default, with `Control+Alt+Space` pre-filled as a suggestion.
- **Behaviour:** if the window is focused, minimize it; otherwise restore, show and focus it.
- **Conflicts:**
  - `globalShortcut.register` returns false when another app owns the chord, and throws on an invalid accelerator.
  - In both cases the prefs save still succeeds. `PrefsSetResult.hotkey = {registered: false, error}` is shown next to the field ("Already used by another app" or "Not a valid shortcut").
  - Everything is unregistered on `will-quit`.
- **No tray:**
  - Closing the window ends all sessions, including the CLI child processes.
  - A tray "keep running" mode would hide running agents and their cost.
  - v1 keeps the simple lifecycle and adds a quit guard instead (D11).

### D5. Usage dashboard: tokens from transcripts, exact cost from an in-app ledger, aggregated in main
**What the transcripts carry:**
- Each `type: "assistant"` line has `message.id`, `message.model`, `message.usage.{input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens}`, `timestamp`, `sessionId`, `cwd` and `isSidechain`.
- One API message is stored as **several lines (one per content block) that repeat the same `message.id` and usage**. That is why `mapHistoryMessages` coalesces.
- There is **no cost** in the transcript.

**Tokens (all Claude Code sessions on this machine, CLI included):**
- A new main boundary reader, `transcript-usage.ts`, streams `<configDir>/projects/*/*.jsonl`, plus `<configDir>/projects/*/<sessionId>/subagents/*.jsonl` when present.
- It is the second reader of the unstable transcript format (SPEC 9 risk), so it is tolerant: unknown lines are skipped, never thrown on. Synthetic fixtures cover it.
- Per line:
  - A cheap prefilter (`line.includes('"usage"') && line.includes('"assistant"')`) runs before `JSON.parse`, so most lines are never parsed.
  - Dedupe by `message.id` within a file, keeping the maximum of each counter (the repeated lines carry the same or growing numbers).
  - Skip lines with `model === '<synthetic>'` and lines without usage.
  - Bucket by the **local calendar date** of `timestamp`, by model and by `cwd` (normalized with `normalizeCwdKey`), counting distinct `sessionId`s.
- **Only numbers are kept.** No text, tool input or message content is retained, logged or cached. Errors are logged as `file:lineNumber: reason`.

**Cost (exact, sessions run in ccwraper only):**
- The SDK's `result.modelUsage[model].costUSD` is cumulative per query process.
- Main appends one ledger line per `result` to `<userData>/usage-ledger.jsonl`: `{ts, sdkSessionId, cwdKey, models: {model: {costUsd, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens}}}`. Each line holds the **delta** since that localId's previous result.
- For this, the adapter adds per-model, cumulative `modelUsage` to the `result` event (contract 2.3).

**No price table:**
- Estimating CLI-session cost from a hard-coded price list would be wrong for new models and plans.
- The dashboard labels cost "Exact cost of sessions run in ccwraper (since <first ledger date>)" and tokens "All Claude Code sessions on this machine".
- Recorded as a deliberate limit.

**Cache and performance (target: 60 MB+ transcripts):**
- `<userData>/usage-cache.json` stores `{size, mtimeMs, offset, buckets}` per file.
  - A file whose size grew and whose mtime moved is read **from the stored offset** (transcripts are append-only in practice).
  - A shrunk or replaced file is re-read fully.
  - An unchanged file is not opened.
- Reads use `createReadStream` (1 MB chunks) with a line splitter, at most 2 files at a time.
- The parse loop yields (`setImmediate`) after every ~8 ms of work, so live session IPC never stalls.
- **Gate (WP3):**
  - a synthetic 64 MB transcript scans cold in under 4 s
  - a cached re-run over 500 files takes under 300 ms
  - `perf_hooks.monitorEventLoopDelay` p99 stays under 50 ms during the scan
- If the gate fails, move the scan into a `worker_threads` worker (electron-vite `?modulePath` import). The pure reader stays the same.

**Aggregation in main, display in the renderer:** `usage:summary {days: 7|30|90|365, cwd?, force?}` returns a `UsageSummary` that is ready to draw (contract 2.5). The renderer does no file work.

**Charts: hand-rolled SVG, no chart library:**
- Three chart shapes are needed: daily stacked bars, horizontal bars, and a small table with inline bars.
- A library (recharts plus d3 pieces, about 400 kB) would be the largest chunk after the editor, and none is token-aware.
- The shapes, scales and ticks are about 300 lines, with pure, tested math in `components/charts/scale.ts`.

**Dataviz tokens (new; `docs/design` had no chart palette):**
- WP0 adds these tokens:

  | Token | Color | Same as |
  |---|---|---|
  | `--chart-1` | violet `#A78BFA` | `--accent-text` |
  | `--chart-2` | blue `#60A5FA` | `--info` |
  | `--chart-3` | cyan `#22D3EE` | the accent conic |
  | `--chart-4` | green `#4ADE80` | `--ok` |
  | `--chart-5` | amber `#FBBF24` | `--warn` |
  | `--chart-6` | gray `#82828F`, always "Other" | `--text-tertiary` |
  | `--chart-grid` | `var(--border)` | |
  | `--chart-axis` | `var(--text-tertiary)` | |

- Every chart color has 5:1 contrast or better on `bg-1` (the README contrast table).
- Fixed mapping:
  - output = chart-1, input = chart-2, cache read = chart-3, cache write = chart-5
  - models take chart-1..5 by descending tokens; the rest are "Other"
- Bars grow with `transform: scaleY` (no animation under reduced motion).
- Every chart has `role="img"`, an `aria-label` summary, and a "Table" toggle that shows the same numbers.
- A "Data visualization" section is added to `docs/design/README.md`.

### D6. Git panel: a read-only main view over `git`, run with `execFile`
**Placement:**
- Git is a new main-column view (a rail row, and in the palette), not part of the inspector.
- The right inspector does not exist yet, and building it is outside P4.
- Recorded deviation from the SPEC layout's "inspector files/diff".

**Binary:**
- `git` is resolved once: `where.exe git`, then `C:\Program Files\Git\cmd\git.exe`, then the Git Bash location that `shells.ts` already detects.
- If none is found, the panel shows the `git_missing` state. Git never runs through a shell.

**Every call:**
- Runs as `git --no-optional-locks -c core.quotepath=false -c core.fsmonitor=false -c color.ui=false <cmd>`.
- Env: `GIT_OPTIONAL_LOCKS=0` and `GIT_TERMINAL_PROMPT=0`.
- Options: `windowsHide`, a 15 s timeout, an 8 MB `maxBuffer`.
- Why `--no-optional-locks`: otherwise `git status` refreshes the index and can take `index.lock` while the CLI's own git commands run in the same repo.
- Why `core.fsmonitor=false`, plus `--no-ext-diff --no-textconv` on diff: a repo's own `.git/config` or `.gitattributes` can name programs that `status` or `diff` would execute. A read-only panel must never run programs the repo controls.

**Commands:**
- **status:**
  - Runs `status --porcelain=v2 --branch -z --untracked-files=normal`, plus `diff --numstat -z` and `diff --cached --numstat -z`. The numstat calls are skipped above 500 entries.
  - The output is parsed into `GitStatus` (contract 2.6), capped at 2,000 entries with `truncated` and `total`.
  - A `safe.directory` error ("dubious ownership") becomes `unsafe_repo` with git's own message. ccwraper never edits git config.
- **diff:**
  - Runs `diff [--cached] --no-ext-diff --no-textconv -U3 -- <path>`.
  - Capped at 1 MB or 5,000 lines (`truncated`). "Binary files differ" sets `binary`.
  - An untracked file returns its text as `untrackedText` (at most 1 MB; a NUL sniff rules out binaries). The renderer shows it as an all-added diff.
  - An untracked directory entry (trailing `/`) gets no diff.
- **log:** runs `log -n <limit> --format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1e`.

**Paths:**
- `cwd` must be an existing absolute directory.
- `path` must be repo-relative: not absolute, no `..` segment, no NUL. It always comes after `--`.
- Git outputs `/` separators. The renderer shows the paths as they are and joins them with the root only for the copy action.

**Refresh:**
- On view mount, on window focus, 500 ms after a `result` from any conversation in the same project, and from a Refresh button.
- There is no `.git` watcher, because watching big repos is expensive.

**Renderer:**
- Two tabs: Changes and History.
- **Changes** lists four groups: Conflicts, Staged, Changes and Untracked. Each row shows its status letter and +/- counts.
- Selecting a row shows the existing `DiffView`:
  - the patch is parsed into `DiffRow[]` by a new `features/git/patch-rows.ts`, using the `parsePatch` function of the `diff` package
  - untracked text goes through `computeDiff('', text)`
- **History** lists the 50 newest commits, with a copy-hash action.
- A permanent note: "Read-only. Use the terminal or Claude to stage and commit."
- Lists longer than 200 rows are virtualized with `@tanstack/react-virtual`.

**Write actions are out of scope:** stage, unstage, commit, discard, checkout and push. If a later phase adds them, they go behind a confirm dialog.

### D7. Command palette: hand-rolled on the existing Radix Dialog, with one registry
**Why not `cmdk`:**
- It would pull a second copy of the Radix dialog and primitive packages next to `radix-ui` 1.8.1.
- Its built-in filtering would have to be replaced anyway, to get grouped scoring, recents and the design's translateY highlight pill.
- It does not solve the known gap: scrolling the selected row into view.
- **SPEC deviation** (section 1 names `cmdk`). Recorded.

**Registry (`lib/commands`, types frozen in 2.10):**
- A `PaletteCommand` has `id, title, group, subtitle?, keywords?, shortcut?, icon?, run(), disabled?`.
- Sources are hooks that return commands from the current state. They are collected when the palette opens.

| Group | Commands | Run |
|---|---|---|
| Navigation | one per `AppView` (a test asserts that every `APP_VIEWS` entry has one) | `setView` |
| Tabs | the open tabs | activate the tab |
| Actions | New session, Close tab, Next / previous tab, Toggle terminal, Interrupt, Open folder..., Refresh git, Check sign-in, Preferences | the action |
| Sessions | the current project's history, the 200 newest (from the React Query cache) | open the session |
| Projects | `useProjectList` | select the project |
| Skills / Commands / Agents | `items.list` for the current cwd (cached by `configKeys.items`; fetched on open if missing) | open that page with the item selected (a `focusItem` hint in `workspace-store`) |
| Slash commands | the active conversation's `meta.slashCommands` | insert `/<name> ` into the composer through a new `lib/composer-bus.ts` (the same pattern as `terminal-bus`) |

**Fuzzy matching:**
- A pure scorer: subsequence match, with bonuses for word starts, consecutive runs and a prefix match. Keywords count at half weight.
- Ordering: groups in a fixed order, then by score, then by recency.
- With an empty query: Recent first (the last 8 run ids, from `ccwrap.palette.recent`), then Actions and Navigation.
- At most 50 rows are rendered.

**UI (design README):**
- Sizes: glass; 620 wide; top offset 96 (10vh on short windows); input 52 high; rows 36; group headers 28; list max 460 high or 62vh.
- Selection:
  - The highlight pill follows the selection with `translateY` (180 ms; no animation under reduced motion).
  - **The selected row is scrolled into view** with `scrollIntoView({block: 'nearest'})` on every selection change.
- Keys: arrows, PageUp / PageDown, Home / End, Enter, Esc.
- ARIA: `role="combobox"` with a `listbox` of `option`s and `aria-activedescendant`.

**Shortcuts:**
- Ctrl+K and Ctrl+Shift+P, caught by a window `keydown` listener in the capture phase.
- Ctrl+K is ignored while the focus is inside `.xterm`, because shells use it. Ctrl+Shift+P always works.
- A title-bar trigger button opens the palette too.

### D8. Packaging: electron-builder 26.18.0, Windows NSIS per-user, `dist/` only, never published
**Facts read from `node_modules`:**
- **The SDK binary:**
  - The SDK finds its native CLI with `createRequire(import.meta.url).resolve(...)`. The target is `@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe` (**298 MB**).
  - Inside `app.asar`, that resolves to a path **inside the archive, which cannot be spawned**. `paths.ts bundledClaudePath()` has the same problem.
  - `bundledClaudePath()` and `readSdkVersions()` also start their search at `process.cwd()`. So a packaged app launched from a folder with its own `node_modules` could pick up a foreign SDK.
- **node-pty:**
  - It loads `prebuilds/win32-x64/{conpty.node, pty.node, conpty_console_list.node}` and `conpty/{conpty.dll, OpenConsole.exe}` (seen live in P3).
  - `windowsConoutConnection.js` starts a `worker_threads` worker from `__dirname`. It rewrites only `node_modules.asar` in that path, **not `app.asar`**.
- **Main bundle:**
  - At runtime it requires only `electron`, `node-pty`, `yaml` and `zod`. It also loads `@anthropic-ai/claude-agent-sdk` and `chokidar` with dynamic `import()`.
  - Everything else in `dependencies` (React, CodeMirror, xterm, shiki, radix, ...) is bundled into the renderer by Vite. electron-builder would still copy all of it into `app.asar/node_modules`.

**Decisions:**
- **Dependencies:**
  - WP0 moves the renderer-only packages to `devDependencies` (same versions; the lockfile only changes `dev` flags).
  - `dependencies` becomes: `@anthropic-ai/claude-agent-sdk` (its optional `-win32-x64` package comes with it), `node-pty`, `chokidar`, `yaml`, `zod`.
  - A WP7 check asserts that every `require("x")` / `import("x")` in `out/main/index.js` is a declared dependency or a Node builtin.
- **`electron-builder.yml`** (WP7):
  - Identity: `appId: com.ccwraper.app`, `productName: ccwraper`.
  - Layout: `directories: {output: dist, buildResources: build}`, `files: [out/**, package.json, "!**/*.map"]`.
  - Archive: `asar: true`, `asarUnpack: [node_modules/node-pty/**, node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/**]`.
  - No rebuilds: `npmRebuild: false`, `nodeGypRebuild: false`, `buildDependenciesFromSource: false`. node-pty is N-API with prebuilds, so no VS toolchain is needed.
  - Electron: `electronVersion: 45.1.0`, `electronDist: node_modules/electron/dist` (no Electron download).
  - Windows: `win: {target: [nsis], icon: build/icon.png}`.
  - Installer: `nsis: {oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, deleteAppDataOnUninstall: false}`. That is a per-user install with no admin, and user data survives an uninstall.
  - Publishing: `publish: null`, and the scripts always pass `--publish never`.
  - Fuses: `electronFuses: {runAsNode: false, enableNodeOptionsEnvironmentVariable: false, enableNodeCliInspectArguments: false, onlyLoadAppFromAsar: true}`.
    - Nothing spawns `process.execPath` as Node (the pty service already strips `ELECTRON_RUN_AS_NODE`).
    - `--remote-debugging-port` is a Chromium switch, so it still works for the packaged smoke.
- **No portable target:** a portable exe re-extracts about 400 MB to `%TEMP%` on every launch. The smoke test uses a `dir` target (`dist/win-unpacked`) instead.
- **The Claude binary when packaged** (WP0, `paths.ts`):
  - A new `toUnpackedPath(p)` maps `<sep>app.asar<sep>` to `<sep>app.asar.unpacked<sep>`.
  - `resolveClaudeExecutable()` returns the user's binary when that one is chosen, else `toUnpackedPath(bundledClaudePath())`. The path is always explicit, so the SDK never resolves inside the archive.
  - When `__dirname` is inside an asar, the module search starts at `__dirname` only, never at `process.cwd()`.
  - A test-only override, `CCWRAP_CLAUDE_SOURCE=bundled`, forces the bundled binary so the packaged smoke can prove it.
- **The node-pty worker inside asar:**
  - WP7 verifies in `win-unpacked` that a pwsh tab and a Git Bash tab open, echo and exit, and that `OpenConsole.exe` is spawned from `app.asar.unpacked`.
  - If the conout worker fails to load from `app.asar`, the fallback is `asar: false` for v1: a slower first start and many files, but correct. Recorded in the findings.
  - `node_modules` is never patched.
- **Size:**
  - The bundled `claude.exe` dominates; the installer is about 120 MB or more.
  - It is kept: a first-time user without a CLI install must still be able to work, and the P0 D1 rule prefers a newer user CLI anyway.
- **Icon:**
  - `scripts/make-icon.mjs` runs under Electron (`electron scripts/make-icon.mjs`). It renders an SVG mark (a `bg-1` rounded square with the accent gradient) offscreen with `capturePage` and writes a 1024 px `build/icon.png`.
  - electron-builder converts the PNG to `.ico`.
  - The PNG is committed. No image dependency is needed.
- **userData:**
  - Packaged: `%APPDATA%\ccwraper` (from productName).
  - **Dev moves to `%APPDATA%\ccwraper-dev`.** `main/index.ts` sets it before `ready` when `!app.isPackaged` and no `--user-data-dir` switch was given.
  - So a dev build never shares backups, trash, prefs, the ledger or `localStorage` with an installed app.
  - Cost: the dev profile's `localStorage` (last cwd, ctx windows) starts empty once.
- **CSP in production:**
  - The existing meta CSP (`default-src 'self'; script-src 'self'; ...`) already ships in `out/renderer/index.html` and works under `file://` (`npm start` in P1 to P3).
  - WP0 adds `object-src 'none'; base-uri 'none'; frame-src 'none'`.
  - The packaged smoke asserts that the console has no CSP violation messages.
- **Single instance:** `app.requestSingleInstanceLock()`. A second launch focuses the existing window and exits.
- **Code signing:**
  - Unsigned by default, with `forceCodeSigning: false`. rcedit still stamps the icon and version.
  - The README documents the SmartScreen step ("More info -> Run anyway") and how to sign later: `CSC_LINK` / `CSC_KEY_PASSWORD`, or Azure Trusted Signing via `win.azureSignOptions`.
  - No certificate is used or created in P4.
- **Network:**
  - On first use, `electron-builder` downloads its NSIS and winCodeSign tool bundles from GitHub into `%LOCALAPPDATA%\electron-builder\Cache`. That is a download, not an upload, and it is allowed.
  - Nothing is published or uploaded.

### D9. Version and naming
- `package.json`: `name: ccwraper` (unchanged); `productName: ccwraper` (added).
- The P4 build is version `0.4.0`. The lead sets `1.0.0` only after the WP13 v1 checklist passes.
- `AppInfo` gains `version`, `electronVersion`, `packaged` and `userDataDir`.

### D10. Auto-update: deferred, not installed
- **Why deferred:**
  - `electron-updater` needs a publish target (GitHub releases or a generic URL) and a release process. Neither exists.
  - With unsigned builds, every update through the NSIS updater would bring a SmartScreen prompt.
- **What v1 ships:** no update code and no `electron-updater` dependency. Preferences > About shows the version and "Updates: install a newer ccwraper build to update."
- **The future path** (recorded in the README, not implemented):
  - code signing first
  - then `electron-updater` with `publish: {provider: github, owner, repo}`
  - and an opt-in "Check for updates" pref that defaults to off

### D11. Main-process hardening and lifecycle
- **App menu:**
  - `Menu.setApplicationMenu(null)` on Windows removes the default menu's Ctrl+W (close window), Ctrl+R (reload) and Ctrl+Shift+I (DevTools) accelerators.
  - In dev only (`!app.isPackaged`), a `before-input-event` handler maps F12 and Ctrl+Shift+I to DevTools.
  - Copy, paste and undo keep working without a menu on Windows, because Chromium handles them.
- **`will-navigate`:** allow only the app's own URL: the dev server origin, or exactly the packaged `index.html` file URL. Today it allows any `file://` URL.
- **Quit guard:**
  - On window `close`, it checks `prefs.confirmQuitWhileRunning` (default on) and `manager.busyCount() > 0` (a running turn, a pending permission, or a running background task).
  - If both hold, it prevents the close and shows a native message box: "N sessions are still working. Quit and stop them?" with Quit / Cancel. Cancel is the default.
- **Window state:** bounds and the maximized state are saved to `window-state.json` (debounced). They are restored only when they still fit a connected display.

### D12. First run, preferences, theme
**Sign-in check:**
- Main runs `claude auth status --json` through the existing `runClaude` (`execFile`, no shell), at startup and on demand, with a 10 s timeout.
- It maps the output to `{state: signed_in | signed_out | unknown, method?: subscription | api_key | other}` and **drops every other field** (email, org) before IPC or logging.
- The JSON shape is not documented, so the mapping is tolerant. Any parse failure or unknown shape gives `unknown`, which never blocks anything.
- WP1 learns the shape **only from a sandbox `CLAUDE_CONFIG_DIR` (logged out)** plus a synthetic signed-in fixture. It never runs the command against the real config.
- WP13 runs it once in the real app and records only the state value.

**First-run card** (in the chat empty state; shown until every check is ok; dismissible):
- The Claude Code binary: its source and version, plus the P0 "older than bundled" note.
- The sign-in state. When signed out, a **Sign in** button opens a terminal tab with `claude auth login` typed but **not executed** (the P2 "Run in terminal" rule).
- An API-key setup counts as signed in when the status says so.
- A project, with an "Open folder..." action.

**Auth errors in chat:** a session `error`, or an error `result`, whose message matches `/not logged in|log ?in|authenticat|invalid api key|401/i` shows a "Sign in" hint action next to the error (the same terminal action).

**Preferences page** (a new view, pinned under Settings in the rail, and in the palette):
- Notifications: the master switch, the 3 toggles and the min-seconds field.
- Global hotkey: a toggle, an accelerator capture field and the registration result.
- Quit confirmation.
- Terminal default shell: the existing `terminal-store` setting, surfaced here.
- About: version, Electron, SDK, the claude path with its source and note, userData, the trash dir, and "Updates: manual".

**Theme:** dark only in v1 (SPEC 10 says a light theme is optional, later). There is no theme setting. Recorded.

### D13. P3 follow-ups folded into P4
| # | Item | Resolution | WP |
|---|---|---|---|
| 1 | Stop agent and Esc interrupt with a live running agent were not driven | WP13 drives both live with a long background-agent prompt. If the harness blocks the driver again, the exact manual steps go into the findings for a human run | WP13 |
| 2 | No frame-time sample while a subagent streams | WP13 takes a CDP `Performance` / `requestAnimationFrame` delta sample. Target: p95 under 20 ms with one subagent streaming, and again with two tabs streaming at once | WP13 |
| 3 | ctx % missing on the first turn of a fresh profile | A new `src/shared/models.ts` `assumedContextWindow(modelId)` returns 1,000,000 when the id carries `[1m]`, else 200,000. The status bar uses the cached window, else the assumed one. An assumed window always shows `~` with the tooltip "Context window assumed until the first reply". The cached value from `result` wins, as today | WP11 |
| 4 | A real agent with an unquoted `: ` in `description` shows "Broken frontmatter" | See the lenient frontmatter notes below the table | WP11 |
| 5 | Toasts cover the footer buttons | The toaster offset becomes `bottom: 88` (the 26 px status bar + a 56 px footer + a gap); the design README is updated | WP11 |
| 6 | Editor scrollbar arrow buttons; small OS checkboxes | `::-webkit-scrollbar-button { display: none }` in `base.css`; a token-styled `Checkbox` (radix-ui Checkbox) in `components/ui`, used by the hooks confirm dialog; the CodeMirror search checkboxes are styled from tokens with `appearance: none` in `cm-theme.ts` | WP11 |
| 7 | Flaky timing tests (1 transient failure in 3 runs, unidentified) | WP12 does 10 full runs, some under load (`--reporter=json`), identifies the flaky tests and fixes the root cause (fake timers or condition waits instead of sleeps). No global `retry` | WP12 |
| 8 | Verify the unprompted-turn fix live | WP13, in the same background-agent run as #1 | WP13 |
| - | `"hooks": {}` is left after removing the last hook | **No change.** It matches P3 D8: the parent object is deleted only if the patch created it | - |
| - | Plugin-agent precedence, the Claude Design comparison, the WSL smoke | Deferred (out of P4) | - |

**Lenient frontmatter (row #4):**
- `parseFrontmatter` gains a lenient fallback for when strict parsing fails:
  - It runs `quoteUnsafeScalars(text)`, which quotes the top-level plain scalars that contain `': '`, in the frontmatter only.
  - If the fixed text parses, `data` comes from it, `lenient = {keys}` is set, and `error` stays set.
- The main listing reports a `warning` instead of an `error`. So the item gets no "Broken" badge, but a "Non-strict YAML (the CLI accepts it)" chip.
- The form stays read-only for such files and offers **Quote values (N)**. That applies the fix to the buffer; the user reviews it and saves.
- `patchFrontmatter` still throws on text that is not valid strict YAML.

### D14. Cross-cutting rules for all agents (P3 D13 still applies)
**WP0 is the sole writer** of the files below. A missing dependency or a contract change is reported to the lead.
- `package.json`, `package-lock.json`
- `src/shared/**`, except the `src/shared/frontmatter.ts` + test carve-out for WP11
- `src/preload/**`
- tsconfigs, `vitest.config.ts`, `electron.vite.config.ts`, `tests/setup-*.ts`
- `src/main/index.ts`, `src/main/ipc/index.ts`, `src/main/paths.ts`
- `src/main/services/prefs-service.ts`, `src/main/services/session-manager.ts`
- `docs/design/**`, `src/renderer/styles/tokens.css`, `src/renderer/styles/theme.css`
- `src/renderer/index.html`

**The only new dependency is `electron-builder` 26.18.0** (exact pin, devDependency). No `cmdk`, no chart library, no `electron-updater`, no image tools.

**Never touch the real user config or credentials:**
- Tests use the P2 `tests/setup-node.ts` isolation (temp `CLAUDE_CONFIG_DIR` / `USERPROFILE` / `HOME`).
- userData, project and repo dirs come from `mkdtemp`, and are all injected by constructor.
- Transcript fixtures are synthetic and generated in temp dirs. The 64 MB perf file is generated at test time and never committed.
- Git tests `git init` repos in temp dirs and pass a local `user.name` / `user.email` with `-c` flags. Nothing writes global git config.
- `claude auth status` runs only with a sandbox `CLAUDE_CONFIG_DIR`, except the one WP13 check.

**Packaging writes only into `dist/`** (and electron-builder's own download cache):
- `--publish` is always `never`.
- Never upload anything, and never create or use a signing certificate.
- Never run the NSIS installer in automation.

**No git writes** by ccwraper code or tests outside temp repos. The git service runs only `status`, `diff`, `log` and `rev-parse`, which a test asserts over the argument lists.

**Live SDK runs cost money:**
- Only WP5 (one dev check), WP7 (one packaged turn) and WP13 run them, in `D:\claude-tmp\p4-live`, on haiku.
- Budgets: WP5 under $0.05, WP7 under $0.02, WP13 under $1.00.

**Privacy:** usage data, the ledger, notifications and logs carry only counts, costs, model ids, tool names, project paths and durations. Never message, prompt, tool-input or file content.

**No hex in components** (the guard stays). Charts use `--chart-*` through Tailwind classes or `var()`.

**Selector stability:** the Zustand 5 + React 19 rule (P3 D13) applies to the tab strip, tab status and palette sources. Memoize per conversation or list reference, or use `useShallow`.

**Verification:** every WP runs `npm run typecheck`, `npm test` and `npm run build`. UI WPs add Testing Library tests with a mocked `window.ccwrap`.

---

## 2. Frozen contracts (WP0 lands these first)

### 2.1 `src/shared/channels.ts` (add)
~~~
// P4
appAuthStatus: 'app:authStatus'
/** Fire-and-forget (ipcRenderer.send). */
appSetActiveSession: 'app:setActiveSession'
/** main -> renderer */
appFocusSession: 'app:focusSession'
prefsGet: 'prefs:get'   prefsSet: 'prefs:set'
/** main -> renderer */
prefsChanged: 'prefs:changed'
usageSummary: 'usage:summary'
gitStatus: 'git:status'   gitDiff: 'git:diff'   gitLog: 'git:log'
~~~

### 2.2 `src/shared/app.ts` (new, zod-free types) and schemas in `ipc.ts`
~~~ts
export interface NotificationPrefs {
  enabled: boolean; permission: boolean; turnDone: boolean; turnDoneMinSeconds: number; backgroundTask: boolean; flashTaskbar: boolean
}
export interface AppPrefs {
  version: 1
  notifications: NotificationPrefs
  hotkey: { enabled: boolean; accelerator: string }
  confirmQuitWhileRunning: boolean
}
export const DEFAULT_PREFS: AppPrefs = {
  version: 1,
  notifications: { enabled: true, permission: true, turnDone: true, turnDoneMinSeconds: 15, backgroundTask: true, flashTaskbar: true },
  hotkey: { enabled: false, accelerator: 'Control+Alt+Space' },
  confirmQuitWhileRunning: true
}
export type AppPrefsPatch = {
  notifications?: Partial<NotificationPrefs>
  hotkey?: Partial<AppPrefs['hotkey']>
  confirmQuitWhileRunning?: boolean
}
export interface HotkeyStatus { enabled: boolean; registered: boolean; accelerator: string; error?: string }
export interface PrefsSetResult { prefs: AppPrefs; hotkey: HotkeyStatus }
export interface AuthStatus {
  state: 'signed_in' | 'signed_out' | 'unknown'
  method?: 'subscription' | 'api_key' | 'other'
  checkedAt: number
  /** Short reason for 'unknown' (timeout, binary missing, unparsable). Never account details. */
  reason?: string
}
~~~
New schemas in `ipc.ts`:
- `AppPrefsPatchSchema`: a strict object; `turnDoneMinSeconds` is an int in 0..3600; `accelerator` is a string of 1..64 characters
- `AuthStatusArgsSchema {refresh?: boolean}`
- `SetActiveSessionSchema {localId: string | null}`

`AppInfo` in `events.ts` adds `version: string; electronVersion: string; packaged: boolean; userDataDir: string`.

### 2.3 `src/shared/events.ts` (change)
~~~ts
// result: add
  /** result.modelUsage mapped per model (cumulative for this query process). */
  modelUsage?: Record<string, Usage & { costUsd: number }>
~~~

### 2.4 `src/shared/models.ts` (new)
~~~ts
/** Fallback before the first result reports contextWindow: 1M for ids with "[1m]", else 200k. */
export function assumedContextWindow(model: string | undefined): number
~~~

### 2.5 `src/shared/usage.ts` (new) and schema
~~~ts
export interface UsageTokens { input: number; output: number; cacheRead: number; cacheCreation: number }
export type UsageRangeDays = 7 | 30 | 90 | 365
export interface UsageQuery { days: UsageRangeDays; cwd?: string; force?: boolean }
export interface UsageDay { date: string /* YYYY-MM-DD local */; tokens: UsageTokens; byModel: Record<string, number> /* total tokens */; costUsd: number; sessions: number }
export interface UsageProject { key: string; cwd: string; tokens: UsageTokens; costUsd: number; sessions: number; lastActive: number }
export interface UsageModel { model: string; tokens: UsageTokens; costUsd: number }
export interface UsageSummary {
  from: string; to: string
  days: UsageDay[]                 // every date in range, zero-filled
  projects: UsageProject[]         // sorted by total tokens desc
  models: UsageModel[]
  totals: { tokens: UsageTokens; costUsd: number; sessions: number; messages: number }
  cost: { source: 'ledger'; since?: string }   // first ledger date; undefined = no in-app sessions yet
  scan: { files: number; cachedFiles: number; skippedFiles: number; bytesRead: number; ms: number; errors: number }
  generatedAt: number
}
~~~
`ipc.ts`: `UsageQuerySchema` (`days` is a literal union; `cwd` is an optional absolute path; `force` is an optional boolean).

### 2.6 `src/shared/git.ts` (new) and schemas
~~~ts
export type GitCode = '.' | 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '?'
export interface GitFileChange {
  path: string; origPath?: string            // repo-relative, '/' separators
  index: GitCode; worktree: GitCode
  untracked?: boolean; conflicted?: boolean; isDir?: boolean
  added?: number; removed?: number; binary?: boolean
}
export type GitErrorCode = 'not_repo' | 'git_missing' | 'timeout' | 'unsafe_repo' | 'bad_path' | 'error'
export type GitStatus =
  | { ok: true; root: string; branch?: string; detached: boolean; upstream?: string; ahead: number; behind: number
      files: GitFileChange[]; truncated: boolean; total: number }
  | { ok: false; code: GitErrorCode; message: string }
export type GitDiff =
  | { ok: true; patch?: string; untrackedText?: string; binary: boolean; truncated: boolean }
  | { ok: false; code: GitErrorCode; message: string }
export interface GitCommit { hash: string; short: string; subject: string; author: string; date: string }
export type GitLog = { ok: true; commits: GitCommit[] } | { ok: false; code: GitErrorCode; message: string }
~~~
New schemas in `ipc.ts`:
- `GitStatusSchema {cwd}`
- `GitDiffSchema {cwd, path, staged: boolean}`: `path` is 1..4096 characters, with no NUL, not absolute, and no `..` segment
- `GitLogSchema {cwd, limit}`: `limit` is an int in 1..200

### 2.7 `CcwrapApi` additions (`ipc.ts`) and preload wiring
~~~ts
app: {
  info(): Promise<AppInfo>
  authStatus(opts?: { refresh?: boolean }): Promise<AuthStatus>
  setActiveSession(localId: string | null): void
  onFocusSession(cb: (p: { localId: string }) => void): () => void
}
prefs: { get(): Promise<AppPrefs>; set(patch: AppPrefsPatch): Promise<PrefsSetResult>; onChanged(cb: (p: AppPrefs) => void): () => void }
usage: { summary(q: UsageQuery): Promise<UsageSummary> }
git: {
  status(a: { cwd: string }): Promise<GitStatus>
  diff(a: { cwd: string; path: string; staged: boolean }): Promise<GitDiff>
  log(a: { cwd: string; limit: number }): Promise<GitLog>
}
~~~

### 2.8 `src/shared/config.ts` / `frontmatter.ts` (change)
~~~ts
// ConfigItemSummary: add
  warning?: string            // lenient-parsed frontmatter (D13 #4); error stays for truly broken files
// FrontmatterDoc: add
  lenient?: { keys: string[] }  // strict parse failed, quote-fixed parse succeeded; data from the fixed text; error kept
// new export (WP0 stub returns {text, keys: []}; WP11 implements)
export function quoteUnsafeScalars(text: string): { text: string; keys: string[] }
~~~

### 2.9 Main wiring (WP0)
**`paths.ts`** (+ tests with Windows fixtures, asar and non-asar paths):
- `toUnpackedPath(p)` and `isInsideAsar(p)`
- `resolveClaudeExecutable()` per D8, including `CCWRAP_CLAUDE_SOURCE=bundled`
- asar-aware search starts in `readSdkVersions` and `bundledClaudePath`
- `prefsPath(ud)`, `windowStatePath(ud)`, `usageCachePath(ud)`, `usageLedgerPath(ud)`
- `transcriptsRoot(env?, home?)`, which is `<configDir>/projects`

**`services/prefs-service.ts`** (**implemented by WP0**, + test):
- `PrefsService(file)` with `get()`, `set(patch)` and `onChange(cb)`
- `set` deep-merges into the defaults, validates, writes atomically and emits a change
- a corrupt file gives the defaults, and the file is kept next to them as a `.corrupt-<ts>` copy (never deleted)

**`services/session-manager.ts`** (**implemented by WP0**, + tests):
- `info(localId): {cwd, sdkSessionId?} | undefined`
- `busyCount(): number`, which tracks the last `status` of each session and the running non-hidden task ids from the emitted events

**Interfaces and stubs** (one file each; the W1 WP named after it implements the file):
- `services/window-state.ts` (WP1): `loadWindowState(file, screens) -> Partial<BrowserWindowConstructorOptions> & {maximized?}` and `trackWindowState(win, file): Disposer`
- `services/quit-guard.ts` (WP1): `installQuitGuard(win, deps: {busyCount, prefs}): Disposer`
- `services/auth-status.ts` (WP1): `AuthStatusService(runner: CliRunner)` with `get(refresh?): Promise<AuthStatus>`
- `services/notification-service.ts` (WP2): `NotificationService({getWindow, prefs, manager, notify?})` with `onSessionEvent(localId, e)`, `setActive(localId | null)` and `dispose()`. The stub is no-ops.
- `services/hotkey-service.ts` (WP2): `HotkeyService({getWindow, register?})` with `apply(h): HotkeyStatus`, `status()` and `dispose()`. The stub returns `{registered: false}`.
- `services/usage-ledger.ts` (WP3): `UsageLedger(file)` with `onSessionEvent(localId, e, info)`. The stub is a no-op.
- `services/usage-service.ts` + `services/transcript-usage.ts` (WP3): `UsageService({root, cacheFile, ledgerFile})` with `summary(q)`. The stub returns an empty, zero-filled summary.
- `services/git-service.ts` (WP4): `GitService({run?})` with `status`, `diff` and `log`. The stub returns `{ok:false, code:'error', message:'not implemented'}`.

**IPC files:**
- `ipc/app.ts`: WP0 adds the new AppInfo fields; WP1 owns the file afterwards.
- New `ipc/prefs.ts` (WP1), `ipc/usage.ts` (WP3) and `ipc/git.ts` (WP4).
- WP0 registers stubs for all of them in `ipc/index.ts`, with validated schemas.

**`main/index.ts`:**
- the single-instance lock
- the dev userData dir (D8) and the AUMID
- `Menu.setApplicationMenu(null)` plus the dev DevTools keys (D11)
- the tightened `will-navigate`
- window state load and tracking; the quit guard
- session event fan-out: `emit -> [renderer send, notifications.onSessionEvent, ledger.onSessionEvent]`
- `hotkey.apply` at startup, and `prefs.onChange(p => hotkey.apply(p.hotkey))`
- `will-quit -> hotkey.dispose()`
- `app:setActiveSession -> notifications.setActive`

**`index.html`:** the CSP additions (D8).

### 2.10 Renderer frozen seams (WP0)
**`workspace-store.ts`:**
- `export const APP_VIEWS = ['chat','settings','mcp','memory','skills','agents','hooks','usage','git','preferences'] as const`, and `AppView = typeof APP_VIEWS[number]`
- `export interface TabRef { convId: string; cwd: string; sessionId?: string; title?: string; openedAt: number; lastActiveAt: number }`
- state: `tabs: TabRef[]`
- actions: `activateTab(convId)`, `closeTab(convId): Promise<void>`, `newTab(cwd?)`, `cycleTab(dir: 1 | -1)`, plus `focusItem?: {kind, name}` with `setFocusItem(...)`
- WP0 lands no-op or pass-through stubs (`newTab` = the current `newSession`). **WP5 owns the file from W1 on.**

**Shell slots:**
- `LeftRail`: the rows Usage and Git (after Hooks), and Preferences pinned under Settings (D12).
- `AppShell` gets lazy placeholders:
  - `features/usage/UsagePage.tsx` (`UsagePage({cwd})`)
  - `features/git/GitPage.tsx` (`GitPage({cwd})`)
  - `features/preferences/PreferencesPage.tsx` (`PreferencesPage()`)
- `AppShell` also gets a `<CommandPalette />` mount point (a placeholder in `features/palette/CommandPalette.tsx`).
- `TitleBar` gets two slots:
  - `<PaletteTrigger />` (a placeholder in `features/palette/PaletteTrigger.tsx`)
  - `<TabStrip />` (a placeholder in `features/tabs/TabStrip.tsx`)

**`lib/commands/types.ts`:**
~~~ts
export type CommandGroup = 'Recent' | 'Tabs' | 'Actions' | 'Navigation' | 'Sessions' | 'Projects' | 'Skills' | 'Commands' | 'Agents' | 'Slash commands'
export interface PaletteCommand {
  id: string; title: string; group: CommandGroup; subtitle?: string; keywords?: string[]
  shortcut?: string[]; icon?: import('lucide-react').LucideIcon; disabled?: boolean
  run(): void | Promise<void>
}
export type CommandSourceHook = () => PaletteCommand[]
~~~

**`lib/composer-bus.ts`** (+test): `setComposerInserter(fn | undefined)` and `insertIntoComposer(text): boolean`, which returns false when no composer is mounted.

**Tokens:**
- `--chart-1..6`, `--chart-grid` and `--chart-axis` go into `docs/design/tokens.css` and its byte-identical renderer copy.
- `theme.css` maps them to the Tailwind colors `chart-1..6`.
- `docs/design/README.md` gets a "Data visualization" section (D5) and the new toast offset (D13 #5).

---

## 3. Work packages

Waves:
- **W0:** WP0 alone.
- **W1:** WP1-WP7 and WP11 in parallel. Merge order: WP5 first (it changes the shell the others render into), then WP6, then the rest.
- **W2:** WP8, WP9, WP10 and WP12 in parallel.
- **W3:** WP13.

| WP | Title | Wave | Depends on |
|---|---|---|---|
| WP0 | Foundation: dependency moves + electron-builder, contracts, paths, prefs service, session-manager accessors, main wiring, renderer seams, chart tokens | W0 | - |
| WP1 | Main: window state, quit guard, auth status, prefs IPC | W1 | WP0 |
| WP2 | Main: notifications and global hotkey | W1 | WP0 |
| WP3 | Main: usage scanner, cache, ledger, adapter `modelUsage` | W1 | WP0 |
| WP4 | Main: git service | W1 | WP0 |
| WP5 | Renderer: multi-tab (store, tab strip, drafts, cap suspension, persistence, shortcuts, background toasts, focus routing) | W1 | WP0 |
| WP6 | Renderer: command palette | W1 | WP0 (uses WP5's tab actions through the frozen stubs) |
| WP7 | Packaging: electron-builder config, icon, `dist:dir` smoke | W1 | WP0 |
| WP11 | P3 follow-ups and polish (lenient frontmatter, assumed ctx window, toasts, scrollbars, checkbox) | W1 | WP0 |
| WP8 | Usage dashboard UI + SVG charts | W2 | WP3 (mocks first) |
| WP9 | Git page | W2 | WP4 (mocks first) |
| WP10 | Preferences page, first-run card, auth hint | W2 | WP1, WP2, WP5 |
| WP12 | Test stability | W2 | all of W1 merged |
| WP13 | Integration, packaged build, live checks, smoke, findings | W3 | all |

### WP0. Foundation (serial, first)
**Owns:**
- everything listed under D14 "WP0 is the sole writer"
- the stubs and placeholders in 2.9 / 2.10
- `src/renderer/stores/workspace-store.ts` (W0 only)
- `src/renderer/app/shell/{AppShell,LeftRail,TitleBar}.tsx` (the slots only, + test mock updates)
- `src/renderer/lib/commands/types.ts`
- `src/renderer/lib/composer-bus.ts` (+test)

**Do:**
1. `package.json`:
   - Move the renderer-only packages to `devDependencies` (D8; versions unchanged).
   - Install `electron-builder` 26.18.0 as an exact-pinned devDependency.
   - Add `productName` and set `version` to 0.4.0.
   - Add the scripts `"dist:dir": "electron-vite build && electron-builder --win dir --publish never"`, `"dist:win": "electron-vite build && electron-builder --win nsis --publish never"` and `"icon": "electron scripts/make-icon.mjs"`.
   - Check that the lockfile diff only adds the electron-builder tree and flips `dev` flags.
2. Contracts 2.1-2.8 and the preload wiring (`app.*`, `prefs.*`, `usage.*`, `git.*`). Schema tests go in a new `src/shared/ipc.p4.test.ts`:
   - git path rejection: absolute, `..`, NUL
   - prefs patch bounds
   - usage `days`
3. Main wiring (2.9):
   - paths (+tests)
   - `PrefsService` (+tests: defaults, merge, a corrupt file is kept)
   - `SessionManager.info` / `busyCount` (+tests: running; waiting; a background task still running after `result`; cleared on `task_ended` / `session_closed`)
   - the stubs, the IPC registration, the `index.ts` wiring and hardening, the CSP
4. Renderer seams (2.10) and the tokens. The token test stays green: both copies are byte-identical, and `theme.css` maps only defined tokens.

**Accept:**
- typecheck, test and build are green
- `npm run dev`:
  - the rail shows Usage, Git and Preferences, and each placeholder renders
  - chat works as in P3
  - the userData dir is `ccwraper-dev`
  - Ctrl+R does not reload
- `out/main/index.js` requires only declared `dependencies` and builtins (a `grep` of `require("` / `import("`)
- `resolveClaudeExecutable()` tests: an asar fixture path maps to `app.asar.unpacked`, and the search never starts at `process.cwd()` inside an asar

### WP1. Main: window state, quit guard, auth status, prefs IPC
**Owns:** `src/main/services/{window-state,quit-guard,auth-status}.ts` (+tests), `src/main/ipc/{app,prefs}.ts` (+tests), `tests/fixtures/auth/**` (synthetic).

**Do:**
1. Window state per D11. The fit-to-display logic is pure, takes injected screen rects, and is tested with a second monitor removed.
2. Quit guard per D11, with an injectable dialog. Tests:
   - busy with the pref on -> the close is prevented and the dialog asks
   - Cancel keeps the window open
   - pref off, or nothing busy -> the window closes
3. `AuthStatusService` per D12:
   - It runs `claude auth status --json` through the `CliRunner`, with the sandbox env in tests.
   - A tolerant mapper handles the unknown JSON shape: it looks for boolean-like logged-in fields and an auth-method string, and drops everything else.
   - Results are cached for 60 s; `refresh` bypasses the cache.
   - Learn the real shape once against `CLAUDE_CONFIG_DIR=D:\claude-tmp\p4-auth-sandbox` (logged out) and record it in the WP notes. The signed-in fixture is synthetic.
   - A test asserts that the mapped object has no keys beyond the contract.
4. IPC:
   - `ipc/prefs.ts`: `get`; `set`, which returns `PrefsSetResult` with `hotkey.status()` from the injected controller; and the `prefs:changed` broadcast.
   - `ipc/app.ts`: `authStatus`, and `setActiveSession` (`ipcMain.on`, validated), which goes to the injected notification sink.

**Accept:**
- the unit tests above
- `npm run dev` restores the window size and position after a restart
- closing during a running turn asks first
- `app.authStatus()` in the sandbox returns `signed_out`

### WP2. Main: notifications and global hotkey
**Owns:** `src/main/services/{notification-service,hotkey-service}.ts` (+tests).

**Do:**
1. `NotificationService` per D3, with the `Notification` constructor injected:
   - A pure `decide(event, ctx) -> {kind, title, body} | undefined`, tested exhaustively.
   - The privacy test feeds events with sentinel strings in the prompt, description, input and result text, and asserts that no sentinel reaches a title or body.
   - A throttle (tested with a fake clock) and task flag tracking.
   - `flashFrame` and the overlay badge.
   - Click -> show, restore and focus the window, then send `app:focusSession`.
2. `HotkeyService` per D4, with an injected `globalShortcut`:
   - A conflict (`false`) and an invalid accelerator (throws) both map to `HotkeyStatus.error`.
   - `apply` unregisters the previous chord first.
   - The toggle behaviour is tested with a fake window.
3. A dev check (no SDK cost):
   - Trigger a fake event through a dev-only hook, or a unit-level harness under Electron.
   - Record whether a Windows toast appears in dev, and the AUMID finding for WP13.

**Accept:**
- the unit tests above
- the WP notes state whether dev toasts appear and which fallback is active

### WP3. Main: usage scanner, cache, ledger
**Owns:**
- `src/main/services/{transcript-usage,usage-service,usage-ledger}.ts` (+tests)
- `src/main/ipc/usage.ts`
- `src/main/services/sdk-adapter.ts` (only the `result` -> `modelUsage` mapping, + its test)
- `tests/fixtures/usage/**` (small synthetic transcripts)

**Do:**
1. `transcript-usage.ts` (a pure core):
   - `scanLines(lines, state) -> buckets`, with the D5 prefilter, the dedupe by `message.id` (max per counter), local-date bucketing (the timezone is injectable) and the `<synthetic>` skip.
   - A streaming file reader with a resume offset that never splits a line: a partial last line is left for the next scan.
2. `usage-service.ts`:
   - File discovery (projects + subagents), the D5 cache, a concurrency of 2, and time-sliced yielding.
   - `summary(q)` builds the `UsageSummary`: zero-filled days, the `cwd` filter by `normalizeCwdKey`, and the cost joined from the ledger by date, cwdKey and model.
3. `usage-ledger.ts`:
   - Keeps the last cumulative `modelUsage` per localId and appends the delta on each `result`.
   - A tolerant reader skips bad lines.
4. Adapter: map `result.modelUsage` to `modelUsage` (per model, `Usage & {costUsd}`).

**Accept (temp dirs only):**
- the dedupe test: 3 lines with the same `message.id` count once
- an appended file is read from the offset (a spy on the bytes read), and its totals equal those of a full rescan
- a truncated file triggers a full rescan
- a corrupt line is counted in `scan.errors` and skipped, and the log line contains no fixture text (a sentinel test)
- the ledger delta: two results for one localId (cost 0.10, then 0.25) record 0.10 and 0.15
- the D5 perf gate on a generated 64 MB file: the cold scan time, the cached re-run and the event-loop p99, with the numbers recorded in the WP notes
- the adapter test: a `modelUsage` with two models maps both

### WP4. Main: git service
**Owns:** `src/main/services/git-service.ts` (+tests), `src/main/ipc/git.ts`.

**Do (D6):**
- Pure parsers:
  - porcelain v2 `-z`: branch headers, ordinary `1`, rename `2`, unmerged `u` and untracked `?` entries; ignored entries are skipped
  - numstat
  - log, split on `\x1f` / `\x1e`
- Path validation and the caps.
- Error mapping: `not a git repository`, `dubious ownership`, ENOENT on the binary, timeout.
- The runner (`execFile`) is injected. An argument-list test asserts:
  - the global flags (`--no-optional-locks`, `core.fsmonitor=false`, and `--no-ext-diff --no-textconv` on diff)
  - that only `status`, `diff`, `log` and `rev-parse` are ever run

**Accept (temp repos created with `git init` in `mkdtemp` dirs; skipped when git is absent):**
- staged, unstaged, renamed and deleted files, an untracked file and an untracked dir, a conflict (made with two branches and a merge in the temp repo), a unicode file name and a path with spaces all come back correct
- ahead / behind against a temp bare remote
- a `.git/config` with `core.fsmonitor = <a script that writes a marker file>`: status runs and the marker never appears
- the `.git/index` mtime is unchanged after `status` (optional locks)
- a 3,000-file untracked set gives `truncated` with `total` 3,000
- the diff of a 2 MB file is `truncated`; a binary file gives `binary`; an untracked text file gives `untrackedText`
- `path: '../x'` and `C:\x` are rejected with `bad_path`

### WP5. Renderer: multi-tab
**Owns:**
- `src/renderer/stores/workspace-store.ts`
- `src/renderer/stores/chat-store.ts` (drafts, `suspend`, the live count; +tests)
- new `src/renderer/features/tabs/**`: `TabStrip.tsx`, `tab-status.ts`, `tab-persist.ts`, `CloseTabDialog.tsx`, `use-tab-shortcuts.ts`, `use-background-attention.ts`, tests
- `src/renderer/app/shell/{TitleBar,SessionList}.tsx`
- `src/renderer/app/shell/AppShell.tsx` (after WP0: the tab wiring and the focus-session listener)
- `src/renderer/features/chat/Composer.tsx` (only the draft in the store and the `composer-bus` inserter)
- `src/renderer/lib/ipc-bridge.ts`

**Do:** all of D2:
- the store and its actions, the tab strip and the title bar layout, the tab status
- drafts, suspension at the cap, the close confirmation, persistence with lazy restore
- shortcuts (ignored inside `.xterm`) and the background permission toasts
- reporting with `app.setActiveSession`, and routing from `app.onFocusSession`
- the SessionList "open in a tab" behaviour: an "open" dot on rows whose session has a tab

**One live check** (dev app, haiku, scratch project `D:\claude-tmp\p4-live`, under $0.05): two tabs streaming at once, switching between them mid-stream. Both transcripts complete correctly and the composer drafts survive.

**Accept** (Testing Library with a mocked `window.ccwrap`):
- Opening and switching:
  - opening a history session twice activates the same tab
  - a draft typed in tab A survives a switch to B and back
- The cap:
  - the 6th live start suspends the least recently used idle conversation (`session.close` is called and `resumeSessionId` is set), and its next submit calls `session.start` with `resumeId`
  - with 5 busy conversations, the start fails with the D2 message
- Closing a running tab asks first, then calls `interrupt` and `close`.
- Status and attention:
  - the tab dot reflects running / waiting / error / unread, and unread clears on activation
  - a background `permission_request` raises the toast, and Show activates the tab
- `tabs.v1` round trip: the restore creates history tabs without loading their transcripts until each is activated.
- Shortcuts: Ctrl+W inside a `.xterm` element does nothing; Ctrl+Tab cycles.
- Main integration:
  - `onFocusSession` activates the right tab and the chat view
  - `setActiveSession` is sent on activation and on bind
- The tab strip stays `no-drag` and the drag gap exists (a style assertion).

### WP6. Renderer: command palette
**Owns:** `src/renderer/features/palette/**` (`CommandPalette.tsx`, `PaletteTrigger.tsx`, `fuzzy.ts`, `recent.ts`, `sources/*.ts`, tests) and `src/renderer/lib/commands/**` except `types.ts`.

**Do:** all of D7:
- the registry and the source hooks (navigation, tabs, actions, sessions, projects, items, slash commands)
- the fuzzy scorer and the recents
- the dialog UI with the highlight pill and scroll-into-view
- the shortcuts (Ctrl+K skipped inside `.xterm`; Ctrl+Shift+P always) and the title-bar trigger

**Accept:**
- `fuzzy.ts` unit tests: `gst` ranks "Git status" above "Toggle settings"; word-start and consecutive bonuses; keywords weigh less
- every `APP_VIEWS` entry has a Navigation command, and running it calls `setView`
- arrowing down past the visible area calls `scrollIntoView` on the new row (a spy)
- Enter runs the command, closes the palette and records it in the recents (max 8, deduped)
- a slash command inserts `/<name> ` through `composer-bus`
- an item command switches to the Skills page with `focusItem` set
- Ctrl+K with the focus inside `.xterm` does not open the palette; Ctrl+Shift+P does
- ARIA: `combobox` / `listbox` / `option`, and `aria-activedescendant` follows the selection
- the palette chunk is lazy (not in the renderer entry)

### WP7. Packaging
**Owns:** `electron-builder.yml`, `build/icon.png`, `scripts/make-icon.mjs`, `scripts/check-main-deps.ts`, and the packaging section of `README.md`.

**Do:**
1. Everything in D8: the config, the icon script and the committed PNG, and the main-deps check.
2. Run `npm run dist:dir`.
3. Do a manual packaged smoke of `dist\win-unpacked\ccwraper.exe`, launched with `CLAUDE_CONFIG_DIR=D:\claude-tmp\p4-pkg-cfg` and `--user-data-dir=D:\claude-tmp\p4-pkg-ud`:
   - the window opens, the fonts load, and the console shows no CSP violations
   - `app.info()` shows `packaged: true`, the version and the userData dir
   - the terminal opens pwsh and Git Bash; `OpenConsole.exe` runs from `...\resources\app.asar.unpacked\node_modules\node-pty\prebuilds\win32-x64\conpty\`; typing `exit` leaves no descendants
   - with `CCWRAP_CLAUDE_SOURCE=bundled`, `app.info().claudePath` is under `app.asar.unpacked`
   - **one** haiku "Reply with just the word hi" turn with the bundled binary and the **real** config (the sandbox has no login), cwd `D:\claude-tmp\p4-live`, under $0.02
   - a second launch focuses the first window (single instance)
4. Run `npm run dist:win` once and record the installer size and the build time. **Do not run the installer.**

**Accept:**
- the checks above pass, or the D8 `asar: false` fallback is applied and recorded
- the outputs are in `dist/`, and nothing changed outside the owned files
- `git status` shows no stray build artifacts (`dist/` is ignored)

### WP8. Usage dashboard UI
**Owns:** `src/renderer/features/usage/**` (`UsagePage.tsx`, `queries.ts`, `KpiRow.tsx`, `DailyChart.tsx`, `ProjectsChart.tsx`, `ModelsTable.tsx`, tests) and new `src/renderer/components/charts/**` (`scale.ts`, `StackedBars.tsx`, `HBars.tsx`, `ChartTooltip.tsx`, `ChartTable.tsx`, tests).

**Do (the D5 UI):**
- Filters: the range (7 / 30 / 90 / 365 days) and the project (All / current).
- KPIs:
  - tokens, with the in / out / cache split
  - messages and sessions
  - cost, with its source note, or "No in-app sessions yet" when there is no ledger
- Charts:
  - the daily stacked bars, with a toggle between by token kind and by model
  - the top projects
  - the models table with inline bars
- The scan footer (files, cached, time, errors) and a Rescan button (`force: true`).
- Loading and empty states.
- `formatTokens` is imported read-only from chat activity.

**Accept:**
- `scale.ts` tests: nice ticks for 0, 1, 999 and 1.2M; a band scale over 30 days
- a fixture summary renders the right bar heights (the `scaleY` attribute) and its colors from chart classes (no hex; the guard)
- the Table toggle shows the same numbers
- hovering a bar shows the tooltip with tabular numbers; keyboard focus on a bar shows it too
- reduced motion: no transform transition
- the cost KPI copy matches D5; with `cost.since` undefined it shows the empty note
- the page chunk is lazy

### WP9. Git page
**Owns:** `src/renderer/features/git/**` (`GitPage.tsx`, `queries.ts`, `ChangeList.tsx`, `CommitList.tsx`, `patch-rows.ts`, tests). `DiffView` and `computeDiff` are imported read-only.

**Do (the D6 UI):**
- The header: the branch (or detached), the upstream with ahead / behind, the root, Refresh, and the read-only note.
- The Changes and History tabs, with grouped lists showing status letters and counts.
- The diff pane:
  - a patch is turned into rows
  - untracked text shows as all-added
  - binary, truncated and directory entries show a note
- The commit list, with copy hash.
- The states: not a repo, git missing, an unsafe repo (with git's message), timeout.
- The refresh triggers: mount, window focus, a same-project `result` + 500 ms, and the button.
- Virtualization above 200 rows.

**Accept:**
- `patch-rows.ts` tests: line numbers in a multi-hunk patch, `\ No newline at end of file` ignored, a rename header
- a mocked status renders the groups; selecting a staged row calls `git.diff` with `staged: true`
- the truncated banner shows "Showing first 2,000 of N changes"
- the error states render their copy
- a `result` event for the same cwd triggers one refetch after 500 ms (fake timers); one for another cwd does not
- there is no stage, commit or discard control anywhere (a label and API assertion)

### WP10. Preferences, first-run card, auth hint
**Owns:**
- `src/renderer/features/preferences/**`
- `src/renderer/features/onboarding/**` (`FirstRunCard.tsx`, `auth-hint.ts`, tests)
- `src/renderer/features/chat/ChatView.tsx` (only the auth hint next to errors)
- the `Notice` "Select a project" slot in `AppShell.tsx`, which renders `FirstRunCard` (a one-line change, coordinated after WP5 merges)

**Do (D12):**
- The Preferences sections:
  - Notifications
  - Global hotkey, with an accelerator capture input that builds Electron accelerator strings from a `KeyboardEvent`
  - Quit confirmation
  - Terminal default shell
  - About
- The first-run checklist, with the Sign in action (the terminal bus types `claude auth login` without executing it) and Open folder.
- The `auth-hint.ts` matcher and the hint in chat.

**Accept:**
- toggling a pref calls `prefs.set` with the minimal patch; a `hotkey.error` shows next to the field
- the capture input turns Ctrl+Alt+Space into `Control+Alt+Space`, and rejects a chord without a modifier
- About shows the AppInfo fields and "Updates: manual"
- the first-run card:
  - shows the signed-out state with the Sign in action (the terminal bus receives the text and no `\r`)
  - hides when all checks pass, or when it is dismissed (persisted)
- an "Invalid API key" error in chat shows the hint; an unrelated error does not

### WP11. P3 follow-ups and polish
**Owns:**
- `src/shared/frontmatter.ts` + test (the carve-out)
- `src/main/services/items-service.ts` (+test; only the `warning` mapping)
- `src/renderer/features/items/**` (the lenient chip and the Quote values action)
- `src/renderer/app/shell/StatusBar.tsx` and `src/renderer/features/chat/model/selectors.ts` (the assumed window, with its `~` and tooltip)
- `src/renderer/components/ui/{toaster,checkbox}.tsx` (+ the index export, tests)
- `src/renderer/styles/base.css` (the scrollbar rule)
- `src/renderer/components/editor/cm-theme.ts` (the checkboxes)
- `src/renderer/features/hooks/HooksConfirmDialog.tsx` (switches to `Checkbox`)

**Do:** D13 #3-#6.

**Accept:**
- Lenient parsing:
  - `quoteUnsafeScalars` quotes `description: Use this agent: when ...`, and leaves already-quoted values, block scalars, lists and the body untouched
  - the lenient parse returns `data.description` with `lenient.keys = ['description']`
  - text that is valid strict YAML never sets `lenient`
- The UI for a lenient file:
  - the listing has a `warning` and no `error`, and shows the chip instead of "Broken"
  - Quote values makes the buffer dirty with the fixed text, and the Form becomes editable after saving
- ctx on a fresh profile: `~` with the "assumed" tooltip before the first result, the cached value after it.
- Polish: the toaster offset is 88; the hooks dialog uses the token checkbox with a visible focus ring; no hex.

### WP12. Test stability
**Owns:** the test files it identifies as flaky. The list goes to the lead before editing; production code changes only with the lead's OK.

**Do:**
- Run `npm test` 10 times, including runs with a parallel CPU load (a busy loop in another process). Collect the failures from `--reporter=json`.
- Find the root cause of each (real timers, chokidar timing, `setTimeout` races) and fix it with fake timers or condition-based waits.
- Record the flake counts before and after.

**Accept:**
- 10 consecutive green runs, including 3 under load
- no global `retry` added
- any remaining real-time test (chokidar) uses an explicit `waitFor` with a reasoned timeout

### WP13. Integration, packaged build, live checks, smoke, findings (finishes last)
**Owns:** `README.md` (run, packaging, signing and update notes), `docs/P4-FINDINGS.md` (new), `scripts/cdp-smoke.ts`, and `scripts/cdp-client.ts` (a `CCWRAP_SMOKE_EXE` launch option for the packaged exe). Cross-file fixes only with the lead's OK.

**Checklist:**
1. **Gates:** typecheck, test and build are green. Record the chunk sizes: the entry, the palette, usage, git, preferences, and the tab strip inside the entry.
2. **Sandboxed run** (`CLAUDE_CONFIG_DIR=D:\claude-tmp\p4-cfg`, `--user-data-dir=D:\claude-tmp\p4-ud`, project `D:\claude-tmp\p4-live`, and a temp git repo `D:\claude-tmp\p4-repo`):
   - **Preferences:**
     - the toggles persist in `p4-ud\prefs.json`
     - enabling the hotkey registers it, or shows the conflict message
     - the first-run card shows the signed-out state, with the Sign in action typing (not running) the login command
   - **Git page on `p4-repo`:**
     - staged, unstaged, untracked, rename and conflict rows, their diffs, and the history
     - the `.git\index` mtime is unchanged
     - the fsmonitor marker test is repeated live
   - **Palette:** every view is reachable; scroll-into-view works on a long Sessions list; the recents work.
   - **Usage:** synthetic transcripts are generated (not copied from real ones) into `p4-cfg\projects`, and the totals match a hand count.
   - **Lenient frontmatter:** a synthetic agent with an unquoted `: ` shows the chip, and Quote values fixes it.
3. **Real config run** (user scope stays read-only; chats only in `D:\claude-tmp\p4-live`, on haiku):
   - **Tabs:**
     - three tabs: two live, one history
     - two turns streaming at once, switching mid-stream
     - a background permission -> the toast -> Show
     - minimize -> an OS notification (or the recorded fallback) -> clicking it focuses the right tab
     - quitting during a turn asks first
   - **Cap:** open 6 live sessions. The least recently used idle one is suspended, and resumes on its next prompt.
   - **P3 gaps:**
     - start a long background agent (for example "Use the Agent tool to run `Start-Sleep 30` in Bash, then list the files"), then press Stop agent on its card -> `task_ended stopped`
     - a second run: Esc while the agent runs -> stopping, then stopped, with no orphan running state
     - the unprompted-turn fix after a background agent finishes
     - ctx `~` on the first turn of a fresh `--user-data-dir`
   - **Frame times:** p95 under 20 ms with one subagent streaming, and with two tabs streaming.
   - **Usage on real transcripts:**
     - record the cold scan time, the cached re-scan time, the file count and the event-loop p99
     - **write no project names, prompts or per-session details into the findings**, only counts and timings
   - **Real Agents page:** the agent that showed "Broken" in P3 now shows the lenient chip (display only, no save).
   - **Unchanged files:**
     - the `sha1` of `~/.claude/settings.json` and `CLAUDE.md`, and the `skills` / `agents` listings, are identical before and after
     - `git status` of the ccwrap repo is unchanged by the Git page
   - **Auth status:** run `app.authStatus()` once and record only the state value.
4. **Packaged:**
   - Run `npm run dist:dir`, then `npm run smoke` with `CCWRAP_SMOKE_EXE=dist\win-unpacked\ccwraper.exe` and the sandbox config. It checks the fonts, every page (including Usage, Git and Preferences), the palette, the terminal, and a tab open / close.
   - `npm run dist:win` builds the installer; record its size.
   - **Running the installer, the installed-app toast and a Start-menu launch are listed as human steps.**
5. **Smoke script:** `scripts/cdp-smoke.ts` visits Usage, Git and Preferences, opens the palette (Ctrl+K, type, Enter) and opens and closes a second tab. `CCWRAP_SMOKE_LIVE=1` keeps the P3 subagent turn.

**Accept:** the checklist passes, or each failure is recorded with a decision. `docs/P4-FINDINGS.md` records:
- the live API cost
- the notification / AUMID outcome in dev, in `win-unpacked` and (human step) installed
- the usage scan performance, and the time-slice vs worker decision
- the packaged facts: the asar unpack result, the claude path, the installer size, the build time
- the P3 gap results: Stop agent, Esc, frame times, the unprompted turn, ctx on the first turn
- the deviations:
  - no `cmdk` (D7) and no sqlite (D1)
  - git as a main view (D6)
  - cost only for in-app sessions (D5)
  - auto-update deferred (D10) and unsigned builds (D8)
  - dark only (D12)
  - the hotkey off by default, and no tray (D4)
  - the dev userData `ccwraper-dev` (D8)
- the v1 readiness checklist for the lead (the 1.0.0 version bump is the lead's call)

---

## 4. Collision map (who may edit what after WP0)
**Lead only:**
- `package.json`, the lockfile, `electron.vite.config.ts`
- `src/shared/**` (except `frontmatter.ts` + test, which are WP11's)
- `src/preload/**`, tsconfigs, `vitest.config.ts`, `tests/setup-*.ts`
- `src/main/index.ts`, `src/main/ipc/index.ts`, `src/main/paths.ts`, `src/main/services/{prefs-service,session-manager}.ts`
- `docs/design/**`, `src/renderer/styles/{tokens,theme}.css`, `src/renderer/index.html`
- `src/renderer/lib/commands/types.ts`, `src/renderer/lib/composer-bus.ts`, `src/renderer/app/shell/LeftRail.tsx`

**Main:**
- WP1: `window-state*`, `quit-guard*`, `auth-status*`, `ipc/app.ts`, `ipc/prefs.ts`
- WP2: `notification-service*`, `hotkey-service*`
- WP3: `transcript-usage*`, `usage-service*`, `usage-ledger*`, `ipc/usage.ts`, `sdk-adapter.ts` (only the `modelUsage` mapping)
- WP4: `git-service*`, `ipc/git.ts`
- WP11: `items-service.ts` (only the `warning` field)
- Untouched:
  - `config-service`, `config-watcher`, `mcp-service`, `pty-service`, `history-service`, `sdk-history`, `sdk-settings`, `trash`
  - `shells`: WP4 imports its Git Bash detection read-only
  - `atomic-write`: WP0 and WP3 import it read-only

**Renderer:**
- WP5: `stores/{workspace-store,chat-store}.ts`, `features/tabs/**`, `app/shell/{TitleBar,SessionList,AppShell}.tsx`, `features/chat/Composer.tsx` (only the draft and the inserter), `lib/ipc-bridge.ts`
- WP6: `features/palette/**`, `lib/commands/**` except `types.ts`
- WP8: `features/usage/**`, `components/charts/**`
- WP9: `features/git/**`
- WP10: `features/preferences/**`, `features/onboarding/**`, `features/chat/ChatView.tsx` (only the auth hint), and the one `AppShell.tsx` line after WP5 merges
- WP11: `features/items/**`, `app/shell/StatusBar.tsx`, `features/chat/model/selectors.ts`, `components/ui/{toaster,checkbox,index}.tsx`, `styles/base.css`, `components/editor/cm-theme.ts`, `features/hooks/HooksConfirmDialog.tsx`
- Read-only in P4:
  - `features/{settings,mcp,memory,terminal}/**` (WP10 calls the terminal-store setter and the terminal bus)
  - `features/chat/**` beyond the lines above
  - `stores/dirty-registry.ts`

**Packaging:**
- WP7: `electron-builder.yml`, `build/**`, `scripts/{make-icon.mjs,check-main-deps.ts}`
- WP13: `scripts/cdp-*.ts`, `README.md`, `docs/P4-FINDINGS.md`

**SDK imports** stay limited to `sdk-adapter.ts`, `sdk-history.ts` and `sdk-settings.ts`. `transcript-usage.ts` reads the JSONL directly and imports nothing from the SDK.

## 5. Project-specific risks found while reading
| Risk | Where | Mitigation |
|---|---|---|
| The SDK resolves `claude.exe` inside `app.asar`, where it cannot be spawned; `bundledClaudePath` does the same | SDK `createRequire().resolve`, `paths.ts` | `asarUnpack` the win32-x64 package; always pass an explicit `toUnpackedPath` path (WP0); the packaged smoke proves it with `CCWRAP_CLAUDE_SOURCE=bundled` (WP7) |
| `readSdkVersions` and `bundledClaudePath` search from `process.cwd()` first, so a packaged app could load a foreign SDK | `paths.ts` | Inside an asar, start at `__dirname` only (WP0) |
| node-pty's conout worker path rewrite covers `node_modules.asar`, not `app.asar` | `windowsConoutConnection.js` | `asarUnpack` node-pty; verify in `win-unpacked`; fallback `asar: false` (WP7) |
| electron-builder would ship every renderer dependency in `app.asar/node_modules` | `package.json` | Move the renderer-only deps to devDependencies; the main-deps check (WP0, WP7) |
| A tab switch remounts `ChatView`, and the composer draft is local state | `AppShell`, `Composer` | Drafts in `chat-store` (WP5) |
| With tabs, the 5-session cap is reached quickly, because sessions stay live between turns | `SessionManager` | Suspend the least recently used idle conversation and resume it on demand (WP5) |
| The default Electron menu: Ctrl+W closes the window and Ctrl+R reloads (orphaning live main sessions) | Electron defaults | `Menu.setApplicationMenu(null)`, dev-only DevTools keys (WP0) |
| `will-navigate` allows any `file://` URL | `main/index.ts` | Allow only the app's own URL (WP0) |
| `git status` can take `index.lock` while the CLI runs git; repo config can execute programs (`core.fsmonitor`, external diff, textconv) | the git panel | `--no-optional-locks`, `GIT_OPTIONAL_LOCKS=0`, `core.fsmonitor=false`, `--no-ext-diff --no-textconv`; a marker-file test (WP4) |
| Parsing 60 MB+ transcripts blocks the main event loop, which also relays live session events | WP3 | The prefilter, the offset cache, time-slicing with a measured gate; the worker fallback |
| Transcripts repeat the usage per content block, so naive sums overcount | the transcript format | Dedupe by `message.id` (a WP3 test) |
| Transcripts carry no cost, and a price table would be wrong | usage | Exact cost only from the in-app ledger, labelled as such (D5) |
| Notification text ends up in the Windows Action Center | WP2 | Names, types and durations only; a sentinel test |
| With an unregistered AUMID, toasts may not show in dev or `win-unpacked` | Windows | The `flashFrame` + overlay badge fallback; the installed check is a human step |
| The `claude auth status` output may include account details, and its shape is undocumented | WP1 | Map it to a 3-state enum and drop the rest; learn the shape only in a sandbox config |
| Global shortcuts steal system-wide chords | WP2 | Off by default, conflicts reported, unregistered on quit |
| Dev and packaged builds share `%APPDATA%\ccwraper` | `app.getPath('userData')` | Dev uses `ccwraper-dev` (WP0) |
| Live runs load the user's real hooks and plugins (as in P2 / P3) | WP5, WP7, WP13 | Chats only in the scratch project, on haiku, within the D14 budgets |
| The harness classifier blocked the P3 live driver | WP13 | When blocked, record the exact manual steps; never weaken the safety rules to get around it |
