# P3 Findings (WP11: integration and live verification)

Date: 2026-10-30. Electron 45.1.0, SDK 0.3.312, claude.exe 2.1.314, node-pty 1.1.0, CodeMirror 6, yaml 2.9.1.

Method: the built app (`npm run build`) was driven and screenshotted over CDP (`scripts/cdp-client.ts` based throwaway drivers, mouse/key events, DOM clicks, `Page.captureScreenshot`, `Page.getResourceTree`, a 400 ms DOM sampler for live activity). Screenshots are in `D:\claude-tmp\p3-shots` (not committed). Processes were inspected with `Get-CimInstance Win32_Process` and only the app's own tree was ever killed (`taskkill /PID <app pid> /T /F`).

Two runs:
- **Sandboxed**: `CLAUDE_CONFIG_DIR=D:\claude-tmp\p3-cfg`, `--user-data-dir=D:\claude-tmp\p3-ud`, project `D:\claude-tmp\p3-live`. All creates, edits, renames, deletes and hook saves happened here. No chat session was ever started in this sandbox, so none of its saved hooks could run, and both hooks were removed again (the files keep `"hooks": {}`).
- **Real config** (`--user-data-dir=D:\claude-tmp\p3-ud-real`, `~/.claude`): the new pages were opened read-only, then a few cheap chats ran in the scratch project (the CLI loads the user's own hooks and plugins, as in P2). `sha1` of `~/.claude/settings.json` and `CLAUDE.md` and the `skills` / `agents` listings (and no `commands` dir) were identical before and after.

## Gates
`npm run typecheck` green, `npm test` 615 passed / 3 skipped (54 files; one run in three showed a single transient failure under load that did not reproduce, not identified), `npm run build` green, `npm run smoke` passes (sandbox config).

## Checklist results
| # | Item | Result | How / notes |
|---|---|---|---|
| 1a | Skills: user + project same name -> shadow chips | pass | `Shadowed by user` on the project row, `Overrides project` on the user row |
| 1b | Skills: Form edit keeps comments and other keys, backup appears | pass | description edited; `# keep this comment`, `custom-key`, trailing comment kept; backup `p3-ud\backups\<hash>-SKILL.md.<ts>.bak`, toast shows the path. Found: untouched flow collections were re-padded (`[1, 2]` -> `[ 1, 2 ]`); fixed (below) |
| 1c | Skills: Raw with broken YAML | pass | lint marker on the line, message above the editor, Save disabled ("Fix the frontmatter to save"), Form shows the read-only notice with Open Raw; Revert restores |
| 1d | Skills: rename | pass | dir moved to `beta-skill\`, `name:` updated, other keys and comment kept |
| 1e | Skills: delete -> trash | pass | dialog names the trash path (after the AppInfo change), item in `p3-ud\trash\<ts>-skill-user-beta-skill\` with `ccwrap-trash.json` manifest, gone from the list. Same volume, so the EXDEV copy path was not exercised live |
| 1f | Skills: external edit (clean), banner (dirty), conflict | pass | clean view adopted the disk text in under 2.5 s; dirty buffer got "This file changed on disk. Your unsaved edits are kept." (Reload / Keep mine); Save then gave the conflict banner "nothing was saved" (Reload / Overwrite); Overwrite wrote the buffer |
| 2a | Commands: namespaced `a/b` | pass | file `commands\a\b.md`, listed as `/a:b` |
| 2b | Commands: same name user + project | pass | `Conflict` chip on both rows |
| 2c | Commands: shadowed by same-name skill | pass | `Shadowed by skill` chip |
| 3 | Agents: template create, `color` / `model` / `tools` form edits, filename != `name` warning | pass | file `color: blue`, `model: haiku`, `tools: [Read]` as a block list; warning "name differs from the file name (the CLI uses name)" |
| 4a | Hooks: add PreToolUse command in user scope, confirm dialog | pass | dialog lists event, type, `new`, the command; Cancel is the default-focus button |
| 4b | Hooks: project scope checkbox | pass | "This file is usually committed to the repository..." checkbox; `Save hooks` disabled until checked; file written to `p3-live\.claude\settings.json` |
| 4c | Hooks: Effective view | pass | both entries with User / Project chips, ordered low to high precedence |
| 4d | Hooks: remove entries, no confirm | pass | removal saves without the dialog; empty event key removed (an empty `"hooks": {}` object stays) |
| 5 | Plugin items read-only | pass (real config, after one session) | 127 skill rows incl. plugin rows with a lock icon, `Plugin (read-only)` and `Loaded in session` chips, a "Read-only plugin item (caveman)" header, Name / Model disabled, no Save / Rename / Delete; plugin agents appear too. Before a session the list says "Plugin skills appear after a session has started" (seen in the sandbox) |
| 6 | Real config read-only | pass | Skills (1 user skill), Commands (none: dir absent, shown as such), Agents (8), Hooks (SessionStart + UserPromptSubmit user entries, 3 groups in Effective) all rendered; nothing saved; `sha1` / listings identical |
| 7 | Live subagent turn (real app, sonnet default and one run chosen as haiku) | pass with gaps | see "Live activity" |
| 7b | Stop agent on a running card; Esc interrupt with a running agent | NOT VERIFIED | the Claude Code auto-mode classifier denied the driver command for the later runs ("Modify Shared Resources", intermittent: the same kind of script ran on other attempts). The button `Stop agent` was visible on the running card in the screenshots and the adapter's `stopTask` + the reducer's `stopping`/`stopped` path are unit tested. Needs a human run |
| 8 | Model chip display name | pass (composer) / fixed (status bar) | composer chip: `Haiku 5.5`; the status bar showed the raw `claude-haiku-5-5`; fixed to the display name with the raw id as title |
| 9 | Editor: lazy chunks, JSON editors do not load markdown | pass | `Page.getResourceTree` after reload: only `index`, `jsx-runtime`, `x`. Settings Raw JSON adds `CodeEditorImpl` + 2 `dist` chunks (27 kB + 2 kB, lang-json); the Skills Raw tab adds one more `dist` chunk (194 kB, lang-markdown). No `markdown-*` / html / css / javascript shiki chunk loaded |
| 10 | Editor search panel themed | pass | dark input and buttons, accent checkboxes (small native-sized, see gaps) |
| 11 | Fonts | pass | `smoke` "fonts applied": `Geist Variable` / `Geist Mono Variable` |
| 12 | conhost / OpenConsole (extra 5) | pass | see below |
| 13 | Smoke script | pass | `npm run smoke` visits fonts, Settings, MCP, Memory, Skills, Agents, Hooks, the Commands tab, Hooks scopes + Effective, the lazy editor, the terminal; `CCWRAP_SMOKE_LIVE=1` adds one subagent turn (not run end to end through the script, see below) |

### conhost / OpenConsole (live, Electron)
`conpty.dll` and `conpty.node` are loaded from `node_modules\node-pty\prebuilds\win32-x64\` in the app's main process. Descendants of the app PID by PID: opening Git Bash added `OpenConsole.exe` + `bash.exe` x2, opening PowerShell 7 added `OpenConsole.exe` + `pwsh.exe`; after typing `exit` in each, 3 s later the descendant list was back to the baseline (`OpenConsole.exe` + `pwsh.exe` of the initial tab only). No `conhost.exe` was ever a child of the app. (WP7's fix holds in the real app.)

### Live activity (extra 3, 4, and the checklist)
**Background agent after `result`, session kept open** (headless adapter run, throwaway script on top of `startSdkSession`, haiku, `settingSources: []`, raw tap). Real order, times in ms from start:

| ms | raw message | normalized event |
|---|---|---|
| 3250 | `assistant` (Agent tool_use, input has `run_in_background: true`) | `assistant_message`, `tool_use` |
| 3264 | `system/background_tasks_changed` | none |
| 3267 | `system/task_started` | `task_started {taskId, description, toolUseId, subagentType, taskType: 'local_agent', depth: 1, background: true}` |
| 3280 | `user` tool_result "Async agent launched successfully..." | `tool_result` (early, as the plan expected) |
| 4479 | `result/success` | `result`, `status idle` |
| 4872 | `assistant` with `parent_tool_use_id` (the agent's Bash call) | child `tool_use` |
| 4875 | `system/task_progress` | `task_progress {totalTokens, toolUses, durationMs, lastToolName}` |
| 11339 | `system/task_started` `taskType: 'local_bash'` with `parentTaskId` | `task_started {parentTaskId, background: false}` |
| 20747 | `system/task_notification` for the bash task | `task_ended completed` |
| 22864 / 22865 | `system/task_updated {status: completed}`, `system/task_notification` | `task_updated`, `task_ended {status, summary, totalTokens, toolUses, durationMs}` |
| 22866 | `system/background_tasks_changed` | none |
| 22882 | `system/init` again, then `status requesting`, an assistant turn "The background agent finished..." and a second `result/success` at 24967 | |

Confirmed: the adapter's shapes are right, and **task progress and the end event arrive well after `result`** (18 s after it here) while the session is open. A finished background agent also makes the CLI start a turn on its own (a second `init`, an assistant reply, a second `result`) with no `send()`. That turn exposed a bug (fixed below): the UI stayed "Idle" while the reply streamed and the usage accumulator was still stopped, so the status bar's turn segment flickered through stale numbers (`turn 14s up 131k down 414` -> `turn 2s up 47.6k down 369` -> `13` -> `3`).

**Live UI run in the real app** (400 ms DOM sampler, prompt = the WP1 prompt, no `run_in_background`; the CLI ran the agent asynchronously anyway):
- the working row appeared at 0 s (`Working... 0s - esc to interrupt`), then `Thinking...`, `Running Agent...`, `Running Bash...`, `Running Glob...`; the verb follows the tool; the elapsed counter advanced each second; the title bar shows an `Interrupt` button and the composer a stop square
- tokens: `down ~2` (estimate, dashed underline) -> `down 227` (exact at message end) -> `~257` -> `319` -> `~326` -> `357` -> `414` at the turn end. Estimate vs exact at message end: 2 vs 227 (a thinking-heavy first message, the estimate cannot see thinking), 257 vs 319 (-19 %), 326 vs 357 (-9 %), 4 vs 4 (a short reply, `Reply with just the word hi`, exact match)
- `1 agent` appears in the working row at the agent's start, then `main + 31.7k subagents`, then the segment disappears when the card turns Done
- the SubagentCard: `Running` pill with `Starting...`, then `down 31.7k - 1 tool call - Glob - 4s - Stop agent`, the nested `Glob *` child card running -> `3 matches Done`, then collapsed `down 39.5k - 1 tool call - 9s - Done`
- the status bar: `turn Ns up 83.5k down 324` during the turn, the cost `$--` until the result, then `ctx 5%`, `turn 14s up 131k down 414` and `$0.0135` at idle. The ctx % was NOT shown during the first turn of a fresh app profile (see gaps)
- the final state of the first run after the fixes could not be re-driven live (see 7b); the unprompted-turn fix is covered by a unit test

**ctx % before and after the D1 fix** (offline replay of the recorded real stream through `mapMessage` + the reducer, `scripts` throwaway): per-turn `result.usage` sum (old method) = 30,901 tokens; latest main `message_start` (D1) = 23,108. The old number overstates the context by 34 % on this 2-call turn. During the turn the live context walked `19,250 ~ -> 19,265 ~ -> 19,281 ~ -> 19,394 (exact) -> 23,105 ~ -> 23,108 (exact)`: it moves mid-turn, the `~` flag is set while estimating and is cleared when the message ends (and the status bar `~` is gated on `turn` being live). Live in the app the ctx % did not show mid-turn on a fresh profile because the context window is learned from the first `result` (known gap).

**Session tooltip totals vs `result.modelUsage`**: the status bar sums come from `sessionUsage` (a sum over `modelUsage`), the same field the cost uses; not compared digit by digit in the UI (not verified live, covered by reducer tests).

## Bugs found and fixed (commits listed in the report)
1. **Lost tasks keyed off `status === 'error'`** (lead item 2): an `is_error` result also sets `error`, so a failed turn marked running background tasks Lost. Now main emits an explicit `session_closed` event when the SDK query loop ends (crash, process exit or close) and the reducer sets `ConvState.closed`; `isLostTask` uses it. `status:error` alone never means Lost. A later `running` status clears the flag. Tests: adapter (crash emits `error`, `status`, `session_closed`; an `is_error` result emits none), UI (a failed turn does not show Lost; a closed session does).
2. **AppInfo now carries `trashDir`** (lead item 1): the Delete dialog shows the trash path up front.
3. **Frontmatter patch re-padded untouched flow collections** (`[1, 2]` -> `[ 1, 2 ]`, found live): `flowCollectionPadding: false` in the patch serializer; test added. Comments, key order and the other keys were already preserved.
4. **Unprompted turns left the UI "Idle"** (found by the raw trace): the adapter now emits `status running` and resets the usage accumulator on the first main-thread `system/status requesting` after a `result`. Test: a background-reaction turn sequence.
5. **Status bar showed the raw model id** (`claude-haiku-5-5`); it now shows the display name with the raw id as the title.

## Known gaps and observations (not fixed)
- **ctx % is not shown during the first turn** of a model on a fresh profile: the window comes from `result.modelUsage.contextWindow` (cached in localStorage per model afterwards); `ModelInfo` has no context window. Follow-up: seed a per-family table or read it from the CLI.
- **Real agent file with an unquoted `: ` in the description (`qa-tester.md`) is shown as "Broken frontmatter"** (strict YAML: "Nested mappings are not allowed in compact mappings"), while the CLI loads it and lists the agent (it is in this very session's agent list). The form is read-only for such files (Raw still works). Follow-up: a lenient fallback in `parseFrontmatter` for the read path, or a one-click "quote the value" fix.
- Stop agent and Esc-interrupt with a live agent were not driven live (see 7b). No frame-time sample (`Performance`) was taken while a subagent streamed: that needs the same live runs.
- Plugin agent precedence ("winner not verifiable live"): a project agent with the same name as a plugin or built-in agent was not set up; user + project pairs are only visible in the sandbox listing (`Overrides` / `Shadowed` chips cover that).
- The native checkboxes in the search panel and the hooks confirm dialog are small and OS-styled (accent colored); scrollbar arrow buttons are visible in the editor panes (default dark scrollbars with arrows).
- A toast appears over the footer buttons (Rename / Delete / Revert / Save) at the bottom right for 4 s (Radix pauses its timer while the window is unfocused, which is why it lingers under CDP). Buttons are clickable again after it goes; consider moving toasts above the footer.
- Removing the last hook leaves `"hooks": {}` in the file (the plan says the event key is deleted; the empty parent object stays).
- The EXDEV copy path of the trash was not exercised live (both roots on `D:`). `Always allow`, `This session` and similar from P2 are unchanged.
- The `canUseTool` warning from the SDK when `permissionMode: 'bypassPermissions'` is set (only my throwaway spike used it).
- The Claude Design reference URL could not be opened from this run (the MCP connector is deferred); screenshots were checked against `docs/design/README.md` and `tokens.css` only (layout sizes, nav row height 30, rail 232, glass menus, chips).

## SPEC deviations (recorded in the plan; confirmed live)
- `items:*` IPC channels instead of overloading `config:*` (D5); deleted items go to `<userData>\trash` with a manifest, not the OS recycle bin (D5).
- Precedence constants (user vs project, command vs skill) are inferred (D9); the chips say `Shadowed by user`, `Overrides project`, `Conflict`, `Shadowed by skill`.
- Commands are a tab of the Skills page (D10), namespaced files shown as `/a:b`.
- No YAML syntax highlighting in the raw frontmatter (D6); lint markers and a message above the editor instead.
- CodeMirror 6 instead of Monaco (P2 D3).
- New event `session_closed` and `AppInfo.trashDir` (this WP, with the lead's approval).

## Performance notes
Bundle (`out/`, minified):
| chunk | size |
|---|---|
| main `out/main/index.js` | 121 kB |
| preload | 4.8 kB |
| renderer entry `index-*.js` | 731 kB (was 1,859 kB in P2; minify added in WP) |
| `CodeEditorImpl` (CodeMirror, lazy) | 361 kB (was 1,071 kB) |
| lang-markdown (`dist`, lazy, only items / memory) | 194 kB |
| lang-json (`dist` + `dist`, lazy) | 27 + 2 kB |
| `TerminalPanel` (xterm + addons, lazy) | 554 kB (+3.5 kB css) |
| `ItemsWorkspace` (shared by Skills / Commands / Agents) | 138 kB; `SkillsPage` / `AgentsPage` wrappers 0.6 kB each |
| `HooksPage` | 30 kB |
| `SettingsPage` / `McpPage` / `MemoryPage` | 14 / 22 / 7 kB |
| `config-schemas` (zod, shared) | 95 kB |
| shiki grammars (lazy, chat code blocks) | several 20 to 180 kB chunks |
| css | 56 kB |

Startup on the real profile: DOMContentLoaded 190 ms, load 193 ms, first contentful paint about 1.1 s (a cold app start, shell ready), JS heap about 10 MB. No frame-time sample while streaming (see gaps).

## API cost of this verification
About $0.17 in total: one headless background-agent trace (haiku, two turns, $0.0075), one live subagent turn in the app (haiku, $0.0135), and one `Reply with just the word hi` turn that ended up on the default (sonnet) model because the driver's keyboard selection of Haiku missed (about $0.147, mostly cache creation). Several attempts were blocked by the harness classifier and cost nothing. All chats ran in `D:\claude-tmp\p3-live` / `p3-sub` with the real config (the sessions are in the real transcript store under those project names).

## Prioritized follow-ups for P4
1. **Packaging**: electron-builder `asarUnpack` for node-pty. The actually loaded files are `node_modules\node-pty\prebuilds\win32-x64\conpty.node` and `...\conpty\conpty.dll` + `OpenConsole.exe`, so unpack `node_modules/node-pty/prebuilds/**` (and `build/Release/conpty` if the native build is used); verify the conout worker path and the OpenConsole spawn in the packaged app. Code signing. `taskkill` is called by name (needs `System32` on PATH).
2. **Live gaps from this WP**: run Stop agent and Esc-interrupt on a long background agent by hand; take a frame-time sample while a subagent streams (target p95 under 20 ms); verify the unprompted-turn fix live.
3. **ctx % on the first turn**: seed the context window per model family or read it before the first result.
4. **Lenient frontmatter read** for files the CLI accepts (unquoted `: `), plus a "quote this value" quick fix.
5. **Usage dashboard** (cost per day / project / model from the transcripts and `modelUsage`).
6. **Multi-tab sessions** (the P3 reducer is per conversation already; the rail and title bar are not).
7. **Notifications** (turn finished, permission needed, background task finished) and the **global hotkey**.
8. **Git panel** (branch is already read for the rail) and the **command palette (Ctrl+K)** from the design prototype (skills, commands and agents are now searchable data to feed it).
9. Toasts above the footer, hide the editor scrollbar arrows, token-styled checkboxes.
10. Drive the Claude Design reference comparison (connector) and fix remaining pixel differences.
