# P2 Plan (config editors + terminal)

Date: 2026-10-30. Inputs: `SPEC.md` (v0.1, sections 5, 7, 8, 9, 10, 10.1), `docs/P1-PLAN.md`, `docs/P1-FINDINGS.md`, `docs/design/README.md`, current `src/` (P1 complete, 149 tests).
P2 scope (SPEC section 8): settings editor (form + raw JSON + precedence view), MCP manager, `CLAUDE.md` editor, embedded terminal (xterm.js + node-pty, themed per 10.1). Plus the P1 follow-ups listed in D9.

Out of P2 (deferred on purpose): skills / commands / agents / hooks editors (P3); command palette, inspector panel, multi-tab, terminal split panes, clickable file paths that open an editor (need the inspector), MCP enable/disable toggle and OAuth login (both write `~/.claude.json`), thinking on/off toggle, image thumbnails, per-kind virtualizer estimates, packaging (P4); sqlite (D8).

---

## 1. Decisions

All facts below were checked read-only on this machine on 2026-10-30 (npm registry, scratch-dir probes, `claude mcp --help`). Nothing was installed into the repo.

### D1. node-pty 1.1.0 from its shipped N-API prebuilds. No electron-rebuild, no node-gyp.
- `node-pty@1.1.0` (published 2026-10-23) ships `prebuilds/win32-x64/{pty,conpty,conpty_console_list}.node` plus `conpty/conpty.dll`, `OpenConsole.exe`, `winpty.dll`, `winpty-agent.exe`. Its install script is `node scripts/prebuild.js || node-gyp rebuild`; `prebuild.js` exits 0 when `prebuilds/<platform>-<arch>` exists, so **node-gyp never runs** (unless `npm_config_build_from_source=true`, which must stay unset).
- The addons are N-API (`node-addon-api`), so they are ABI-stable. Probe (tarball extracted in a scratch dir, `pty.spawn('cmd.exe', ['/c','echo PTY_OK'])`): **works under Node 26.2.0 and under Electron 45.1.0** (`ELECTRON_RUN_AS_NODE`), exit 0 with output. So vitest (Node 26) and the app (Electron's Node 24.22) load the same binary.
- Toolchain on this machine: only VS 2019 BuildTools has MSVC (14.29); the VS 2022 / 18 Enterprise installs have no VC tools. Compiling against Electron 45 headers (C++20) with 14.29 is a real risk, so `@electron/rebuild` is **not** added. If a future node-pty drops win32 prebuilds, pin back to 1.1.0 and tell the lead.
- Main is bundled CJS and electron-vite 6 externalizes `dependencies` by default (`build.externalizeDeps: true`; the current `out/main/index.js` already does `require("zod")`). So `import * as pty from 'node-pty'` becomes a runtime `require` from `node_modules`. No `electron.vite.config.ts` change.
- **P4 packaging note (record, do not act):** electron-builder needs `asarUnpack: ["node_modules/node-pty/**"]`. On Windows node-pty starts `lib/worker/conoutSocketWorker.js` with `worker_threads.Worker(path)` and only rewrites `node_modules.asar` (not `app.asar`) to `.unpacked`. The packaged worker path must be verified in P4; the fallback is `asar: false` for that module or a tiny patch.
- ConPTY mode: node-pty default (system ConPTY, Windows build >= 18309). `useConptyDll` (bundled OpenConsole) stays off; it's a one-flag fallback if rendering glitches appear.

### D2. xterm.js 6 package set
Pin exactly: `@xterm/xterm` 6.0.0, `@xterm/addon-webgl` 0.19.0, `@xterm/addon-fit` 0.11.0, `@xterm/addon-search` 0.16.0, `@xterm/addon-web-links` 0.12.0, `@xterm/addon-unicode11` 0.9.0 (one release train, no peer ranges declared).
- WebGL: load `WebglAddon` after `term.open()` inside try/catch; on throw or `onContextLoss` dispose it and stay on the DOM renderer (xterm 6 has no canvas renderer). No CSP change: no eval, no WASM; xterm's injected `<style>` is covered by the existing `style-src 'self' 'unsafe-inline'`.
- **Not added: `@xterm/addon-ligatures`.** It depends on `font-finder` / `font-ligatures`, which read system fonts through Node `fs`. Our renderer is sandboxed with no Node. SPEC 10.1 "ligatures on" is deferred (deviation, recorded in findings).
- Not added: `@xterm/addon-clipboard` (OSC 52). The Copy button uses `navigator.clipboard.writeText(term.getSelection())`.
- web-links: the default handler calls `window.open`, which the existing `setWindowOpenHandler` turns into `shell.openExternal` for http(s). Nothing else is needed.
- Fonts: fontsource registers the families as **`Geist Variable` / `Geist Mono Variable`**, not `Geist` / `Geist Mono` (see D9 bug 1). The terminal uses the corrected mono stack and must `await document.fonts.load('13px "Geist Mono Variable"')` before `term.open()`, otherwise the cell metrics are measured on the fallback font.

### D3. Editor: CodeMirror 6, not Monaco, not a plain textarea
Packages (exact): `@codemirror/state` 6.7.6, `@codemirror/view` 6.43.15, `@codemirror/commands` 6.11.1, `@codemirror/language` 6.13.1, `@codemirror/lint` 6.9.7, `@codemirror/search` 6.7.2, `@codemirror/lang-json` 6.0.2, `@codemirror/lang-markdown` 6.5.2, `@lezer/highlight` 1.2.5. No `@uiw/react-codemirror` wrapper (an own ~80-line wrapper handles StrictMode double-mount and controlled value).
Why:
- CSP: neither CodeMirror nor Monaco needs WASM. But Monaco needs web workers wired through Vite `?worker` imports, and that path is untested on Vite 8 / rolldown + electron-vite 6. CodeMirror has no workers.
- Size: Monaco 0.57 is about 4-5 MB of JS+CSS for two small editors. The CodeMirror set with JSON + Markdown is about 300 KB. Both are lazy-loaded (`React.lazy`) so chat startup is not affected.
- Theming: CodeMirror themes are CSS against our token variables (`var(--bg-1)`, `--accent-text`, ...), so the no-hex rule holds. Monaco themes need literal hex colors.
- TS7: both ship their own `.d.ts` with no TS-compiler dependency. No difference.
- A plain textarea gives no JSON lint, bracket matching, search or line numbers. Too weak for a raw settings editor.
- What we lose: Monaco's JSON-schema IntelliSense. Semantic problems come from zod schemas instead (section 2.5). **SPEC deviation** (SPEC section 1 says Monaco). The `CodeEditor` component interface stays editor-agnostic, so P3 can swap or add Monaco if an inspector needs it.

### D4. ConfigService: own atomic write, conflict detection, backups outside the project, chokidar 6
- **Atomic write (no new dependency):** write `<file>.ccwrap-<rand>.tmp` in the same directory, `fsync`, `rename` over the target. On Windows, retry `EPERM` / `EBUSY` / `EACCES` up to 5 times with 20-200 ms backoff (antivirus, or the CLI holding the file). `mkdir -p` the parent (`<proj>/.claude/`). Delete the temp file on failure. `write-file-atomic` 8 adds nothing we need.
- **Optimistic concurrency:** every read returns `hash` (sha256 of the bytes, `null` when the file is missing). Every write carries `baseHash`. Main re-reads the file right before writing. If the hash differs, it returns `{ok:false, code:'conflict', current}` and writes nothing. This is how we stay safe against the running CLI (for example "Always allow" writes `settings.local.json` while the editor is open). The UI offers "Reload" or "Overwrite" (overwrite = write again with `current.hash`).
- **Preserve unknown keys:** the raw editor writes the user's text verbatim after `JSON.parse` succeeds and the root is an object. The form never re-serializes from a schema: it applies path patches (`set` / `delete`) onto the parsed current file and serializes with the file's detected indent (default 2) and EOL, plus a trailing newline. Key order is kept, and untouched keys keep their values exactly. If the file on disk does not parse (comments, broken JSON), the form is read-only and only the raw editor is offered. We never overwrite a file we couldn't parse unless the user saves valid JSON from the raw editor.
- **Backups: one before the first write per file per app run, stored under `app.getPath('userData')/backups/`** as `<first 12 hex of sha1(path)>-<basename>.<timestamp>.bak`, keeping the last 5 per file. **SPEC deviation (location):** a `.claude/settings.json.bak` next to project files would get committed to the user's repo. Main logs the backup path; the editors show "Backup saved" in the save toast.
- **Watching: `chokidar` 6.0.0.** It is ESM-only (`type: module`, engines node >= 22.22; Electron's Node 24.22 qualifies), so load it with `await import('chokidar')`, the same pattern as the SDK in `sdk-adapter.ts`. Watch explicit file paths only (chokidar 4+ has no globs), `ignoreInitial: true`, `atomic: true`, 150 ms per-path debounce. Watched set:
  - always: user `settings.json`, user `CLAUDE.md`, the global `.claude.json`
  - for the active project (`config:watchProject`): `.claude/settings.json`, `.claude/settings.local.json`, `.mcp.json`, `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`

  Missing files are watched too (chokidar watches the parent), so creation is reported.
- `.claude.json` is rewritten by the CLI on every turn. The watcher debounces it by 500 ms and emits `fs:changed {kind:'mcp'}` **only when the MCP slice** (top-level `mcpServers` plus the active project's `mcpServers` / `enabledMcpjsonServers` / `disabledMcpjsonServers`) hashes differently from the last emit.
- **Own-write suppression:** after a successful write, main remembers `{path, hash}`. A change event whose current hash equals it is dropped.
- **Config root:** honour `CLAUDE_CONFIG_DIR`. Probed: with it set, the CLI writes `$CLAUDE_CONFIG_DIR/.claude.json` and `$CLAUDE_CONFIG_DIR/backups/`. User settings and memory live in `$CLAUDE_CONFIG_DIR/` (default `~/.claude/`). The global file is `$CLAUDE_CONFIG_DIR/.claude.json` when the variable is set, else `~/.claude.json`. All of this is in `paths.ts` (WP0) and is the base of test isolation (D10).
- **Renderer never sends paths.** Files are addressed by a typed `ConfigFileRef` (`{kind:'settings', scope, cwd?}` / `{kind:'memory', scope, cwd?}`). Main resolves the path, so a compromised renderer cannot write arbitrary files.
- Note: this user has a `~/.claude/settings.local.json` (5.7 KB). The CLI does not load it (it is absent from the `resolveSettings` sources, D5), and the editor does not show it.

### D5. Settings precedence view: the SDK's `resolveSettings()`
SDK 0.3.312 exports `resolveSettings({cwd, settingSources?})` (alpha) and `filterEscalatingDefaultMode(resolved)`. It uses "the same merge engine as the CLI, without spawning the Claude CLI". It returns:
- `effective`
- `provenance` (the winning source per top-level key)
- `sources[]`, low to high precedence, each `{source:'user'|'project'|'local'|'flag'|'managed', settings, path?, policyOrigin?}`

The managed tier includes `managed-settings.json` (Windows `C:\Program Files\ClaudeCode\managed-settings.json`, not present here) and HKLM/HKCU policy via `reg.exe`. Probe (key names only, read-only): 121 ms under Node 26, 114 ms under Electron 45; it listed the user source with its path and the provenance per key.
Semantics:
- **Order** comes from `sources` as returned (low to high). Typical: user < project < local < flag < managed. Never hardcode it.
- **Scalars and objects** (model, env, statusLine, ...): the winner is `provenance[key]`. Every other layer that sets the key is shown as "overridden by <source>".
- **`permissions.allow` / `ask` / `deny` and `additionalDirectories`** are merged across scopes, not overridden. The view lists every rule tagged with its source, with a caption: deny beats ask beats allow.
- **`permissions.defaultMode`:** run `filterEscalatingDefaultMode`. If it filters out an escalating mode (`bypassPermissions` / `auto` / `acceptEdits`) from a project-committed file, show "ignored (untrusted project scope)".
- **`env` values are masked** (reveal per row) in the form and precedence views (SPEC 10.1: no env secrets echoed), and never logged in main. The raw editor shows the file as-is (it is the user's own file).
- `managed` and `flag` rows are read-only.
- **SPEC deviation:** a third SDK boundary file, `src/main/services/sdk-settings.ts` (dynamic import; SDK types stay inside; maps to `ResolvedSettingsView`).

### D6. MCP: read the files directly, mutate through the `claude mcp` CLI
Probed with a fully redirected home (`USERPROFILE`, `HOME` and `CLAUDE_CONFIG_DIR` all pointing at a scratch dir). Afterwards the real `~/.claude.json` contains no probe entry.
- `claude mcp add-json <name> '<json>' -s <scope>` prints `Added <transport> MCP server <name> to <scope> config` and exits 0. Where each scope writes:
  - user: `cfg/.claude.json` top-level `mcpServers`
  - project: `<cwd>/.mcp.json`
  - local: `cfg/.claude.json` `projects["D:/.../mcp-proj"].mcpServers`

  The CLI keeps its own `.claude.json` backups.
- Duplicate name: exit 1, `MCP server <name> already exists in user config`. Bad JSON: exit 1, `Invalid configuration: ...`.
- `claude mcp remove <name> -s <scope>`: exit 0. A missing name exits 1 with `No MCP server named "<name>" in user scope`. Removing the last project server leaves `{"mcpServers": {}}`.
- `claude mcp get <name>` health-checks that one server (it spawns it). It prints `Scope:`, `Status: ✓ Connected | ✘ Failed to connect | ⏸ Pending approval`, `Issue:`, `Type:`, ... and **exits 0 even when the connection fails**. A missing name exits 1.
- `claude mcp list` health-checks **every** server, so it is not used for listing.
- **Key spelling:** the CLI wrote the local-scope project key with forward slashes (`D:/claude-tmp/...`), while the user's real file has backslash keys (`D:\code\...`). Matching must apply `normalizeCwdKey` to both sides.

Decision:
- **List = read files** (fast, no server spawns):
  - User: global `.claude.json` `mcpServers`.
  - Local: global `projects[<key matching cwd>].mcpServers`.
  - Project: `<cwd>/.mcp.json`.
  - Project-server approval comes from settings (`enableAllProjectMcpServers`, `enabledMcpjsonServers`, `disabledMcpjsonServers` from `resolveSettings` effective) plus the global project entry's `enabledMcpjsonServers` / `disabledMcpjsonServers`.
  - Main extracts **only** these slices. Nothing else from `.claude.json` (it holds `oauthAccount`, `userID`, caches) ever crosses IPC.
  - Same-name shadowing: local > project > user.
  - Live status (connected / failed / needs-auth, including plugin and claude.ai connectors that live in no file) is joined in the renderer from the latest `init.mcp` of a live session in that cwd.
- **Mutations = CLI.** `execFile` with an argument array (never a shell), cwd = the project dir, `windowsHide`, 30 s timeout.
  - Binary: `resolveClaudeBinary().path`, else the SDK's bundled `node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe` (exists here). `.cmd` shims are never used (quoting).
  - add = `add-json`; remove = `remove -s <scope>`.
  - update / rename = read the old config, `remove`, then `add-json` the new one. If `add-json` fails, `add-json` the old config back and report both outputs.
  - test = `get <name>` (45 s timeout). Parse the `Status:` line into `connected | failed | pending | needs_auth | unknown` and always return the raw output.
- Project-server approval ("Approve" / "Reject"): a renderer-side settings patch of `.claude/settings.local.json` `enabledMcpjsonServers` / `disabledMcpjsonServers` through `config:write`. These are documented settings keys, so no `.claude.json` write.
- We never write `~/.claude.json` ourselves (SPEC section 7 rule kept).
- Secrets: `env` / `headers` values are masked in the list and revealed only in the edit form. CLI stdout/stderr is returned to the UI. Main never logs the command line of `add-json` / `-e` / `--header` calls (the JSON may carry tokens).

### D7. Embedded terminal shape (SPEC 10.1, P2 cut)
- **Shells:** `src/main/services/shells.ts` detects, in order:
  - `pwsh` (prefer `C:\Program Files\PowerShell\7\pwsh.exe`; `where.exe pwsh` also returns a `~\.dotnet\tools\pwsh.exe` shim here, so dedupe and prefer Program Files)
  - Windows PowerShell (`%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe`)
  - cmd (`%ComSpec%`)
  - Git Bash (`C:\Program Files\Git\bin\bash.exe`, or derived from `where.exe git`; args `--login -i`)
  - WSL (`%SystemRoot%\System32\wsl.exe` exists; not spawned for detection)

  All five exist on this machine. Default: pwsh, else powershell. The user's choice is kept in renderer `localStorage` (`ccwrap.terminal.defaultShell`).
- **Security:** `pty:open` accepts only a detected `shellId` (never a path or args from the renderer), and `cwd` must be an existing directory. Cap 8 ptys. Env = `process.env` minus `ELECTRON_RUN_AS_NODE`, `ELECTRON_RENDERER_URL`, `ELECTRON_NO_ATTACH_CONSOLE`, plus `TERM_PROGRAM=ccwraper` and `COLORTERM=truecolor`. Env is never logged.
- **Lifecycle:** each pty is owned by the `webContents` that opened it. Kill on:
  - `pty:close`
  - `webContents` `destroyed` / `render-process-gone`
  - a main-frame reload (`did-start-navigation`, not same-document)
  - app quit (the `registerIpc` disposer)
- **Throughput:** main coalesces `onData` per pty and flushes on an 8 ms timer or at 64 KB, one `pty:data` per flush. The renderer calls `term.write` (xterm batches per frame). `scrollback: 10000`. Write and resize go renderer -> main as fire-and-forget `ipcRenderer.send`.
- **UI cut for P2:**
  - Bottom docked panel: default 260, min 120, max 70vh, chat keeps at least 200. Drag-resize, slide 40px + fade, Ctrl+Backquote toggles.
  - Glass 36px header: shell tabs, "+" with a profile dropdown, cwd, find (Ctrl+F search overlay with the README decorations), clear, copy, kill, close.
  - The README `ITheme`; the cursor glow and the top fade are DOM overlays.
  - "Run in terminal" on Bash tool cards **types the command into a terminal tab without pressing Enter**, so the user confirms. It prefers a Git Bash tab, because tool commands are bash syntax.
  - Deferred: split panes, clickable file paths (there is no inspector yet), ligatures (D2).

### D8. No sqlite in P2
Everything P2 persists is small UI preference: terminal height and open state, default shell, cached model list, last settings tab. That goes in renderer `localStorage`, like `ccwrap.lastCwd` in P1. `node:sqlite` (P1 D3) waits for a feature that needs queries (pins / tags, P4).

### D9. P1 follow-ups folded into P2
| # | Item | Resolution | WP |
|---|---|---|---|
| 1 | **Bug found while planning: the bundled fonts never apply.** `tokens.css` names `"Geist"` / `"Geist Mono"`, but `@fontsource-variable/*` registers `Geist Variable` / `Geist Mono Variable`. Geist is not installed system-wide here, so the UI renders in Segoe UI / Cascadia | Prepend the Variable family names to `--font-sans` / `--font-mono` in **both** `docs/design/tokens.css` and `src/renderer/styles/tokens.css`, so the byte-identical test stays green. Add a test that the font stacks name the families fontsource registers | WP0 |
| 2 | "Always allow" shows only the first of several rules (P1 findings: known gap 1, follow-up 2) | `permission_request` adds `ruleLabels: string[]` (every rule in every `addRules` suggestion), and the dialog lists them all. Scope picker on Always allow: This project (`localSettings`, default), All projects (`userSettings`, new `remember:'user'`), This session (`session`) | WP4, WP10 |
| 3 | Model picker (follow-up 3) | `session:supportedModels(localId)` returns `ModelOption[]` from SDK `supportedModels()`, cached in `localStorage`; fallback list `default` / `sonnet` / `opus` / `haiku`. The model chip becomes a menu. For a draft it sets `model` for `session:start`; for a live session it calls the existing `session:setModel` and patches `meta.model` | WP4, WP10 |
| 4 | Live `setPermissionMode` not verified | Already wired end-to-end (Composer, StatusBar, chat-store, IPC, adapter). WP4 adds a unit test of the call path; WP11 verifies it live (switch to Plan, then a Write must not run) | WP4, WP11 |
| 5 | Tabbing through the virtualized list scrolls the focused card behind the composer | Reproduce in a test, then fix in `MessageList`: a `focusin` on a row that is not the last clears stick-to-bottom so the layout effect does not re-snap, plus `scroll-padding-block` on the scroll element. Check that the composer glow / negative margin does not overlap the list | WP10 |
| 6 | Large or compacted sessions look truncated (follow-up 1) | Renderer heuristic, no contract change: after `history:load`, if `fileSize > 2 MB` and there are fewer than 20 events, show an inline notice "History may be incomplete (large or compacted session)". The root cause is in the SDK | WP10 |
| 7 | CDP smoke script (follow-up 7) | `scripts/cdp-smoke.ts`: launch the built app with a remote debugging port, open the Settings / MCP / Memory views and the terminal, and save screenshots to a scratch dir | WP11 |
| - | Deferred: thinking toggle, jump-to-latest, per-kind row estimates, image thumbnails, nicer MCP tool cards, subagent nesting | P3 / P4 | - |

### D10. Cross-cutting rules for all agents
- **The lockfile has one writer (WP0).** No other WP edits `package.json` / `package-lock.json` or runs `npm install`; a missing dependency is reported to the lead.
- **Contracts freeze after WP0:** `src/shared/**`, `src/preload/**`, tsconfigs, `vitest.config.ts`, `tests/setup-*.ts`. Changes go through the lead. New channel names go in `src/shared/channels.ts` only (zod-free, bundled by the sandboxed preload).
- **Never touch the real user config in tests.** WP0 adds `tests/setup-node.ts` as `setupFiles` for the node vitest project. It creates a temp dir per worker and points `CLAUDE_CONFIG_DIR`, `USERPROFILE` and `HOME` at it before any test module loads. All services get their paths by constructor injection (`ConfigPaths`), never from `os.homedir()` directly. Project dirs in tests are `mkdtemp` dirs, removed in `afterEach`. A guard test asserts that `claudeConfigDir()` is not under the real home during tests.
- **CLI integration tests are opt-in** (`CCWRAP_CLI_IT=1`). They run the real `claude.exe` with `USERPROFILE` / `HOME` / `CLAUDE_CONFIG_DIR` set to a temp dir, and assert that redirection before the first spawn. The default `npm test` uses a fake CLI runner. MCP CLI calls cost no API money.
- **pty tests:** unit tests inject a fake `spawn`. One real-spawn test (`cmd.exe /c echo`) runs by default on win32 only (it's fast and deterministic, and the probe passed on Node 26); it is skipped on other platforms.
- **Live app checks of mutations (WP11)** that write user-scope settings, MCP or memory run with a sandboxed config (`CLAUDE_CONFIG_DIR` + `USERPROFILE` pointing at a scratch dir). Against the user's real config: read-only views only, plus writes inside a scratch project (`D:\claude-tmp\p2-live`). Never add or remove servers in the real user or local scope.
- **Live SDK runs cost money.** Only WP4 (one spike) and WP11 run them, with `settingSources: []` unless settings are under test.
- CSP stays `script-src 'self'`: no `wasm-unsafe-eval`, no `worker-src` change (D2, D3).
- **No hex in components** (the P1 guard test). The one exception is the xterm `ITheme`, because xterm needs literal colors: it lives in `src/renderer/features/terminal/theme.ts`, which WP0 allowlists in the guard. A test checks its values equal the README table.
- Fixtures are synthetic (`C:\fixture\proj`), never copies of the user's real settings or `.claude.json`.
- Every WP verifies with `npm run typecheck`, `npm test` and `npm run build`. UI WPs add Testing Library tests. xterm and CodeMirror are mocked in jsdom component tests; WP5 has the one CodeMirror mount smoke test. Visual checks go into the WP11 checklist.
- The P0 quirk still applies: if `node_modules/electron/dist` is missing, run `node node_modules/electron/install.js`.

---

## 2. Frozen contracts (WP0 lands these first)

### 2.1 `src/shared/channels.ts` (add)
~~~
configRead: 'config:read'                 configWrite: 'config:write'
configWatchProject: 'config:watchProject' settingsResolve: 'settings:resolve'
mcpList: 'mcp:list'   mcpAdd: 'mcp:add'   mcpRemove: 'mcp:remove'   mcpUpdate: 'mcp:update'   mcpTest: 'mcp:test'
ptyListShells: 'pty:listShells'   ptyOpen: 'pty:open'   ptyWrite: 'pty:write'   ptyResize: 'pty:resize'   ptyClose: 'pty:close'
ptyData: 'pty:data'   ptyExit: 'pty:exit'   fsChanged: 'fs:changed'        (main -> renderer events)
sessionSupportedModels: 'session:supportedModels'
~~~
`pty:write` and `pty:resize` use `ipcRenderer.send` / `ipcMain.on` (fire-and-forget). Everything else uses invoke / handle.

### 2.2 `src/shared/config.ts` (new, types only, zod-free)
~~~ts
export type SettingsScope = 'user' | 'project' | 'local'
// user ~/.claude/CLAUDE.md | project <p>/CLAUDE.md | projectDotClaude <p>/.claude/CLAUDE.md | local <p>/CLAUDE.local.md
export type MemoryScope = 'user' | 'project' | 'projectDotClaude' | 'local'
export type ConfigFileRef =
  | { kind: 'settings'; scope: SettingsScope; cwd?: string } // cwd required unless scope === 'user'
  | { kind: 'memory'; scope: MemoryScope; cwd?: string }
export interface ConfigSnapshot { ref: ConfigFileRef; path: string; exists: boolean; text: string; hash: string | null; mtimeMs?: number }
export type ConfigErrorCode = 'conflict' | 'invalid_json' | 'not_object' | 'bad_ref' | 'io'
export type ConfigWriteResult =
  | { ok: true; snapshot: ConfigSnapshot; backupPath?: string }
  | { ok: false; code: ConfigErrorCode; message: string; current?: ConfigSnapshot }

export type ResolvedSource = 'user' | 'project' | 'local' | 'flag' | 'managed'
export interface ResolvedSettingsView {
  cwd?: string
  effective: Record<string, unknown>
  provenance: Record<string, { source: ResolvedSource; path?: string }>
  /** low -> high precedence, as returned by the SDK */
  sources: Array<{ source: ResolvedSource; path?: string; policyOrigin?: string; settings: Record<string, unknown> }>
  ignoredDefaultMode?: { source: ResolvedSource; mode: string }
  error?: string
}

export type McpScope = 'user' | 'project' | 'local'
export type McpTransport = 'stdio' | 'sse' | 'http' | 'ws' | 'unknown'
export interface McpServerEntry {
  name: string
  scope: McpScope
  transport: McpTransport
  /** As stored, env/header values included; the renderer masks them. */
  config: Record<string, unknown>
  /** Project scope only. */
  approval?: 'approved' | 'rejected' | 'pending'
  shadowedBy?: McpScope
}
export interface McpListResult { servers: McpServerEntry[]; projectFile?: string; error?: string }
export type McpMutationResult = { ok: true; output: string } | { ok: false; message: string; output?: string }
export interface McpTestResult {
  name: string
  status: 'connected' | 'failed' | 'pending' | 'needs_auth' | 'unknown'
  detail?: string
  output: string
  durationMs: number
}

export type ShellId = 'pwsh' | 'powershell' | 'cmd' | 'gitbash' | 'wsl'
export interface ShellProfile { id: ShellId; label: string; path: string; isDefault?: boolean }
export interface PtyOpenResult { ptyId: string; pid: number; shellId: ShellId }
export interface PtyDataPayload { ptyId: string; data: string }
export interface PtyExitPayload { ptyId: string; exitCode: number; signal?: number }

export interface FsChangedPayload {
  kind: 'settings' | 'memory' | 'mcp'
  scope?: SettingsScope | MemoryScope | McpScope
  cwd?: string
  path: string
}
export interface ModelOption { value: string; displayName: string; description?: string }
~~~

### 2.3 `src/shared/events.ts` (change)
- `permission_request` adds `ruleLabels?: string[]` (all rules). `ruleLabel` stays as the first rule, for compatibility.

### 2.4 `src/shared/ipc.ts` (zod schemas + `CcwrapApi`)
- `PermissionReplySchema.remember` becomes `z.enum(['once','session','always','user'])` (`always` = localSettings, `user` = userSettings).
- Config:
  - `ConfigFileRefSchema`: discriminated union mirroring 2.2, with a `.refine` that `cwd` is present when scope is not `user`
  - `ConfigReadSchema {ref}`
  - `ConfigWriteSchema {ref, text: z.string().max(2_000_000), baseHash: z.string().nullable()}`
  - `ConfigWatchProjectSchema {cwd: z.string().nullable()}`
  - `SettingsResolveSchema {cwd: z.string().optional()}`
- MCP (cwd is required for the project and local scopes, by refine):
  - `McpScopeSchema`
  - `McpListSchema {cwd?}`
  - `McpAddSchema {scope, cwd?, name, config: McpServerConfigSchema}`, with `name` matching `/^[A-Za-z0-9_.-]{1,64}$/`
  - `McpRemoveSchema {scope, cwd?, name}`
  - `McpUpdateSchema {scope, cwd?, name, newName?, config}`
  - `McpTestSchema {cwd?, name}`
- Pty:
  - `PtyOpenSchema {shellId: ShellIdSchema, cwd: z.string().min(1), cols: int 2..500, rows: int 2..300}`
  - `PtyWriteSchema {ptyId, data: z.string().max(1_000_000)}`
  - `PtyResizeSchema {ptyId, cols, rows}`
  - `PtyCloseSchema {ptyId}`
- `CcwrapApi` adds:
~~~ts
config: {
  read(ref: ConfigFileRef): Promise<ConfigSnapshot>
  write(args: ConfigWriteArgs): Promise<ConfigWriteResult>
  watchProject(cwd: string | null): Promise<void>
  onChanged(cb: (p: FsChangedPayload) => void): () => void
}
settings: { resolve(args: { cwd?: string }): Promise<ResolvedSettingsView> }
mcp: {
  list(args: McpListArgs): Promise<McpListResult>
  add(args: McpAddArgs): Promise<McpMutationResult>
  remove(args: McpRemoveArgs): Promise<McpMutationResult>
  update(args: McpUpdateArgs): Promise<McpMutationResult>
  test(args: McpTestArgs): Promise<McpTestResult>
}
pty: {
  listShells(): Promise<ShellProfile[]>
  open(args: PtyOpenArgs): Promise<PtyOpenResult>
  write(ptyId: string, data: string): void
  resize(ptyId: string, cols: number, rows: number): void
  close(ptyId: string): Promise<void>
  onData(cb: (p: PtyDataPayload) => void): () => void
  onExit(cb: (p: PtyExitPayload) => void): () => void
}
session: { /* existing members */ supportedModels(localId: string): Promise<ModelOption[]> }
~~~

### 2.5 `src/shared/config-schemas.ts` (new, zod; the file name SPEC section 3 already lists)
- `McpServerConfigSchema`: a `z.union` of
  - stdio `{type?: 'stdio', command: min(1), args?: string[], env?: Record<string,string>}`
  - http / sse `{type: 'http' | 'sse', url: url(), headers?: Record<string,string>}`
  - ws `{type: 'ws', url}`

  All are `z.looseObject`, so unknown keys are preserved.
- `SettingsFormSchema` (`z.looseObject`):
  - `model?: string`
  - `permissions?`: looseObject `{defaultMode?: PermissionModeSchema, allow? / ask? / deny?: string[], additionalDirectories?: string[]}`
  - `env?: Record<string,string>`
  - `cleanupPeriodDays?`: int >= 0
  - `enableAllProjectMcpServers?: boolean`
  - `enabledMcpjsonServers?` / `disabledMcpjsonServers?: string[]`

  The renderer form uses it only for validation messages. Main checks only "parses and is an object", because new CLI keys must never be rejected.

### 2.6 Main wiring (WP0)
- `registerIpc({ manager, send })`, where `send(channel, payload)` targets the main window. Each `ipc/*.ts` `register*` returns a disposer, and `registerIpc` returns a combined `dispose()` that `src/main/index.ts` calls on `before-quit` / `window-all-closed`. After WP0, no feature WP edits `src/main/index.ts`.
- Stubs, so the renderer works before the main WPs merge:
  - `ipc/config.ts`: read returns a missing-file snapshot; write returns `{ok:false, code:'io', message:'not implemented'}`
  - `ipc/mcp.ts`: empty list
  - `ipc/pty.ts`: no shells
  - `ipc/session.ts`: `supportedModels` returns `[]`

### 2.7 Renderer frozen props and seams (WP0 placeholders)
- `src/renderer/features/settings/SettingsPage.tsx`: `SettingsPage({ cwd }: { cwd?: string })`
- `src/renderer/features/mcp/McpPage.tsx`: `McpPage({ cwd }: { cwd?: string })`
- `src/renderer/features/memory/MemoryPage.tsx`: `MemoryPage({ cwd }: { cwd?: string })`
- `src/renderer/features/terminal/TerminalPanel.tsx`: `TerminalPanel({ cwd, onClose }: { cwd?: string; onClose: () => void })` (it owns its height and tabs)
- `src/renderer/components/editor/CodeEditor.tsx`: `CodeEditor(props: CodeEditorProps)` with
  - `value`, `onChange`, `language: 'json' | 'markdown'`, `ariaLabel`
  - `readOnly?`
  - `diagnostics?: { from: number; to: number; message: string; severity: 'error' | 'warning' }[]`
  - `onSave?`, bound to Ctrl+S

  The placeholder is a `<textarea>` with the same props, so feature WPs can build before WP5 merges.
- `src/renderer/lib/terminal-bus.ts`: `requestRunInTerminal({ cwd, command }): void` and `onRunInTerminal(cb): () => void` (a tiny emitter: chat calls it, the terminal subscribes).
- `src/renderer/lib/config-queries.ts`: query keys `['config', refKey]`, `['settings-resolve', cwd]`, `['mcp', cwd]`, plus `useFsChangedInvalidation()`, which subscribes to `config.onChanged` once and invalidates the matching keys. Feature WPs build their hooks on these keys.
- `workspace-store.ts` adds `view: 'chat' | 'settings' | 'mcp' | 'memory'`, `setView`, `terminalOpen`, `toggleTerminal`.
- `AppShell`:
  - renders the active view in the main column (lazy pages), with the terminal slot under it
  - binds Ctrl+Backquote to toggle the terminal
  - calls `config.watchProject(cwd)` on cwd change, guarded with `window.ccwrap.config?.` because the existing AppShell tests mock a partial API
- `LeftRail` adds nav rows Sessions / MCP / Memory, with Settings pinned at the bottom (README layout).

---

## 3. Work packages

Waves: **W0** WP0 alone -> **W1** WP1, WP2, WP3, WP4, WP5 in parallel -> **W2** WP6, WP7, WP8, WP9, WP10 in parallel -> **W3** WP11.

| WP | Title | Wave | Depends on |
|---|---|---|---|
| WP0 | Foundation: deps, contracts, paths, test isolation, shell nav skeleton, font fix | W0 | - |
| WP1 | Main: ConfigService (atomic write, conflicts, backups), watcher, settings resolve | W1 | WP0 |
| WP2 | Main: McpService (file read + CLI mutations) | W1 | WP0 |
| WP3 | Main: PtyService + shell detection | W1 | WP0 |
| WP4 | Main: session follow-ups (ruleLabels, `remember:'user'`, supportedModels) | W1 | WP0 |
| WP5 | Renderer: CodeEditor (CodeMirror 6, token theme) | W1 | WP0 |
| WP6 | Settings editor UI (form, raw JSON, precedence) | W2 | WP1, WP5 (builds against the stubs) |
| WP7 | MCP manager UI | W2 | WP2, WP5 |
| WP8 | CLAUDE.md editor UI | W2 | WP1, WP5 |
| WP9 | Terminal UI (xterm, theme, tabs, search, run-in-terminal) | W2 | WP3 |
| WP10 | Chat follow-ups UI (model picker, rules + scope, tab-scroll, truncation hint, Run in terminal button) | W2 | WP4 |
| WP11 | Integration, live checks, CDP smoke, findings | W3 | all |

### WP0. Foundation (serial, first)
**Owns:**
- deps and config: `package.json`, `package-lock.json`, `vitest.config.ts`, `tsconfig*.json`, `tests/setup-node.ts` (new), `tests/setup-web.ts`
- contracts: `src/shared/**`, `src/preload/**`
- main: `src/main/index.ts`, `src/main/ipc/index.ts`, the stubs `src/main/ipc/{config,mcp,pty}.ts`, `src/main/ipc/session.ts` (the supportedModels stub only), `src/main/paths.ts` (+test)
- fonts: `docs/design/tokens.css` and `src/renderer/styles/tokens.css` (font names only), `src/renderer/styles/tokens.test.ts` (the font test), the no-hex guard allowlist
- renderer seams: `src/renderer/app/shell/{AppShell,LeftRail}.tsx` (+ test mock updates), `src/renderer/stores/workspace-store.ts`, `src/renderer/lib/{terminal-bus,config-queries}.ts`, and the placeholders in 2.7

**Do:**
1. One install, exact versions. Runtime: `node-pty` 1.1.0, `chokidar` 6.0.0, `@xterm/xterm` 6.0.0, `@xterm/addon-webgl` 0.19.0, `@xterm/addon-fit` 0.11.0, `@xterm/addon-search` 0.16.0, `@xterm/addon-web-links` 0.12.0, `@xterm/addon-unicode11` 0.9.0, and the CodeMirror set from D3. No new dev deps. Check that the install log shows node-pty's "Checking prebuilds" line with no node-gyp, and that `npm_config_build_from_source` is unset.
2. Contracts 2.1-2.5. Preload wiring: `send` for write/resize, `on` / `removeListener` for events. `api.d.ts` only changes through the `CcwrapApi` type.
3. `paths.ts` additions, pure and tested with Windows fixtures and both slash forms:
   - `claudeConfigDir(env?, home?)` and `claudeGlobalConfigPath(env?, home?)` (the D4 rule)
   - `managedSettingsPath(platform?)`
   - `settingsFilePath(scope, cwd?)` and `memoryFilePath(scope, cwd?)`
   - `bundledClaudePath()`: walks to `@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude(.exe)` the same way `readSdkVersions` does
4. Test isolation (D10): `tests/setup-node.ts` plus the guard test; add `setupFiles` to the node project.
5. Main wiring from 2.6 (disposer chain, `send`, stubs).
6. Renderer seams from 2.7: nav, view switch, lazy pages, terminal slot + Ctrl+Backquote, watchProject, terminal-bus, config-queries. Placeholders render a title so tests can find them.
7. Font fix (D9 #1) and its test. In the no-hex guard, allowlist exactly `features/terminal/theme.ts`.

**Accept:**
- typecheck, test and build are green
- `npm run dev`: the rail shows Sessions / MCP / Memory / Settings, each placeholder renders, Ctrl+Backquote toggles an empty panel, and chat works as in P1
- in DevTools, `document.fonts.check('13px "Geist Mono Variable"')` is true and the computed body font is Geist
- requiring `node-pty` from plain Node loads without error

### WP1. Main: ConfigService, watcher, settings resolve
**Owns:** `src/main/services/config-service.ts` (+test), `src/main/services/atomic-write.ts` (+test), `src/main/services/config-watcher.ts` (+test), `src/main/services/sdk-settings.ts` (+test), `src/main/ipc/config.ts`, `tests/fixtures/config/**`.
**Do:**
1. `atomic-write.ts`: `writeFileAtomic(path, data, {retries})` per D4. The `fs` is injectable for the retry tests.
2. `ConfigService(paths: ConfigPaths, backupDir)`: `read(ref)` and `write(ref, text, baseHash)` -> `ConfigWriteResult`. Settings must parse to a JSON object; memory is any text. Includes the conflict check, the first-write backup (last 5 kept) and the own-write registry for suppression. Memory files are written as UTF-8 with no BOM and keep their existing EOL style.
3. `config-watcher.ts`: chokidar via dynamic import, the D4 file set, `setProject(cwd|null)`, the debounces, the `.claude.json` MCP-slice hash and own-write suppression; emits `FsChangedPayload`. The factory is injectable so tests can use a fake watcher. Add one real chokidar test on a temp dir (create, modify, atomic rename).
4. `sdk-settings.ts`: `resolveSettingsView(cwd?)` via dynamic `import('@anthropic-ai/claude-agent-sdk')`. Maps `resolveSettings` + `filterEscalatingDefaultMode` to `ResolvedSettingsView` and sets `error` instead of throwing. The SDK functions are injectable for tests.
5. `ipc/config.ts`: real handlers for `config:read/write/watchProject` and `settings:resolve`. Forwards watcher events via `send(fs:changed)`; the disposer closes the watcher.

**Accept (all in temp dirs):**
- unknown keys and key order survive a form-style patch
- invalid JSON is rejected and the file is untouched
- a file changed after the read gives a conflict and nothing is written
- the backup is made once per run, capped at 5
- a missing parent `.claude/` is created
- an `EPERM` retry succeeds on the 3rd attempt
- an external write emits `fs:changed`; our own write does not
- `.claude.json` churn outside the MCP slice emits nothing
- the resolve mapping keeps the source order and the ignored defaultMode

### WP2. Main: McpService
**Owns:** `src/main/services/mcp-service.ts` (+test), `src/main/services/claude-cli.ts` (+test), `src/main/ipc/mcp.ts`, `tests/fixtures/mcp/**`.
**Do:**
1. `claude-cli.ts`: `runClaude(args, {cwd, env?, timeoutMs})` -> `{code, stdout, stderr}` via `execFile` (binary choice per D6, never a shell, `windowsHide`). The runner is injectable for tests.
2. `mcp-service.ts`:
   - `list(cwd?)` reads the files (D6): key matching via `normalizeCwdKey`, approval derivation, shadowing, and only the MCP slices extracted
   - `add`, `remove`, `update` (with rollback) and `test` (parses `Status:`)
   - errors become a `McpMutationResult` carrying the CLI's message; no secret logging
3. `ipc/mcp.ts` handlers. Validate `name` and `config` with the frozen schemas before spawning.
4. Opt-in integration test (`CCWRAP_CLI_IT=1`): temp `USERPROFILE` / `HOME` / `CLAUDE_CONFIG_DIR` and a temp project; add (all 3 scopes), list, update, remove, all through Node `execFile`. Include a config whose args contain spaces, quotes and a Windows path with backslashes, because argument quoting is the main Windows risk. The test asserts the redirected env before the first spawn.

**Accept:**
- unit tests on fixtures:
  - backslash and forward-slash project keys both match
  - local shadows user
  - pending / approved / rejected are derived correctly
  - a `.claude.json` with `oauthAccount` yields no such field in the result
  - update rolls back when `add-json` fails
  - `get` parsing covers the 3 probed status lines and the missing-server exit 1
- the opt-in IT passes locally once (WP2 runs it), and the real `~/.claude.json` is untouched (grep it for the test server name)

### WP3. Main: PtyService + shells
**Owns:** `src/main/services/pty-service.ts` (+test), `src/main/services/shells.ts` (+test), `src/main/ipc/pty.ts`.
**Do:**
1. `shells.ts`: detection per D7, with injectable `exists` / `where` for tests; cached; pwsh is deduped, preferring Program Files.
2. `pty-service.ts`: `open(shellId, cwd, cols, rows, ownerId)`, `write`, `resize` (clamped, ignored after exit), `close`, `closeOwner(ownerId)`, `closeAll()`. Env filtering, 8 ms / 64 KB batching, cap 8, `onExit` cleanup. `spawn` is injectable.
3. `ipc/pty.ts`: handlers, plus `ipcMain.on` for write/resize. Ownership = `e.sender.id`. Hook `destroyed`, `render-process-gone` and main-frame `did-start-navigation` once per webContents. The disposer calls `closeAll()`.

**Accept:**
- fake-spawn tests:
  - batching merges chunks and flushes at 64 KB
  - an unknown shellId and a missing cwd are rejected
  - env has no `ELECTRON_RUN_AS_NODE`
  - the cap holds
  - closing an owner kills only that owner's ptys
- real test (win32): `cmd.exe /c echo` round-trips through the service with exit code 0
- shell detection fixtures, including the dotnet shim

### WP4. Main: session follow-ups
**Owns:** `src/main/services/sdk-adapter.ts` (+tests), `src/main/services/session-manager.ts` (+test), `src/main/ipc/session.ts`, `scripts/spike.ts`.
**Do:**
1. `ruleLabelsFrom(suggestions)`: flatten every rule of every `addRules` suggestion into `toolName(ruleContent)` labels, deduped, and emit them as `ruleLabels`. `ruleLabel` = the first.
2. `buildPermissionResult`: `remember:'user'` maps to `destination:'userSettings'`.
3. `AdapterSession.supportedModels()` -> `q.supportedModels()` mapped to `ModelOption[]`; `SessionManager.supportedModels(localId)`; the IPC handler.
4. Unit test that `setPermissionMode` reaches `q.setPermissionMode` with the mode (fake Query); the same for `setModel`.
5. One live spike (`settingSources: []`) that logs the shape of the `supportedModels()` output into the WP4 notes for WP10. Cost is about $0.

**Accept:**
- a compound Bash suggestion yields 2 labels
- `user` maps to `userSettings`; `once` sends no update
- the supportedModels mapping
- mode and model pass through
- typecheck and build green

### WP5. Renderer: CodeEditor
**Owns:** `src/renderer/components/editor/**` (`CodeEditor.tsx`, `cm-theme.ts`, `cm-setup.ts`, tests).
**Do:**
1. A CodeMirror 6 wrapper per the frozen props:
   - created once per mount, with a StrictMode-safe destroy
   - an external `value` change is applied as a transaction only when it differs from the doc
   - `readOnly` through a compartment; Ctrl+S calls `onSave`
   - search keymap, line numbers, bracket matching, history
2. JSON: `@codemirror/lang-json` + `jsonParseLinter()`, with the external `diagnostics` merged into the lint source. Markdown: `@codemirror/lang-markdown`, with line wrapping on.
3. `cm-theme.ts`: `EditorView.theme` + `HighlightStyle` using only `var(--...)` tokens (bg-1 surface, fg text, accent caret, accent selection at 25%, mono font from the token stack).
4. Export it as a lazy chunk (`React.lazy` default export in `index.ts`) so the pages load it on demand.

**Accept:**
- a jsdom smoke test mounts and edits (add `Range.prototype.getClientRects` / `getBoundingClientRect` shims inside the test file, not in the shared setup)
- `onChange` fires; Ctrl+S calls `onSave`; readOnly blocks input
- no hex (guard green)
- `npm run build` puts CodeMirror in a separate chunk

### WP6. Settings editor UI
**Owns:** `src/renderer/features/settings/**` (the page, `model/settings-patch.ts` (pure, +test), form sections, the raw tab, the precedence tab, queries, tests).
**Do:**
1. Page layout: a scope switcher User / Project / Local (Project and Local are disabled without a cwd), and tabs Form / Raw JSON / Precedence. Show the resolved file path as copyable text.
2. `settings-patch.ts`: `applyPatch(text, ops)` returns the new text (indent and EOL detection, key order kept; an emptied `permissions` object is removed only if the patch created it). Plus `detectFormat(text)`. Heavy tests.
3. Form (the 2.5 fields):
   - model: free text with suggestions from the cached model list
   - `defaultMode` select
   - allow / ask / deny rule lists (add / remove rows, mono)
   - additional directories
   - env key/value table, values masked with a reveal toggle
   - cleanupPeriodDays and the MCP approval flags

   Save writes through `config:write` with `baseHash`. On conflict, a banner offers Reload / Overwrite. While the buffer is dirty, `fs:changed` shows a "changed on disk" banner instead of replacing the buffer. The save toast includes the backup note.
4. Raw: CodeEditor in JSON mode. Errors show as diagnostics: JSON parse errors, plus `SettingsFormSchema` issues as warnings that never block saving.
5. Precedence (D5): a table with one row per top-level key and one column per source (low -> high, as returned).
   - the winning value is highlighted; overridden values are dimmed with "overridden by X"
   - merged permission rules are listed with source chips
   - an ignored defaultMode gets a badge
   - managed and flag are read-only; env is masked

**Accept:** component tests with a mocked `window.ccwrap`:
- a form edit calls `config.write` with text that keeps an unknown key
- a conflict result shows the banner, and Overwrite resends with the new hash
- an unparsable file makes the form read-only and offers raw
- the precedence tab shows an overridden `model` and `permissions.allow` merged from two sources
- an env value stays masked until revealed

### WP7. MCP manager UI
**Owns:** `src/renderer/features/mcp/**`.
**Do:**
1. List grouped by scope (Local, Project `.mcp.json`, User). Each row: name, transport chip, command or url (mono, ellipsis), approval chip (project), shadowed note, actions Test / Edit / Remove.
   - The live status chip is joined by name from the active conv's `meta.mcp`.
   - Servers in `meta.mcp` that are in no file (plugins, claude.ai) are listed read-only as "session-only".
2. Add/Edit dialog: name, scope, transport; then stdio fields (command, args list, env table) or http/sse fields (url, headers table). A "JSON" toggle edits the whole config in CodeEditor. Validate with `McpServerConfigSchema`. Submit calls `mcp.add` / `mcp.update`; on failure show the CLI output.
3. A confirm dialog for Remove. Test shows a spinner, then a status chip with expandable raw output. Approve / Reject for pending project servers patches `.claude/settings.local.json` via `config:write` (D6).
4. Refresh on `fs:changed {kind:'mcp'}` (through config-queries).

**Accept:** component tests:
- adding a stdio server with env sends the right `mcp.add` payload
- a rename sends `mcp.update` with `newName`
- remove asks for confirmation first
- test result chips for connected / failed / pending
- secrets are masked in the list
- the approval patch writes `enabledMcpjsonServers` and keeps other keys

### WP8. CLAUDE.md editor UI
**Owns:** `src/renderer/features/memory/**`.
**Do:**
- Tabs for User (`~/.claude/CLAUDE.md`), Project (`CLAUDE.md`), Project `.claude/CLAUDE.md`, and Local (`CLAUDE.local.md`). A missing file shows "Create", which writes with `baseHash: null`.
- CodeEditor in markdown mode with an Edit / Preview / Split toggle. Preview reuses `features/chat/Markdown.tsx` (read-only import).
- Ctrl+S saves. Conflict and changed-on-disk banners work as in WP6. Switching tabs or views with unsaved changes asks first.

**Accept:** tests: Create on a missing file sends `baseHash:null`; save sends the current hash; the conflict banner shows; preview renders markdown; switching tabs with unsaved changes asks first.

### WP9. Terminal UI
**Owns:** `src/renderer/features/terminal/**` (`TerminalPanel.tsx`, `TerminalView.tsx`, `theme.ts` (the README `ITheme`, hex allowed), `terminal-store.ts`, `SearchOverlay.tsx`, tests).
**Do:**
1. `TerminalView`:
   - xterm with the README options: the corrected mono font stack, 13px, lineHeight 1.5, scrollback 10000, blinking block cursor
   - addons fit / search / web-links / unicode11 (`activeVersion = '11'`); WebGL with the DOM fallback (D2); wait for the font before `open()`
   - `ResizeObserver` -> fit -> `pty.resize`, debounced 50 ms
   - data comes in via `pty.onData` filtered by ptyId; keystrokes go out via `pty.write`
   - the pty is closed only when its tab closes, not when the panel hides. A hidden panel keeps xterm mounted (hidden with transform / visibility, not unmounted)
2. `TerminalPanel`:
   - glass header with tabs (shell icon, label, exit state), "+" with a profile dropdown from `pty.listShells` (default from localStorage), the cwd label
   - find: Ctrl+F overlay with the README decorations, next/prev and a match count
   - clear, copy selection, kill, close
   - drag handle: min 120, max 70vh, chat keeps at least 200; the height is kept in localStorage
   - slide + fade open, respecting reduced motion; the cursor glow and top fade overlays
3. `onRunInTerminal`: open the panel, reuse or open a Git Bash tab (fallback: the active tab), write the command **without** a carriage return, and focus the terminal.
4. Tests mock `@xterm/xterm` and the addons:
   - the theme equals the README table
   - opening and closing tabs call `pty.open` / `pty.close`
   - an exit shows "[process exited N]"
   - run-in-terminal writes without a newline
   - the resize math clamps

**Accept:** tests green; `npm run build` keeps xterm in a lazy chunk.

### WP10. Chat follow-ups UI
**Owns:**
- in `src/renderer/features/chat/**`, only the touched files: `Composer.tsx`, `MessageList.tsx`, `permission/**`, `tools/ToolCard.tsx` (+ the Bash renderer), `model/types.ts` + `model/reducer.ts` (ruleLabels, per-conv draft model), tests
- `src/renderer/stores/chat-store.ts`, `src/renderer/app/shell/StatusBar.tsx`, `src/renderer/features/sessions/**`
- the truncation notice in `workspace-store.openSession`. WP0 has already landed, so WP10 is the only W2 editor of that file.

**Do:**
- D9 #2: the rule list, plus a scope split button (This project / All projects / This session); the toast names the destination.
- D9 #3: the model menu chip in Composer; StatusBar shows the selected model; the list is cached in `localStorage` `ccwrap.models`.
- D9 #5: the tab-scroll fix plus a regression test.
- D9 #6: the truncation notice.
- A "Run in terminal" action on Bash tool cards that calls `requestRunInTerminal({cwd, command})`.

**Accept:** tests:
- two ruleLabels render
- choosing All projects sends `remember:'user'`
- a draft model goes into `session.start`
- a live model change calls `setModel` and updates the chip
- focusing an earlier card with Tab does not snap to the bottom
- the notice shows for a fixture with `fileSize` 5 MB and 2 events
- Run in terminal emits on the bus

### WP11. Integration, live checks, findings (finishes last)
**Owns:** `README.md` (run notes), `docs/P2-FINDINGS.md` (new), `scripts/cdp-smoke.ts` (new). Cross-file fixes only with the lead's OK.
**Manual / CDP checklist:**
1. **Sandboxed config run** (`CLAUDE_CONFIG_DIR` and `USERPROFILE` set to `D:\claude-tmp\p2-cfg`, project `D:\claude-tmp\p2-live`):
   - User / Project / Local settings: form save and raw save work, an unknown key survives, and the backup appears in userData.
   - An external edit (Notepad, or a `node -e` script writing the file) refreshes the view. With a dirty buffer it shows the banner instead; the conflict path works.
   - The precedence view shows a key overridden across user / project / local, and merged allow rules.
   - MCP: add stdio servers in the user, local and project scopes; edit / rename; Test (shows Failed for a dummy server); remove; approve a pending project server. The files change as expected, and `claude mcp list` (same env) agrees.
   - CLAUDE.md: create, edit, save and preview in all 4 tabs.
2. **Real config run** (user scope read-only; writes only inside `D:\claude-tmp\p2-live`):
   - The Settings and MCP views show the user's real data with env and header values masked.
   - Terminal:
     - pwsh, cmd, Git Bash and WSL (if a distro is installed) open in the project cwd
     - the colors match the theme and WebGL is active (log the renderer type)
     - Ctrl+F finds and highlights; resize reflows
     - typing exit shows the exit state
     - closing a tab kills its process (check with `tasklist`), and app quit leaves no `OpenConsole` or shell orphans
   - "Run in terminal" from a Bash tool card types the command without running it.
   - Model picker: switch the model live; the next turn's `init` / result shows the new model.
   - Permission mode: switch to Plan live and ask for a file write; no Write runs.
   - Always allow with a compound Bash command lists both rules. "This project" writes `settings.local.json` in the scratch project, and the settings editor refreshes via `fs:changed`. ("All projects" writes user settings, so it is tested only in the sandboxed run.)
   - Tabbing through the chat list does not hide cards behind the composer. The computed font is Geist.
3. `scripts/cdp-smoke.ts`: build, launch with `--remote-debugging-port`, visit each view, open the terminal, and save screenshots to `D:\claude-tmp\p2-shots` (not committed).
4. typecheck, test and build are green. Record the bundle chunk sizes (main chunk vs the lazy editor and terminal chunks).

**Accept:** the checklist passes, or each failure is recorded with a decision. `docs/P2-FINDINGS.md` records:
- the live API cost
- any `resolveSettings` surprises
- the CLI quoting results
- the WebGL / DOM renderer outcome
- the P4 asar note (D1)
- the deviations: ligatures (D2), CodeMirror (D3), backup location (D4), the third SDK file (D5)

---

## 4. Collision map (who may edit what after WP0)
- **Lead only:** `package.json`, the lockfile, `src/shared/**`, `src/preload/**`, tsconfigs, `vitest.config.ts`, `tests/setup-*.ts`, `src/main/index.ts`, `src/main/ipc/index.ts`, `src/main/paths.ts`, and `docs/design/tokens.css` with its renderer copy.
- **`src/main/services/` and `src/main/ipc/`:**
  - WP1: `config-service`, `atomic-write`, `config-watcher`, `sdk-settings`, and `ipc/config.ts`
  - WP2: `mcp-service`, `claude-cli`, and `ipc/mcp.ts`
  - WP3: `pty-service`, `shells`, and `ipc/pty.ts`
  - WP4: `sdk-adapter`, `session-manager`, `ipc/session.ts`, and `scripts/spike.ts`
  - `sdk-history.ts` and `history-service.ts` are untouched in P2.
- **Renderer:**
  - WP5: `components/editor/**`
  - WP6: `features/settings/**`
  - WP7: `features/mcp/**`
  - WP8: `features/memory/**` (imports `features/chat/Markdown.tsx` read-only)
  - WP9: `features/terminal/**`
  - WP10: `features/chat/**`, `stores/chat-store.ts`, `app/shell/StatusBar.tsx`, `features/sessions/**`, and `stores/workspace-store.ts` (the truncation notice only)
  - `app/shell/{AppShell,LeftRail}.tsx` and `lib/{terminal-bus,config-queries}.ts`: WP0, then WP11 only.
- **Fixtures:** `tests/fixtures/config` is WP1's, `tests/fixtures/mcp` is WP2's. Existing fixture dirs are read-only.
- **SDK imports** are allowed only in `sdk-adapter.ts`, `sdk-history.ts` and `sdk-settings.ts` (new, D5).
