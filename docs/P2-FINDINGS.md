# P2 Findings (WP11: integration and live verification)

Date: 2026-10-30. Electron 45.1.0, SDK 0.3.312, claude.exe 2.1.314, node-pty 1.1.0, xterm 6.0.0, CodeMirror 6.

Method: the built app (`npm run build`) was driven and screenshotted over CDP by `scripts/cdp-client.ts` based scripts (mouse and key events, `Input.insertText`, `Page.captureScreenshot`, `Runtime.evaluate`, a `session.onEvent` tap). Screenshots are in `D:\claude-tmp\p2-shots` (not committed). Processes were checked with `Get-CimInstance Win32_Process` (descendants of the app PID). The driver scripts other than the smoke script were throwaway (scratchpad); only `scripts/cdp-smoke.ts` and `scripts/cdp-client.ts` are committed (`npm run smoke`).

Two runs:
- **Sandboxed**: `CLAUDE_CONFIG_DIR=D:\claude-tmp\p2-cfg`, `--user-data-dir=D:\claude-tmp\p2-ud`, project `D:\claude-tmp\p2-live`. All mutations (settings, MCP add/update/remove, CLAUDE.md) happen here. `USERPROFILE` / `HOME` were not redirected for Electron; the CLI child processes inherited the real `USERPROFILE` and only `CLAUDE_CONFIG_DIR` redirected them (the real `~/.claude.json` has no probe server, checked).
- **Real config**: Settings / Precedence / Raw / MCP / Memory views opened read-only (no save, add, remove, approve or create clicked). `settings.json` / `CLAUDE.md` sha1 were identical before and after. Live chat needs the login, which lives in the real config dir, so the model checks ran with the real config but only against the scratch project (sessions are visible in the real transcript store under the `D--claude-tmp-p2-live` project).

## Gates
`npm run typecheck` green; `npm test` 374 passed / 3 skipped (39 files); `npm run build` green.

## Checklist results
| # | Item | Result | How / notes |
|---|---|---|---|
| 1a | Settings form save (user), unknown key survives, key order kept, backup in userData | pass | model edit + allow rule added; `unknownKey` and key order unchanged; `p2-ud\backups\<hash>-settings.json.<ts>.bak` created |
| 1b | Raw JSON: invalid blocked | pass | `{ "model": ` shows a lint marker plus "Invalid JSON ... Saving is disabled", Save disabled, file untouched |
| 1c | External edit refreshes clean view; dirty buffer shows banner; conflict path | pass | clean: view adopts disk in <2 s; dirty: "changed on disk" banner, Reload adopts disk; Save after an external write gives "changed on disk ... nothing was saved" with Reload / Overwrite, Overwrite writes the buffer |
| 1d | Project / Local scope forms, precedence view | pass | `model` shown overridden across user/project/local, merged allow rules with source chips, project `defaultMode: acceptEdits` shown "ignored (untrusted project scope)", env masked |
| 1e | MCP add stdio in user, local, project scopes | pass | user -> `$CLAUDE_CONFIG_DIR\.claude.json mcpServers`; local -> `projects["D:/claude-tmp/p2-live"]`; project -> `.mcp.json`; args preserved (`["-e","process.exit(1)"]`), env secret masked in the list |
| 1f | MCP rename/edit, Test, approve, remove | pass | rename = new key, old removed, env kept; Test on a dummy server shows Failed with `CONNECTION_CLOSED` and an expandable raw output; Approve patched `.claude/settings.local.json` `enabledMcpjsonServers`; Remove asks for confirmation; all three removed (project file left as `{ "mcpServers": {} }`) |
| 1g | `claude mcp list` agrees (same env) | pass with note | lists the 3 servers; but see the approval finding below |
| 1h | CLAUDE.md create / edit / Ctrl+S / preview in all 4 tabs | pass | Create writes the file, no BOM; Edit / Preview / Split render h1, strong, code; conflict banner on external write while dirty, Save blocked, Overwrite works |
| 2a | Real config read-only: Settings and MCP show real data, env and headers masked | pass | user form/precedence/raw, 4 user MCP servers (1 stdio, 3 http), env value masked (a 13-char path-like env value was found only as a substring of the visible cwd label; no secret shapes). Precedence: 12 rows, 3 columns |
| 2b | Terminal shells open in the project cwd | pass | PowerShell 7, Windows PowerShell, Command Prompt, Git Bash each wrote its cwd to a file: `D:\claude-tmp\p2-live` (bash: `D:/claude-tmp/p2-live`). WSL: not testable (only a stopped `docker-desktop` distro) |
| 2c | Theme, WebGL | pass | renderer log: WebGL active (one `canvas` in `.xterm-screen`, no `xterm-rows`); colors and glow match the README by screenshot |
| 2d | Ctrl+F find, resize reflow, `exit` state, Ctrl+Backquote | pass | find reported "1 of 2"; pty cols 146 -> 107 when the window was narrowed (the shell sees it); `exit` shows "(exited 0)" on the tab; Ctrl+Backquote hides, ptys survive (process count unchanged), shows again |
| 2e | Close tab kills the process; quit leaves no orphans | fixed, partial | **bug**: closing a Git Bash tab left `bash.exe` x2 + `conhost.exe` forever (fixed, below). Remaining: a shell that exits on its own leaves its `conhost.exe` until app quit (see known gaps). After graceful quit (`Browser.close`) none of 2 open shells' processes survived |
| 2f | Run in terminal from a Bash card types without executing | pass | opened a Git Bash tab, typed `touch t-run.txt && ls t-run.txt` at the prompt, file absent; pressing Enter created it |
| 2g | Model picker: draft model reaches `session.start`; live `setModel` | pass | draft Haiku: transcript model `claude-haiku-5-5`; live switch to "Default" then next turn transcript `claude-sonnet-5-5`; chip updates. List comes from `supportedModels()`: Default (recommended), Opus 5.5, Sonnet 5.5, Fable 5.1, Haiku 5.5 |
| 2h | Permission mode Plan live: a Write must not run | pass | Write was attempted only against the plan file under `~\.claude\plans`, the project file was never created, `ExitPlanMode` prompt appeared and Escape denied it ("Denied by user") |
| 2i | Always allow lists every rule; This project writes `settings.local.json`; editor refreshes | pass | `mkdir p2sub && echo ok > p2sub/a.txt` listed `Bash(mkdir p2sub *)` and `Bash(echo ok *)`, both written to the scratch `.claude/settings.local.json` (existing key kept); the Local raw tab showed them. A different compound (`touch ... && ls ...`) was offered as ONE exact rule by this CLI build. Scope menu: This project / All projects / This session (All projects NOT exercised: it writes the real user settings). Rules removed afterwards |
| 2j | Tab traversal does not hide cards behind the composer | pass | shift+Tab through 14 focus stops, no focused card overlapped the composer (overlap 0 px) |
| 2k | Fonts applied | pass | `document.fonts.check` true for `Geist Variable` and `Geist Mono Variable`; body and CodeMirror computed family starts with `"Geist Variable"` |
| 2l | Editor visuals: lint markers, search panel | pass with polish note | lint dot in the gutter and underline for invalid JSON; Ctrl+F opens the CodeMirror panel (default layout, small native checkboxes) |
| 3 | `scripts/cdp-smoke.ts` | pass | `npm run smoke` visits fonts / Settings / MCP / Memory / terminal toggle, saves PNGs, kills only its own process tree |
| 4 | typecheck, test, build, chunk sizes | pass | see Performance |
| extra | Unsaved-changes guard across views and projects | pass | live: dirty Memory buffer, click MCP -> "Discard unsaved changes?"; Keep editing stays; Discard navigates and the edit is not on disk. Unit tests cover setView, selectProject, openSession and the AppShell dialog |
| extra | Min window 1024x640 | pass | no horizontal overflow with the terminal open; Settings, MCP, terminal header intact |

### Approval note (needs a decision)
The app writes project-server approval to `.claude/settings.local.json` (`enabledMcpjsonServers`). In a live session the `init` event reported `p2-proj-srv` as `failed` (it was approved and attempted), so the SDK honours the key. `claude mcp list` still prints "Pending approval" for the same server, because it ignores those settings keys. The two disagree only in the CLI's list output; the app's own chip follows the real session behaviour.

## Bugs found and fixed
1. **Unsaved edits lost on view or project change** (Settings guarded only its scope tabs; Memory dropped edits when the shell unmounted it). New `stores/dirty-registry.ts`; `setView`, `selectProject`, `newSession`, `openSession` ask through a Discard / Keep editing dialog in `AppShell`. Tests: `stores/dirty-registry.test.tsx`. (6a9e887, f6bd772)
2. **Closing a Git Bash tab leaked `bash.exe` (x2) and a `conhost.exe`** because node-pty `kill()` only ends the top process. `PtyService.kill` now runs `taskkill /T /F` on the shell pid for live ptys first (injectable `killTree`, tests for live vs exited). Verified live for pwsh, Windows PowerShell, cmd and Git Bash: no descendants 0.5 s after close. (fbd5c35)
3. Selector hazard for tooling, not a bug: `aria-label=Model` matches both the settings section and the input (the smoke/CDP drivers use `input[aria-label=Model]`).

## Known gaps and observations (not fixed)
- **A shell that exits on its own leaves its `conhost.exe`** until the app quits (about 9 MB each; probed outside Electron with plain node-pty, `kill()` after exit does not release it). Quit and tab close of live shells are clean. Follow-up: track the ConPTY host pid, try `useConptyDll`, or close tabs with a live-kill path.
- Model chip shows the raw id (`claude-sonnet-5-5`) after the first turn because `meta.model` is the resolved id while the list uses aliases; after a live switch it shows "Default (recommended)". Cosmetic.
- The CodeMirror search panel uses the stock layout (tiny native checkboxes, light-ish borders); not token themed.
- `claude mcp list` shows project servers as pending even when approved via settings (above).
- WSL tab not tested (no usable distro). Ligatures deferred (D2).
- The 'This session' and 'All projects' Always allow scopes were not clicked live (the latter would write user settings); unit tests cover `remember:'user'` -> `userSettings`.
- Native dialogs ("Open folder...") still not drivable over CDP.
- Drag-resize of the terminal handle not exercised live (window resize was); covered by unit tests of the clamp math.
- `resolveSettings` surprises: none. Source order was user < project < local as returned; the managed tier was absent. Output for a user-only config had 1 source and 3 columns (User, Local appear only when the files exist).

## SPEC deviations (all recorded earlier in the plan; confirmed live)
- CodeMirror 6 instead of Monaco (D3). Editor works, lazy chunk, no CSP change.
- Backups in `<userData>/backups/` instead of next to the file (D4); toast says "Backup saved: <path>".
- Third SDK boundary file `sdk-settings.ts` (D5).
- No ligatures in the terminal (D2).
- New: `smoke` npm script in `package.json` (note: package.json edited for that one line only).

## CLI quoting results
`claude mcp add-json` through `execFile` with args containing spaces and backslash paths worked in the live add/rename flow (`node -e process.exit(1)`); the earlier opt-in IT covers quotes. The CLI wrote local-scope keys with forward slashes (`D:/claude-tmp/p2-live`) and the app matched them.

## Performance notes
Bundle (out/, minified):
| chunk | size |
|---|---|
| main process `out/main/index.js` | 73 kB |
| preload | 4 kB |
| renderer entry `index-*.js` | 1,859 kB |
| `CodeEditorImpl` (CodeMirror, lazy) | 1,071 kB |
| `TerminalPanel` (xterm + addons, lazy) | 691 kB |
| `SettingsPage` / `McpPage` / `MemoryPage` (lazy) | 52 / 51 / 12 kB |
| `config-schemas` (zod, shared) | 182 kB |
| `index-*.css` | 69 kB |

The entry contains neither CodeMirror nor xterm (`cm-editor` not present; pages, editor and terminal are only reached through dynamic `import()`s). The CodeMirror chunk is about 3x the plan's 300 kB estimate (JSON + Markdown parsers, lint, search, themes); worth a look when P3 adds more languages. Startup: DOMContentLoaded 36 ms, load 47 ms after the reload, shell ready about 1 s; renderer JS heap about 20 MB with the terminal open. The `performance` resource list was empty under `file://`, so lazy loading is evidenced by the chunk graph and the entry contents, not by network timing.

## API cost of this verification
About $0.5 to $0.6 in total: two scripted chat runs (first haiku draft turn $0.007, then sonnet turns to $0.23 cumulative in the second run; the first run ended around $0.2-0.3 after one plan-mode and one Bash turn) and one small run on Haiku with two Bash turns (about $0.05). Everything else (settings, MCP CLI, terminal, editors) costs nothing. Scratch sessions were left in the real transcript store under the `p2-live` project.

## P4 asar note (D1)
Unchanged: electron-builder needs `asarUnpack: ["node_modules/node-pty/**"]` and the conout worker path must be verified in the packaged app. Also `taskkill` is called by name and needs `System32` on PATH (it is, normally).

## Prioritized follow-ups
P3 (skills, commands, agents, hooks editors):
1. Reuse `ConfigService` plus the dirty registry for the new editors (register each page's buffer under its own key).
2. Hooks / skills / commands / agents need files under `.claude/` and plugin dirs; the watcher set must grow (D4) and `fs:changed` get new kinds.
3. Schema hints in the raw editor (zod issues -> diagnostics already exist; extend per editor).
4. Style the CodeMirror search panel with tokens; check the editor chunk weight.
5. Show the resolved model id mapping for the chip (alias -> id) from `supportedModels()`.

P4:
1. Packaging: asar unpack for node-pty, verify conout worker, code signing.
2. Fix the exited-shell `conhost` leak (ConPTY host tracking or `useConptyDll`); WSL smoke on a machine with a distro.
3. Reconcile project-MCP approval with `claude mcp list` (or document the difference in the UI).
4. Add the model-picker and permission-mode checks to the smoke script behind an explicit `CCWRAP_SMOKE_LIVE=1` (they need a login and cost money).
5. Terminal: split panes, clickable paths once the inspector exists.
