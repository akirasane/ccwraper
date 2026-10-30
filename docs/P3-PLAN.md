# P3 Plan (live activity + skills / commands / agents / hooks editors)

Date: 2026-10-30. Inputs: `SPEC.md` (v0.1, sections 4, 5, 7, 8, 9, 10), `docs/P2-PLAN.md` (format), `docs/P2-FINDINGS.md`, `docs/P1-FINDINGS.md`, `docs/design/README.md`, current `src/` (P2 complete, 374 tests), and the installed SDK typings `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` + `sdk-tools.d.ts` (0.3.312) and `node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.d.mts`.

P3 scope has two streams:
- **Stream A, live activity (lands first):** realtime token counters and live context %, working timers, subagent cards with a nested tree.
- **Stream B, config editors (SPEC section 8 P3):** skills, commands, agents, hooks. Plus the P2 follow-ups in D12.

Out of P3 (deferred on purpose): `agentProgressSummaries` (costs a fork every ~30 s per subagent), subagent metrics for past sessions (`listSubagents` / `getSubagentMessages`), editing a skill's supporting files (listed read-only), plugin hooks listing, restore-from-trash UI, YAML syntax highlighting (`@codemirror/lang-yaml`), the `/context` category breakdown (`getContextUsage`), usage dashboard, multi-tab, packaging (P4).

---

## 1. Decisions

The SDK facts below were read from the installed `.d.ts` files. Nothing was installed into the repo. The npm registry was queried read-only (`yaml` 2.9.1, zero dependencies, CJS + ESM). The user's real `~/.claude` was not read.

### D1. What the SDK exposes during a turn (verified names)
| Source | Field | When | Exact? |
|---|---|---|---|
| `stream_event` `event.type === 'message_start'` | `event.message.usage.{input_tokens, cache_read_input_tokens, cache_creation_input_tokens, output_tokens}` | start of every API call | **exact** prompt size; `output_tokens` is a tiny placeholder |
| `stream_event` `message_delta` | `event.usage` (`BetaMessageDeltaUsage`, all **cumulative** for that message) | end of the message (before `message_stop`) | **exact** output for that call |
| `stream_event` `content_block_delta` | `delta.type` `text_delta` / `thinking_delta` / `input_json_delta` (`partial_json`) | while streaming | char counts only, no tokens |
| `stream_event` wrapper | `parent_tool_use_id` (null = main thread), `ttft_ms?` | every frame | - |
| `system` `thinking_tokens` | `estimated_tokens` (running total for the block), `estimated_tokens_delta` | redacted-thinking phase | **estimate** (the SDK says "not the authoritative billed output_tokens") |
| `assistant` | `message.usage` | each streamed assistant frame, repeated for the same `message.id` (one block per frame) | exact but duplicated per frame, so not summed |
| `result` | `usage` | turn end | "MAIN AGENT LOOP ONLY ... per-turn": **summed over the turn's main-loop calls** |
| `result` | `modelUsage[model].{inputTokens, outputTokens, cacheReadInputTokens, cacheCreationInputTokens, thinkingTokens?, costUSD, contextWindow, maxOutputTokens}` | turn end | **cumulative for the session**, main + subagents + compaction; "the correct field for token/cost accounting" |
| `result` | `total_cost_usd` (cumulative), `duration_ms`, `duration_api_ms`, `num_turns` | turn end | exact |
| `tool_progress` | `tool_use_id`, `tool_name`, `parent_tool_use_id`, `elapsed_time_seconds`, `task_id?` | heartbeats for long tools | exact (CLI clock) |

**Finding (a bug in P1/P2):** `selectContextUsage` takes `lastResult.usage` (input + cache read + cache creation) as the context size. `result.usage` is summed over every main-loop call of the turn, so a turn with 5 tool round-trips reports about 5x the real context. P1 saw plausible 3-9% only because its turns were short. P3 takes the context size from the **latest main-thread `message_start`** instead (D2).

### D2. Token accounting: main aggregates, the renderer only displays
The aggregation happens in `sdk-adapter.ts`, so `input_json_delta` text never crosses IPC. The adapter keeps a per-turn accumulator. It resets on `send()` and on the initial prompt, and it is closed by `result`.
- **Per API call** (keyed by `message.id` from `message_start`, separately per `parent_tool_use_id`):
  - `prompt` = input + cache read + cache creation from `message_start` (exact)
  - `out` = `message_delta.usage.output_tokens` once it arrives (exact)
  - before that, `out` is an estimate: `ceil(chars / 4)` over text, thinking and `partial_json` deltas, or the `thinking_tokens` `estimated_tokens` when that is larger (redacted thinking streams no text)
- **Turn usage** = the sum over this turn's calls, main and subagent streams together: input, output, cache read, cache creation. `exact` is false while any call has no `message_delta` yet.
- **Context (live ctx %)** = the latest **main-thread** call's `prompt + out`. `contextExact` follows that call.
- **Session totals** come from the latest `result.modelUsage` (sum over models), which is exact and includes subagents. They are added to the `result` event as `sessionUsage`. `costUsd` stays `total_cost_usd`, unchanged.
- **Emission:** `usage_live` goes out on every `message_start` and `message_delta`, and at most every 250 ms while deltas arrive (trailing flush), so about 4/s. The renderer coalesces it per animation frame like the text deltas.
- **Context window before the first result:** the renderer caches `contextWindow` per model id in `localStorage` (`ccwrap.ctxWindow`), written from every `result`. With no cached value, ctx shows `--` until the first result. `getContextUsage()` is not called: it is a control request in the middle of a turn, and we want no extra SDK traffic.
- **UI marking:** estimates are prefixed with `~`, use a dotted underline, and carry the tooltip "Estimated from streamed text (about 4 characters per token). The exact count arrives when the message completes." Exact values have no marker. Timers are local wall-clock and carry no marker.

### D3. Working time
- **Turn timer:** `turn.startedAt` is the renderer clock at `submit` (or at the first `status: running` when there is no submit, as on a resume). It stops at `result`, and the shown value then snaps to `result.duration_ms`.
- **Thinking time:** the existing thinking parts already have `startedAt` / `endedAt`. The working row shows "thinking Ns" while a thinking part is open.
- **Per-tool duration:** the existing `startedAt` / `endedAt`. While a tool is running, its card ticks. A `tool_progress.elapsed_time_seconds` overrides the local start when it is larger (it is CLI-side and survives renderer lag).
- **Session time:** `session.workMs` = the sum of `result.duration_ms` over the turns of this app run, plus the live turn. `apiMs` = the sum of `duration_api_ms`. Both are shown in the status bar tooltip.
- **One shared ticker:** a `useNow(1000)` hook backed by one `setInterval` for the whole app. Only components that are visible and running subscribe to it (the working row, the status bar turn segment, running subagent and tool cards). The ticker never writes to the chat store.

### D4. Subagents: SDK events and the normalized model
Verified message types (all `type: 'system'`):
- `task_started`: `task_id`, `tool_use_id?`, `description`, `subagent_type?`, `task_type?`, `parent_task_id?`, `spawn_depth?`, `is_backgrounded?`, `skip_transcript?`, `ambient?`, `prompt?`
- `task_progress`: `task_id`, `tool_use_id?`, `description`, `usage: {total_tokens, tool_uses, duration_ms}`, `last_tool_name?`, `summary?` (the summary only arrives with `agentProgressSummaries`)
- `task_updated`: `task_id`, `patch: {status?: pending|running|completed|failed|killed|paused, description?, end_time?, error?, is_backgrounded?}`
- `task_notification`: `task_id`, `tool_use_id?`, `status: completed|failed|stopped`, `summary`, `usage?`, `output_file`
- `background_tasks_changed`: a level signal with REPLACE semantics. **Not mapped in P3:** the edge events are enough for the cards, and the SDK says not to correlate it with the edge stream.

Other facts that matter here:
- `Query.stopTask(taskId)` exists and emits `task_notification` with status `stopped`.
- The tool is **`Agent`** in this CLI (`AgentInput {description, prompt, subagent_type?, model?, run_in_background?}`). The legacy name `Task` is also accepted.
- **Agents run in the background by default** (the `AgentInput.run_in_background` doc). The spawning `tool_result` can come back immediately ("running in the background") while the task keeps running. The `result` can be held back until background work finishes (the `session_state_changed` doc). So the subagent card's status comes from the **task events, not from the tool card status**.

Decisions:
- New events `task_started` / `task_progress` / `task_updated` / `task_ended` / `tool_progress` (contract 2.3). Tasks with `ambient` or `skip_transcript` are kept in state but hidden from the cards and from the "N agents running" count.
- **Adapter fix (a real bug found while reading):** `mapMessage` keeps one `state.msgId`. A subagent's `message_start` overwrites it, so main-thread deltas that interleave with a background agent would attach to the wrong message. The adapter now keeps the msgId per `parent_tool_use_id`. **Subagent `text_delta` / `thinking_delta` are not emitted into the transcript.** They only feed the token accumulator (D2). The subagent's final `assistant_message` (with `parentToolUseId`) still arrives and renders inside its card.
- **Interrupt visibility:** Esc / Stop still interrupts the whole query. A running subagent card shows "stopping" after the user interrupts, then the `task_ended` status, or "stopped" on `status: idle` when no event came. Each running card also has a small **Stop agent** button that calls the new `session:stopTask`.
- **Tree:** the chat list stays one flat virtualized list of **top-level items**. An item whose `parentToolUseId` names a known `Agent` / `Task` tool is rendered **inside** that tool's `SubagentCard`, not as its own row. Nested agents (`spawn_depth > 1`) recurse, with the indent capped at 3 levels. Orphans (parent unknown, for example in history) stay top-level with the current `pl-4` indent.
- **Card content:**
  - header: description, `subagent_type` chip, status pill (running / done / error / stopped), elapsed, `↓ tokens` (CLI `total_tokens`, exact at each progress event), tool-call count, current tool (`last_tool_name`, else the newest running child tool)
  - a collapsible body with the child items
  - collapsed by default once done; expanded with a live tail while running
  - at most the 50 newest children are rendered, behind a "Show N earlier" button
- **Perf (SPEC 10 rule):**
  - task events are coalesced per frame together with `usage_live` / `tool_progress`
  - expand / collapse is instant (no height animation). Children fade in with opacity only, and the virtualizer's `measureElement` picks up the new height
  - the spinner and the tick-up counters use transform / opacity only
  - there are no `motion` layout animations in `MessageList`
- **Elapsed for a running task** = `durationMs` from the last `task_progress` + (now - the time it was received). This is local interpolation, and it is replaced by the CLI value at each progress event.
- History replay: no task events exist, so an Agent card from history shows its children and the tool duration only ("details unavailable for past sessions").

### D5. Stream B file model and IPC: extend `ConfigFileRef`, add one `items:*` family
- **Read and write reuse `config:read` / `config:write`**: the same hash conflicts, first-write backups and own-write suppression as P2. `ConfigFileRef` gains item refs:
  - `{kind:'skill'|'command'|'agent', scope:'user'|'project', cwd?, name}`
  - `{kind, scope:'plugin', plugin, name}`, which is read-only: a write returns `code:'read_only'`
- **New channels**, all main-resolved. The renderer still never sends paths.
  - `items:list {kind, cwd?}`
  - `items:create {kind, scope, cwd?, name, text}`
  - `items:rename {ref, newName, baseHash, text?}`
  - `items:delete {ref, baseHash}`
  - **SPEC deviation:** SPEC section 5 lists `skills:*` / `commands:*`. One `items:*` family with a `kind` field has the same semantics, needs one service and covers agents.
- **Layout and names:**
  - skill = directory `<root>/<name>/SKILL.md`. Other files in the dir are listed read-only (at most 50 names).
  - command = `<root>/<a>[/<b>[/<c>]].md`. Subfolders are namespaces, up to 3 levels deep. The name is the relative path with `/`.
  - agent = `<root>/<name>.md`, flat.
  - roots: user `<configDir>/{skills,commands,agents}`, project `<cwd>/.claude/{skills,commands,agents}`.
- **Name rules:**
  - Ref names (they must accept existing files): segments `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`, with no `..` segment.
  - New names (create / rename) are strict: segments `^[a-z0-9]+(?:-[a-z0-9]+)*$`, at most 64 characters, and at most 3 segments for commands, 1 otherwise.
  - Main checks that the resolved path stays under the root (`path.relative` with no `..` and not absolute) as well.
- **Plugins:** the init message carries `plugins: {name, path, version?}[]` (verified). `SessionManager` feeds a main-side `PluginRegistry` (a union over all inits in this app run). The listing scans `<plugin.path>/skills/*/SKILL.md`, `<plugin.path>/commands/**/*.md` and `<plugin.path>/agents/*.md`.
  - With no session yet, `pluginsKnown:false` and the UI says "Plugin items appear after a session has started in this app."
  - `installed_plugins.json` / plugin cache layouts are **not** parsed: they are undocumented formats (SPEC 9 risk).
- **Delete = move to trash:** the item moves to `<userData>/trash/<ISO stamp>-<kind>-<scope>-<name with / as __>/`, with a `ccwrap-trash.json` (original path, kind, scope, time) next to the payload.
  - `fs.rename` first, with the atomic-write retry backoff for `EPERM` / `EBUSY` / `EACCES`.
  - On `EXDEV` (userData on C:, project on D:), fall back to `fs.cp` recursive, then verify (same file list, sizes and sha256), and only then remove the source. The source is never removed unless the copy verified.
  - No auto-purge. The toast shows the trash path. **No `rm` of user content anywhere.**
- **Rename:** check `baseHash` against the main file, fail with `exists` if the target exists, `fs.rename` (the same retry), then optionally write `text` at the new path. The UI uses that to update `name:` in the frontmatter in the same step. The source path is recorded as an own write, so the watcher does not raise a "deleted" banner.
- **Create:** `baseHash` semantics like a missing file. Fails with `exists`. `mkdir -p` the skill dir.
- **Write validation in main:** only "the frontmatter, if present, parses as a YAML mapping" (`invalid_frontmatter`). Everything else is a renderer warning, the same rule as P2 settings: never reject a key a newer CLI knows. Files are written UTF-8 without a BOM and keep their EOL style (as memory does).
- **Watcher:** add directory watches with chokidar `depth`: skills 1, commands 3, agents 0, for user and project roots. Emit `fs:changed {kind:'skill'|'command'|'agent', scope, cwd?, path}` with a 150 ms debounce. A missing root is detected through a depth-0 watch of its parent (`<configDir>` already exists; the project `.claude/` is watched at depth 0), and the root is added when it appears. Plugin dirs are not watched (read-only; the list refreshes on the next init).

### D6. Frontmatter: the `yaml` library (2.9.1), not hand-rolled
- The fields in use include multi-line `description`, quoted strings, lists (`allowed-tools`, `tools`, `skills`, `paths`) and nested `hooks` / `mcpServers` in agent frontmatter. A hand-rolled parser would mangle these.
- `yaml`'s `Document` API keeps comments, key order and node styles of untouched nodes. It has no dependencies, works in both main and renderer, and needs no WASM or eval (CSP unchanged).
- **`src/shared/frontmatter.ts` (pure):**
  - `parseFrontmatter(text)`: frontmatter only at byte 0 (after a BOM), `---` fences, LF or CRLF
  - `patchFrontmatter(text, ops)` for top-level keys: `doc.set` / `doc.delete` on the parsed Document, then `toString({lineWidth: 0})`
  - `replaceBody`
  - `keyRange` (for diagnostics)
- **Untouched bytes stay verbatim:** with no ops, the text is returned unchanged (never re-serialized). The body after the closing fence is never re-serialized. If the frontmatter does not parse, the form is read-only and the Raw tab is offered (the same rule as P2 settings).
- Main uses `parseFrontmatter` for listing (`name`, `description`) and for the `invalid_frontmatter` check. The renderer uses it for the forms. `yaml` ends up in the main bundle and in the lazy items-page chunks, never in the renderer entry.
- No `@codemirror/lang-yaml`: the Raw tab is markdown mode. YAML errors show as diagnostics from `parseFrontmatter` error ranges.

### D7. Validation rules (renderer warnings; only parse errors block)
Shared zod `looseObject` schemas in `config-schemas.ts`. Issues map to editor diagnostics through `keyRange`.
- **Skill** (`SKILL.md`):
  - `name`: if present, `^[a-z0-9-]{1,64}$`; warn when it differs from the directory name
  - `description`: warn if missing or empty, and when longer than 1024 characters
  - `allowed-tools`: a string (comma or space separated) or a string list
  - `model`, `argument-hint`, `disable-model-invocation` (boolean), `user-invocable` (boolean), `context` (`fork`), `agent`, `paths` (string or list), `version`, `license`
- **Command** (`*.md`): `description` (warn if missing), `allowed-tools`, `argument-hint`, `model`, `disable-model-invocation` (boolean).
- **Agent** (`*.md`):
  - `name` (required: warning) and `description` (required: warning); warn when the filename stem differs from `name` (the CLI uses `name`)
  - `tools` / `disallowedTools`: comma string or list
  - `model` (`inherit` or an alias or id)
  - `permissionMode` (`PermissionModeSchema`)
  - `color` (red, blue, green, yellow, purple, orange, pink, cyan)
  - `maxTurns` (int >= 1), `memory` (`user|project|local`), `effort` (`low|medium|high|xhigh|max` or an int), `background` (boolean)
  - `skills` (list), `mcpServers` / `hooks` (raw only), `initialPrompt`
- **Tool-rule entries** must match `^[A-Za-z0-9_*:-]+(\(.*\))?$`. A name that is not `mcp__*` and not in the latest `init.tools` gets an info-level warning ("not a tool in the current session").
- **Model:** accepted without a warning when it is `inherit`, `default`, one of the aliases in `ModelMenu` (`opus`, `sonnet`, `fable`, `haiku`), starts with `claude-`, or equals a `supportedModels()` `value` / `resolvedModel`. Anything else gets a warning.
- **Hooks:** see D8.

### D8. Hooks editor: settings patch, never executed
- Hooks live in settings under `hooks: {[Event]: [{matcher?, hooks: [entry]}]}` (verified SDK `Settings.hooks`). The editor has User / Project / Local tabs and writes with `applyPatch(text, [{op:'set', path:['hooks', event], value}])` from P2 `settings-patch.ts`.
  - A group or entry being edited is spread over its old object, so unknown keys survive.
  - An emptied event key is deleted.
  - The `hooks` object is deleted only if the patch created it.
- **Event names:** a copy of the SDK's `HOOK_EVENTS` (33 names in 0.3.312) in `src/shared/hook-events.ts`. A test in `sdk-settings.test.ts` (an SDK boundary file) asserts the copy equals the runtime export, so an SDK bump fails loudly. Unknown event keys found in a file are kept and shown with "unknown event (newer CLI?)". They are never dropped.
- **Entry types:**
  - `command`: `command` required; `args?`, `shell?: bash|powershell`, `timeout?` (seconds, int > 0), `async?`, `asyncRewake?`, `once?`, `if?`, `onFailure?: continue|block`, `statusMessage?`
  - `prompt` and `agent`: `prompt` required; `model?`, `timeout?`, `continueOnBlock?` (prompt only)
  - `http`: `url` required (valid URL); `headers?` (values masked like MCP), `allowedEnvVars?`, `timeout?`, `onFailure?`
  - `mcp_tool`: `server` and `tool` required; `input?` as JSON
  - unknown type: a read-only JSON view that can be edited in the per-entry JSON box
- **Matcher:** optional free text. It gets a warning if it does not compile as a JS RegExp (it is not `*` and not a `|` list of words). Per-event hints: tool events (`PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `PermissionRequest`, `PermissionDenied`) take tool names or a regex; `SessionStart` takes `startup|resume|clear|compact`; `PreCompact` / `PostCompact` take `manual|auto`; `SubagentStart` / `SubagentStop` take an agent type. Other events show "matcher usually unused".
- **Safety:**
  - A permanent banner: "Hooks run automatically with your user account's permissions whenever the event fires, in every Claude Code session that loads this file (the CLI too). ccwraper never runs hooks." There is no Test or Run button, and no "Run in terminal" on hook commands.
  - Saving an added or changed `command` / `http` / `mcp_tool` entry opens a confirm dialog that lists the exact new or changed commands and URLs, with Save as the non-default button.
  - For **Project** scope the dialog also says the file is usually committed and the hooks will run for everyone who opens the repo, and it needs a checkbox.
  - The effective `disableAllHooks` is shown as a banner. Managed hooks are listed read-only.
- **Effective view:** hooks from all `resolveSettings` sources are merged (hooks are not overridden), listed per event with source chips, in source order.

### D9. Precedence and shadowing display
These are constants in `src/shared/item-precedence.ts`, best knowledge of current Claude Code docs. The integration WP cross-checks agents live.
- **Skills:** user beats project for the same name (docs: "enterprise > personal > project"). Plugin skills are namespaced (`plugin:skill`), so they never shadow.
- **Agents:** project beats user beats plugin.
- **Commands:** no documented winner between user and project, so both rows get a "same name also in <scope>" conflict warning. A skill with the same name as a command shadows the command ("skill takes precedence").
- **Live join:** `init` now carries `agents` / `skills` names (verified fields), so a row shows "loaded in session" when its name appears in the active conversation's `meta`.

### D10. UI placement
- Left rail: Sessions, MCP, Memory, **Skills** (tabs: Skills | Commands, because the CLI treats commands as skills), **Agents**, **Hooks**; Settings stays pinned at the bottom. That is 6 rows of 30 px, and the session list keeps at least 4 rows at 1024x640.
- Item pages:
  - a two-pane layout: the list on the left (grouped Project / User / Plugin, filter box, shadow and loaded chips) and the editor on the right
  - editor tabs **Form** (known fields + the body in a markdown CodeEditor) / **Raw** (the whole file)
  - a header with the copyable path and New / Rename / Delete; plugin items are read-only with a lock chip
  - the same conflict and changed-on-disk banners as P2
  - dirty state is registered in the dirty registry under `items:<refKey>`. Switching the selected item while dirty goes through `guard()`
- Create dialog: scope (Project is disabled without a cwd), name (strict rule, live validation), and the kind template. Project scope shows "this writes into the repository's `.claude/` folder".

### D11. Live-activity placement
- **Composer working row** (replaces the P1 `WorkingIndicator`; visible for the whole running turn): `Working... 12s · ↓ ~1.2k tokens · esc to interrupt`. The verb comes from the state:
  - `Thinking... (4s)` while a thinking part is open
  - `Running Bash... 3s` while a top-level tool runs
  - `Waiting for approval`
  - plus `· 2 agents` when any non-ambient task is running

  The shimmer is reduced-motion aware, as today.
- **Status bar:**
  - live `ctx 42%` (`~` when estimated), now from the D2 context source
  - during a turn, `turn 12s ↑ 8.1k ↓ ~1.2k`
  - after a turn, the last turn's exact numbers
  - the cost meter as today
  - a tooltip on the tokens segment: session totals per model (input / output / cache read / cache write / cost) plus session work time and API time

### D12. P2 follow-ups folded into P3
| # | Item | Resolution | WP |
|---|---|---|---|
| 1 | The model chip shows the raw id after the first turn | `ModelOption.resolvedModel?` (verified in `ModelInfo`). The adapter maps it, and `ModelMenu` labels `meta.model` by matching `value` or `resolvedModel` | WP1, WP8 |
| 2 | The CodeMirror search panel is unthemed | Style `.cm-panels`, `.cm-search`, its inputs, buttons, labels and checkboxes (`accent-color` through a token variable) in `cm-theme.ts`; no hex | WP6 |
| 3 | The editor chunk is 1,071 kB | Cause confirmed: `@codemirror/lang-markdown` statically pulls `lang-html`, `lang-css`, `lang-javascript` and `autocomplete` (all present in `node_modules`). Fix: load the language support with dynamic `import()` inside the editor and reconfigure `languageCompartment` when it resolves, so the JSON editors never load the markdown / html / js graph. Target: the base editor chunk <= 450 kB, markdown in its own chunk | WP6 |
| 4 | `claude mcp list` says "Pending approval" for a server approved in settings | **Decision: document, do not change behaviour.** Sessions honour `enabledMcpjsonServers` (verified live in P2). An approved project row gets an info tooltip: "Approved in .claude/settings.local.json. `claude mcp list` may still print Pending approval; sessions use this setting." | WP6 |
| 5 | A shell that exits on its own leaves `conhost.exe` | **Timeboxed (half a day), shippable either way.** Try in order: (a) call the pty's `kill()` / the tree kill from `onExit` after 100 ms; (b) `useConptyDll: true` behind a const. Measure with a scratch probe outside the repo. Adopt only a variant that leaves no conhost after a natural `exit` and passes the existing pty tests; otherwise record the result in the findings and leave it for P4 | WP7 |
| - | Schema hints in the raw editors (P2 follow-up 3) | Frontmatter and hook issues become CodeEditor diagnostics | WP5, WP9, WP10 |

### D13. Cross-cutting rules for all agents (P2 D10 still applies)
- **WP0 is the sole writer** of `package.json`, `package-lock.json`, `src/shared/**` (except the carve-out for `src/shared/frontmatter.ts` + test, which WP3 owns), `src/preload/**`, tsconfigs, `vitest.config.ts`, `tests/setup-*.ts`, `src/main/index.ts`, `src/main/ipc/index.ts` and `src/main/paths.ts`. A missing dependency or contract change is reported to the lead.
- **The only new dependency is `yaml` 2.9.1** (exact pin, runtime). No other installs.
- **Never touch the real user config.** Tests use the P2 `tests/setup-node.ts` isolation (temp `CLAUDE_CONFIG_DIR` / `USERPROFILE` / `HOME`), `mkdtemp` project dirs and a temp `userData` / trash dir injected by constructor. A guard test asserts the trash dir is under the temp root. Fixtures are synthetic (`C:\fixture\proj`).
- **Live SDK runs cost money.** Only WP1 (one spike), WP8 (one dev-app check) and WP11 run them. The spike uses `settingSources: []` and cwd `D:\claude-tmp\p3-sub`. Budget: WP1 under $0.05, WP8 under $0.10, WP11 under $0.75.
- **Hooks are never executed by ccwraper code or tests.** Hook fixtures use harmless placeholder commands (`echo fixture`), and no test spawns them.
- **No `rm` / `unlink` / `rmdir` of user content.** The only removal is the verified EXDEV fallback in D5 and the temp-file cleanup in `atomic-write`.
- **No hex in components** (the guard stays). Agent `color` swatches map names to token classes.
- Zustand 5 + React 19: selectors must return stable references. Derived arrays (top-level items, children per tool, running tasks) are memoized per `items` / `tools` / `tasks` reference (a WeakMap cache in `selectors.ts`) or read with `useShallow`. A new array from a selector on every call loops `useSyncExternalStore`.
- Every WP verifies with `npm run typecheck`, `npm test` and `npm run build`. UI WPs add Testing Library tests with a mocked `window.ccwrap`. The P0 electron install quirk still applies.

---

## 2. Frozen contracts (WP0 lands these first)

### 2.1 `src/shared/channels.ts` (add)
~~~
sessionStopTask: 'session:stopTask'
itemsList: 'items:list'   itemsCreate: 'items:create'   itemsRename: 'items:rename'   itemsDelete: 'items:delete'
~~~

### 2.2 `src/shared/config.ts` (change)
~~~ts
export type ItemKind = 'skill' | 'command' | 'agent'
export type ItemScope = 'user' | 'project'
export type ConfigFileRef =
  | { kind: 'settings'; scope: SettingsScope; cwd?: string }
  | { kind: 'memory'; scope: MemoryScope; cwd?: string }
  | { kind: ItemKind; scope: ItemScope; cwd?: string; name: string }        // cwd required for project
  | { kind: ItemKind; scope: 'plugin'; plugin: string; name: string }      // read-only
export type ConfigErrorCode =
  | 'conflict' | 'invalid_json' | 'not_object' | 'bad_ref' | 'io'
  | 'invalid_frontmatter' | 'read_only' | 'exists' | 'not_found' | 'bad_name'

export interface ConfigItemSummary {
  ref: ConfigFileRef
  kind: ItemKind
  scope: ItemScope | 'plugin'
  name: string                // skill dir / command rel path ('a/b') / agent stem
  plugin?: string
  pluginVersion?: string
  path: string                // display only
  description?: string
  frontmatterName?: string
  files?: string[]            // skills: other files in the dir, relative, max 50
  error?: string              // frontmatter parse error or unreadable file
  mtimeMs?: number
  readOnly: boolean
}
export interface ConfigItemList {
  kind: ItemKind
  items: ConfigItemSummary[]
  roots: Array<{ scope: ItemScope; path: string; exists: boolean }>
  pluginsKnown: boolean
}
export type ItemMutationResult =
  | { ok: true; ref: ConfigFileRef; snapshot?: ConfigSnapshot; trashPath?: string; backupPath?: string }
  | { ok: false; code: ConfigErrorCode; message: string; current?: ConfigSnapshot }

export interface FsChangedPayload {
  kind: 'settings' | 'memory' | 'mcp' | ItemKind
  scope?: SettingsScope | MemoryScope | McpScope | ItemScope
  cwd?: string
  path: string
}
export interface ModelOption { value: string; displayName: string; description?: string; resolvedModel?: string }
~~~

### 2.3 `src/shared/events.ts` (change)
~~~ts
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'stopped' | 'killed' | 'paused'
// init: add
  agents?: string[]; skills?: string[]; plugins?: { name: string; path: string; version?: string }[]
// result: add
  durationApiMs?: number
  /** Sum over result.modelUsage (cumulative session, main + subagents). */
  sessionUsage?: Usage & { costUsd: number; thinkingTokens?: number }
// new members
| { t: 'usage_live'
    /** latest main-thread call: prompt (input + cache read + cache creation), exact */
    contextTokens: number
    /** output of that call: exact after its message_delta, else estimated */
    contextOutputTokens: number
    contextExact: boolean
    /** sum over this turn's calls (main + subagent streams) */
    turn: Usage
    exact: boolean
    apiCalls: number }
| { t: 'task_started'; taskId: string; toolUseId?: string; description: string; subagentType?: string; taskType?: string
    parentTaskId?: string; depth?: number; background?: boolean; ambient?: boolean; hidden?: boolean }
| { t: 'task_progress'; taskId: string; toolUseId?: string; totalTokens: number; toolUses: number; durationMs: number
    lastToolName?: string; summary?: string }
| { t: 'task_updated'; taskId: string; status?: TaskStatus; description?: string; error?: string; background?: boolean }
| { t: 'task_ended'; taskId: string; toolUseId?: string; status: 'completed' | 'failed' | 'stopped'; summary?: string
    totalTokens?: number; toolUses?: number; durationMs?: number }
| { t: 'tool_progress'; toolUseId: string; toolName: string; parentToolUseId?: string; elapsedMs: number; taskId?: string }
~~~
`text_delta` / `thinking_delta` are unchanged. They are main-thread only from P3 on (D4).

### 2.4 `src/shared/ipc.ts` (zod schemas + `CcwrapApi`)
- `ConfigFileRefSchema` gains the item variants:
  - `name` uses the ref-name rule (D5): one segment for skills and agents, 1-3 segments for commands, enforced by a `superRefine` on `kind`
  - `plugin` matches `^[A-Za-z0-9_.@-]{1,128}$`
  - `cwd` is required when scope is `project`, `local` or `projectDotClaude` (the refine is generalized)
- `ItemKindSchema`, `ItemScopeSchema`, `NewItemNameSchema` (the strict D5 rule, with the segment count by kind)
- `ItemsListSchema {kind, cwd?}`
- `ItemsCreateSchema {kind, scope: ItemScopeSchema, cwd?, name: NewItemName, text: max 2_000_000}` (refine: `cwd` for project)
- `ItemsRenameSchema {ref (non-plugin), newName: NewItemName, baseHash: string, text?}`
- `ItemsDeleteSchema {ref (non-plugin), baseHash: string}`
- `SessionStopTaskSchema {localId, taskId: z.string().min(1)}`
- `CcwrapApi` adds:
~~~ts
items: {
  list(args: ItemsListArgs): Promise<ConfigItemList>
  create(args: ItemsCreateArgs): Promise<ItemMutationResult>
  rename(args: ItemsRenameArgs): Promise<ItemMutationResult>
  delete(args: ItemsDeleteArgs): Promise<ItemMutationResult>
}
session: { /* existing */ stopTask(localId: string, taskId: string): Promise<void> }
~~~

### 2.5 `src/shared/config-schemas.ts` (add; all `z.looseObject`)
- `ToolListSchema`: a string or a string array
- `SkillFrontmatterSchema`, `CommandFrontmatterSchema`, `AgentFrontmatterSchema` (the D7 fields)
- `HookEntrySchema`: a discriminated union on `type` over `command` / `prompt` / `agent` / `http` / `mcp_tool` (D8 fields), plus a loose fallback for unknown types
- `HookMatcherGroupSchema {matcher?: string, hooks: HookEntry[]}`
- `HooksSettingSchema`: a record from string to an array of groups

### 2.6 `src/shared/hook-events.ts` and `src/shared/item-precedence.ts` (new, zod-free)
- `HOOK_EVENTS`: the 33 names copied from SDK 0.3.312 `HOOK_EVENTS`, `as const`
- `HookEventName`
- `TOOL_MATCHER_EVENTS`
- `MATCHER_HINTS: Partial<Record<HookEventName, string>>` (D8)
- `ITEM_PRECEDENCE` (D9): `{ skill: ['user','project'], agent: ['project','user','plugin'], command: null }`, where `null` means a conflict with no winner, plus `SKILL_SHADOWS_COMMAND = true`

### 2.7 `src/shared/frontmatter.ts` (WP0 lands the signatures as a stub that throws; WP3 implements)
~~~ts
export interface FrontmatterDoc {
  hasFrontmatter: boolean
  data: Record<string, unknown>          // {} when absent or unparsable
  body: string
  bodyOffset: number
  yamlRange?: [number, number]
  error?: { message: string; from: number; to: number }
  eol: '\n' | '\r\n'
}
export type FmOp = { op: 'set'; key: string; value: unknown } | { op: 'delete'; key: string }
export function parseFrontmatter(text: string): FrontmatterDoc
export function patchFrontmatter(text: string, ops: FmOp[]): string   // throws on unparsable frontmatter; [] -> same string
export function replaceBody(text: string, body: string): string
export function keyRange(text: string, key: string): [number, number] | undefined
~~~

### 2.8 Main wiring (WP0)
- `src/main/services/plugin-registry.ts` (new, tiny, WP0-owned): `PluginRegistry { update(plugins): void; list(): {name,path,version?}[]; get(name) }`. `SessionManager` receives it by constructor and feeds it on `init` (WP0 wires the constructor arg; WP1 adds the feed).
- `paths.ts`:
  - `itemsRoot(kind, scope, cwd?, env?, home?)`
  - `itemFilePath(kind, root, name)`, which throws when the path escapes the root
  - `trashDir(userDataDir)`
  - `ConfigPaths.itemsRoot`
  - tests with Windows fixtures and both slash forms, including `..` and absolute-name rejection
- `ipc/index.ts`: create one `PluginRegistry`, pass it to the session and items registration, and add `registerItemsIpc({ send, registry })`
- Stubs:
  - `ipc/items.ts`: `list` returns an empty list with `pluginsKnown:false`; mutations return `{ok:false, code:'io', message:'not implemented'}`
  - `ipc/session.ts`: `stopTask` is a no-op
  - `config:read` / `config:write` with an item ref returns `bad_ref` until WP4

### 2.9 Renderer frozen seams (WP0)
- **`features/chat/model/types.ts` additions** (types only; WP2 implements the logic):
~~~ts
export interface TaskView {
  taskId: string; toolUseId?: string; description: string; subagentType?: string; taskType?: string
  parentTaskId?: string; depth?: number; background?: boolean; ambient?: boolean; hidden?: boolean
  status: TaskStatus | 'stopping'
  startedAt: number; endedAt?: number
  totalTokens?: number; toolUses?: number; durationMs?: number; progressAt?: number   // CLI-reported
  lastToolName?: string; summary?: string; error?: string
}
export interface TurnActivity {
  startedAt: number; endedAt?: number; durationMs?: number
  usage: Usage; exact: boolean; apiCalls: number
  contextTokens?: number; contextExact?: boolean
}
export interface SessionActivity { workMs: number; apiMs: number; turns: number; usage?: Usage & { costUsd: number; thinkingTokens?: number } }
// ConvState: add
  tasks: Record<string, TaskView>
  turn?: TurnActivity          // live turn
  lastTurn?: TurnActivity
  session: SessionActivity
// ToolCallView: add  progressMs?: number
// ConvMeta: add  agents?: string[]; skills?: string[]; plugins?: { name: string; version?: string }[]
~~~
- **Selector signatures** (`selectors.ts`; WP0 lands stubs that return empty values or `undefined`):
  - `isAgentTool(name)`
  - `selectTopLevelItems(c)`
  - `selectChildItems(c, toolUseId)`
  - `selectTaskForTool(c, toolUseId)`
  - `selectRunningTasks(c)` (excludes ambient and hidden)
  - `selectLiveContext(c, fallbackWindow?)` -> `{ used, window, fraction, exact } | undefined`
  - `selectTurnSummary(c)`
  - `selectWorkingState(c)` -> `{ verb: 'working' | 'thinking' | 'tool' | 'approval'; toolName?; since: number } | undefined`

  All memoized per the D13 rule.
- `workspace-store.ts`: `AppView` adds `'skills' | 'agents' | 'hooks'`. `LeftRail` adds the rows (D10). `AppShell` lazy-loads placeholders `features/items/SkillsPage.tsx` (`SkillsPage({cwd})`), `features/items/AgentsPage.tsx` (`AgentsPage({cwd})`) and `features/hooks/HooksPage.tsx` (`HooksPage({cwd})`).
- `lib/config-queries.ts`: `refKey` covers item refs (`kind:scope:cwd-or-plugin:name`); `configKeys.items(kind, cwd)` = `['items', kind, normCwd]`; `keysForChange` maps item kinds to `['items', kind]` + `['config', refKey]`.
- `features/items/kinds/types.ts` (types only):
~~~ts
export interface ItemField { key: string; label: string; type: 'text' | 'textarea' | 'select' | 'boolean' | 'list' | 'number'; options?: string[]; hint?: string; placeholder?: string }
export interface ItemIssue { key?: string; message: string; severity: 'error' | 'warning' | 'info' }
export interface ItemValidationCtx { fileName: string; knownTools?: string[]; models?: ModelOption[] }
export interface ItemKindSpec { kind: ItemKind; label: string; plural: string; fields: ItemField[]; template(name: string): string; validate(doc: FrontmatterDoc, ctx: ItemValidationCtx): ItemIssue[] }
~~~

---

## 3. Work packages

Waves: **W0** WP0 alone -> **W1** WP1, WP2, WP3, WP4, WP5, WP6, WP7 in parallel (merge order: WP1, WP2 first, so Stream A lands early) -> **W2** WP8 (merges first), WP9, WP10 in parallel -> **W3** WP11.

| WP | Title | Wave | Depends on |
|---|---|---|---|
| WP0 | Foundation: `yaml` dep, contracts, paths, plugin registry, nav skeleton | W0 | - |
| WP1 | Main: live activity in the adapter (usage, tasks, tool progress, msgId fix), stopTask, plugin feed, subagent spike + fixture | W1 | WP0 |
| WP2 | Renderer: activity model (reducer, selectors, chat-store coalescing) | W1 | WP0 (fixture from WP1 when available; synthetic first) |
| WP3 | Shared: frontmatter library | W1 | WP0 |
| WP4 | Main: ItemsService (list / read / write / create / rename / trash), watcher dirs | W1 | WP0 (uses WP3 at merge; stubs before) |
| WP5 | Renderer: item kind specs, validators, templates (pure) | W1 | WP0 |
| WP6 | Editor and MCP follow-ups (search panel theme, language chunk split, approval tooltip) | W1 | WP0 |
| WP7 | Pty: exited-shell conhost timebox | W1 | WP0 |
| WP8 | Live activity UI (working row, status bar, SubagentCard tree, tool timers, model chip) | W2 | WP1, WP2 |
| WP9 | Skills / Commands / Agents pages | W2 | WP3, WP4, WP5, WP6 |
| WP10 | Hooks editor | W2 | WP0, WP6 |
| WP11 | Integration, live checks, smoke, findings | W3 | all |

### WP0. Foundation (serial, first)
**Owns:** `package.json`, `package-lock.json`, `src/shared/**` (`frontmatter.ts` as a stub only), `src/preload/**`, `src/main/index.ts`, `src/main/ipc/index.ts`, the stub `src/main/ipc/items.ts`, `src/main/ipc/session.ts` (the stopTask stub only), `src/main/services/plugin-registry.ts` (+test), `src/main/paths.ts` (+test), the `SessionManager` constructor signature only, `src/main/services/sdk-settings.test.ts` (the `HOOK_EVENTS` equality test only), `src/renderer/features/chat/model/types.ts` (the type additions), `src/renderer/features/chat/model/selectors.ts` (the stubs), `createConvState` in `src/renderer/features/chat/model/reducer.ts` (the new defaults only), `src/renderer/stores/workspace-store.ts`, `src/renderer/app/shell/{AppShell,LeftRail}.tsx` (+ test mock updates), `src/renderer/lib/config-queries.ts` (+test), `src/renderer/features/items/kinds/types.ts`, and the placeholders from 2.9.
**Do:**
1. One install: `yaml` 2.9.1, exact pin. Check that the lockfile diff adds only `yaml`.
2. Contracts 2.1-2.7, preload wiring for `items.*` and `session.stopTask`. Existing reducers get default values for the new `ConvState` fields (`tasks: {}`, `session: {workMs:0, apiMs:0, turns:0}`) in `createConvState`, so the existing tests stay green.
3. Paths, `PluginRegistry`, IPC wiring and stubs (2.8).
4. Renderer seams (2.9): rail rows, lazy placeholders, query keys.
5. Update the `ipc.test.ts` schema tests: item refs, the cwd refine, strict versus ref names, `..` rejected.

**Accept:**
- typecheck, test and build are green
- `npm run dev`: the rail shows the 6 rows plus Settings, each placeholder renders, and chat works as in P2
- `yaml` is absent from the renderer entry chunk (the chunk graph or a grep of the entry)

### WP1. Main: live activity in the adapter
**Owns:** `src/main/services/sdk-adapter.ts` (+tests, a new `sdk-adapter.activity.test.ts`), `src/main/services/session-manager.ts` (+test), `src/main/ipc/session.ts`, `scripts/spike.ts`, `tests/fixtures/events/subagent-*.json` (new, sanitized).
**Do:**
1. Per-parent msgId: `Map<parentKey, msgId>`. Emit `text_delta` / `thinking_delta` only for the main thread (D4).
2. A `TurnUsageAccumulator` (pure, exported for tests). `message_start`, `content_block_delta` (text, thinking, `partial_json` lengths), `message_delta` and `system thinking_tokens` feed the D2 numbers. Emit `usage_live` with the 250 ms throttle and a trailing flush. The clock is injectable. Reset on `send()` and on the initial prompt; flush and stop at `result`.
3. Map `task_started` / `task_progress` / `task_updated` / `task_notification` -> the 2.3 events (`skip_transcript` -> `hidden`). Map `tool_progress` (seconds -> ms). Ignore `background_tasks_changed`.
4. `init`: add `agents`, `skills`, `plugins`. `result`: add `durationApiMs` and `sessionUsage` (the sum over `modelUsage`; `thinkingTokens` when present).
5. `supportedModels()` maps `resolvedModel`. `AdapterSession.stopTask(taskId)` -> `q.stopTask`. `SessionManager.stopTask` and the IPC handler (validated). `SessionManager` calls `registry.update(e.plugins)` on init.
6. **Cheap live spike** (`SPIKE_SUBAGENT=1`, `settingSources: []`, model `haiku`, cwd `D:\claude-tmp\p3-sub` with 3 dummy files, `SPIKE_RECORD` to a scratch dir). One prompt: "Use the Agent tool once (general-purpose) to count the files in the current directory with Glob, then reply with just the number." This uses the default background behaviour. Record, in the WP notes for WP2 and WP8:
   - the order of `task_*`, `tool_result` and `result`
   - whether subagent `stream_event`s arrive with `parent_tool_use_id`
   - whether `task_progress` arrives without `agentProgressSummaries`
   - `message_delta` usage presence
   - the tool name (`Agent` vs `Task`)
   - how the final `result.usage` compares with the per-call sums

   Build `tests/fixtures/events/subagent-turn.json` from it as **normalized events with synthetic text** (no raw dump committed). If the spike's facts contradict D2 or D4, stop and tell the lead before building on them.

**Accept:**
- unit tests on fake streams:
  - interleaved main and subagent `message_start` keep the main deltas on the main msgId, and no subagent `text_delta` is emitted
  - the estimate switches to exact on `message_delta`
  - `exact` is false mid-message and true after
  - context uses only main-thread calls
  - the throttle emits at most 1 per 250 ms with a trailing flush (fake clock)
  - `thinking_tokens` raises the estimate
  - `modelUsage` sums into `sessionUsage`
  - the task events map 1:1 (`skip_transcript` -> `hidden`)
  - `stopTask` reaches `q.stopTask`
  - the plugin registry is fed on init
- the spike is run once (cost recorded, under $0.05)

### WP2. Renderer: activity model
**Owns:** `src/renderer/features/chat/model/{reducer.ts, selectors.ts, fixtures.ts}` (+tests), `src/renderer/stores/chat-store.ts` (+test).
**Do:**
1. Reducer:
   - `turn` starts in `addUserItem` (or at the first `status: running` without a turn)
   - `usage_live` updates `turn`
   - `result` closes the turn (`durationMs = result.durationMs`), moves it to `lastTurn`, adds to `session.workMs` / `apiMs` / `turns` and stores `session.usage` from `sessionUsage`
   - an interrupt (`status: idle` without a result) closes the turn with the local elapsed
2. Tasks: upsert on `task_started`; merge `task_progress` (with `progressAt = now`), `task_updated` and `task_ended`. `endTurn(interrupted)` turns running tasks into `stopped`, except tasks with `background` while the session is still running. `chat-store.interrupt` marks running tasks `stopping` optimistically.
3. `tool_progress` -> `ToolCallView.progressMs` (max of the old and new values).
4. `contextWindow` cache: on `result` with `contextWindow`, write `localStorage['ccwrap.ctxWindow']` (a model -> window map). This happens in chat-store, not in the pure reducer. `selectLiveContext` takes the fallback from it.
5. Selectors from 2.9, memoized. `selectTopLevelItems` hides the children of known Agent / Task tools at any depth.
6. Chat-store: coalesce `usage_live`, `task_progress` and `tool_progress` per frame with the deltas (FIFO order kept; other events still flush immediately). `stopTask(convId, taskId)` action.

**Accept:**
- replaying `subagent-turn.json` gives one top-level Agent item with N children, a task completed with tokens and tool-uses, and `lastTurn` set
- `selectLiveContext` follows `usage_live` (not `result.usage`) and keeps `exact` false mid-message
- an interrupted turn: tasks stopped, the turn closed, and ctx not dropped to 0 (the P1 regression stays green)
- referential stability: the same `items` reference gives the same `selectTopLevelItems` array
- 100 `usage_live` events within one frame cause one store update
- every existing reducer and chat-store test is green

### WP3. Shared: frontmatter library
**Owns:** `src/shared/frontmatter.ts` (+ `frontmatter.test.ts`). This is the D13 carve-out.
**Do:** implement 2.7 with `yaml` `parseDocument`:
- the fences are detected only at offset 0 (after a BOM); `---` followed by EOL; the closing `---` or `...`; CRLF preserved
- an empty frontmatter (`---\n---\n`) is valid
- a non-mapping root is an error
- a set on a missing frontmatter creates the block with the file's EOL
- the error range comes from the `YAMLError.linePos` / `pos` mapped to absolute offsets

**Accept:**
- a round trip with `[]` ops is byte-identical, including on CRLF, comments and odd quoting
- setting `description` keeps comments and the order of other keys, and a multi-line `description` set and read back is equal
- deleting a key works
- `replaceBody` keeps the frontmatter bytes
- an unparsable frontmatter gives an error with a range and `patchFrontmatter` throws
- a file without frontmatter has `bodyOffset 0`
- `keyRange` points at the key's line

### WP4. Main: ItemsService and watcher dirs
**Owns:** `src/main/services/items-service.ts` (+test), `src/main/services/trash.ts` (+test), `src/main/services/config-service.ts` (item ref resolution, the `invalid_frontmatter` / `read_only` write paths), `src/main/services/config-watcher.ts` (dir watches), `src/main/ipc/items.ts`, `src/main/ipc/config.ts` (wiring only), `tests/fixtures/items/**`.
**Do:**
1. `ConfigService.resolvePath` handles item refs through `paths.itemsRoot` / `itemFilePath`, with plugin refs resolved via the `PluginRegistry` (an unknown plugin gives `bad_ref`). Writes to plugin refs return `read_only`. Item writes check the frontmatter with `parseFrontmatter` (until WP3 merges, the stub; the test asserts the call). Memory-style EOL keeping, no BOM.
2. `ItemsService(paths, registry, configService, trash)`:
   - `list(kind, cwd?)`: scans per D5; reads at most 64 KB of each file for the frontmatter; skips files over 1 MB with `error`; sorts by name; no symlink following outside the root (`lstat`)
   - `create`, `rename` (with `text`), `delete` -> `trash.move`
   - every mutation registers its paths as own writes
3. `trash.ts`: `move(src, {kind, scope, name})` -> `trashPath`. It renames with retry, uses the EXDEV copy + verify fallback, and writes the manifest. The fs is injectable to simulate `EXDEV` / `EPERM`.
4. Watcher: the D5 dir watches for user roots always and project roots on `setProject`; emits item `fs:changed`. One real chokidar test: create a skill dir with `SKILL.md` -> one event of kind `skill`; a project `.claude/agents` created later is picked up.
5. `ipc/items.ts` handlers, validated with the frozen schemas.

**Accept (temp dirs only):**
- list finds user, project and plugin items (the registry seeded with a temp plugin dir)
- a path-traversal name (`..\x`, `a/../../b`, an absolute path) is rejected by the schema or by `itemFilePath`
- create fails with `exists`
- rename moves the dir, rewrites the `name:` via `text`, and leaves no own-write banner event
- delete moves to trash and the source is gone, with the manifest correct
- simulated `EXDEV` copies, verifies, then removes the source; a simulated verify mismatch leaves the source untouched and returns `io`
- writing to a plugin ref gives `read_only`; a write with broken frontmatter gives `invalid_frontmatter` and the file is untouched; a conflict gives `conflict`
- the trash dir is under the temp root (guard)

### WP5. Renderer: item kind specs and validators
**Owns:** `src/renderer/features/items/kinds/{skill,command,agent,common}.ts` (+tests). Not `types.ts` (WP0).
**Do:** an `ItemKindSpec` per kind: the D7 fields as `ItemField[]`, a `template(name)`, and `validate()` per D7. The zod schemas from `config-schemas.ts` produce the type issues; the hand checks add the name, filename, tool-rule and model checks. `common.ts` has the shared tool-list parsing (comma or list in, the same shape out, so a form edit keeps the user's style: a string stays a string, a list stays a list).
**Accept:**
- every D7 rule has a test (a passing and a warning case)
- a template parses with `parseFrontmatter` (once WP3 has merged, behind `it.skipIf(stub)` before that) and validates clean
- the tool-list round trip keeps the style
- no issue is `error` except a frontmatter parse error

### WP6. Editor and MCP follow-ups
**Owns:** `src/renderer/components/editor/**`, `src/renderer/features/mcp/McpPage.tsx` (the approval tooltip only; + test).
**Do:**
1. D12 #2: search panel styles from tokens. Visible focus ring; the checkboxes use `accent-color` through a token variable.
2. D12 #3: lazy language loading. `cm-setup.ts` exports `loadLanguage(lang): Promise<Extension>` with `import('@codemirror/lang-json')` / `import('@codemirror/lang-markdown')`. `CodeEditorImpl` mounts with an empty language compartment and reconfigures it when the promise resolves; the lint source is unchanged. Record the chunk sizes before and after in the WP notes.
3. D12 #4: the approval tooltip on approved project servers.

**Accept:**
- the CodeEditor tests are green (the jsdom smoke waits for the language to load)
- a JSON editor's chunk graph has no `lang-html`
- the base editor chunk is <= 450 kB, or the actual numbers and the reason are reported to the lead
- no hex
- the McpPage test checks the tooltip text

### WP7. Pty: exited-shell conhost timebox
**Owns:** `src/main/services/pty-service.ts` (+test).
**Do:** D12 #5. Probe scripts go in the scratch dir, never in the repo. Implement the winning variant behind an injectable seam, with a unit test that `onExit` triggers the cleanup path once and never after `close()`.
**Accept:** either the fix lands (the probe shows 0 leftover `conhost.exe` after a natural `exit` for pwsh and Git Bash, and the existing pty tests are green), or the code is unchanged and the probe results are written into the WP notes for the findings. Half a day maximum.

### WP8. Live activity UI
**Owns:** `src/renderer/features/chat/**` except `model/**`, i.e. `ChatView.tsx` (working row), `MessageList.tsx` (top-level items), `tools/ToolCard.tsx` (live duration), a new `tools/SubagentCard.tsx`, a new `activity/{WorkingRow.tsx, TokenCount.tsx, format.ts}`, `ModelMenu.tsx` (D12 #1), `chat.css`, tests; plus `src/renderer/app/shell/{StatusBar.tsx, CostMeter.tsx}` and a new `src/renderer/lib/use-now.ts`.
**Do:**
1. `use-now.ts`: one shared interval, subscribers only while mounted. Returns `Date.now()` per second. Under reduced motion it still updates (a timer is information, not motion).
2. `TokenCount`: formats `1.2k`; renders `~` + a dotted underline + the D2 tooltip when not exact; the tick-up is the CostMeter pattern (at most 600 ms; reduced motion snaps).
3. `WorkingRow` (D11) replaces `WorkingIndicator`, uses `selectWorkingState` / `selectTurnSummary` / `selectRunningTasks`, and shows "esc to interrupt" (the existing Esc behaviour). It keeps `data-testid="working-indicator"` for the existing tests and smoke script, and has `role="status"` with `aria-live="off"` for the ticking part (a ticking timer must not spam screen readers; the verb change is announced).
4. StatusBar: live ctx from `selectLiveContext` with the `~` marker; the turn segment; the session tooltip (D11).
5. `MessageList` renders `selectTopLevelItems`. `ItemView` routes `isAgentTool(name)` tools to `SubagentCard`.
6. `SubagentCard` (D4): the header metrics; Stop agent -> `chatStore.stopTask`; the collapsible body recursively rendering `selectChildItems` with the existing `ItemView` components; the 50-child cap; the D4 perf rules (no `motion` layout props, no height transitions).
7. `ToolCard`: a running tool ticks elapsed (`max(progressMs, now - startedAt)`).
8. `ModelMenu`: a label lookup by `value` or `resolvedModel`, then a family match (`claude-sonnet-*` -> the Sonnet row), then the raw id.
9. **One live check in the dev app** (the WP1 spike prompt, scratch project, about $0.05): screenshot the working row, a running SubagentCard and the status bar mid-turn; confirm the ctx % moves while streaming and that the `~` disappears at turn end.

**Accept:** Testing Library with the `subagent-turn` fixture and fake timers:
- the working row shows the elapsed seconds advancing and `~1.2k`
- the verb switches to Thinking or the tool name
- the status ctx shows `~` mid-turn and none after the result
- the Agent card nests its children (not top-level rows), shows the tokens / tool-call count / current tool, collapses, and its Stop calls `session.stopTask`
- a 60-child agent shows 50 + "Show 10 earlier"
- the model chip shows "Sonnet" for `claude-sonnet-5-5` given a list with `resolvedModel`
- no `motion` layout animation inside `MessageList` (a grep test for `layout` props in `features/chat`)
- every existing chat test is green

### WP9. Skills / Commands / Agents pages
**Owns:** `src/renderer/features/items/**` except `kinds/**` (WP5 has `kinds/*.ts`, WP0 has `kinds/types.ts`): `SkillsPage.tsx`, `AgentsPage.tsx`, a shared `ItemsWorkspace.tsx`, `ItemList.tsx`, `ItemEditor.tsx`, `ItemDialogs.tsx` (new / rename / delete), `use-item-buffer.ts`, `precedence.ts` (pure, +test), tests.
**Do:**
1. The `ItemsWorkspace({kind | kinds, cwd})` layout (D10). Skills page = tabs Skills / Commands; Agents page = agent kind.
2. List: `items.list` via `configKeys.items`; grouped; a filter; chips for shadow / conflict (`precedence.ts` from `ITEM_PRECEDENCE` + cross-kind skill > command), "loaded in session" (active conv `meta.skills` / `meta.agents` / `slashCommands`), and plugin lock; an error badge when the frontmatter is broken; the roots shown with a "folder does not exist yet" note.
3. Editor:
   - `use-item-buffer` follows the P2 `use-settings-buffer` pattern: `config.read` / `config.write` with `baseHash`, a conflict banner with Reload / Overwrite, a changed-on-disk banner while dirty, the dirty registry key, and the save toast with the backup path
   - the Form tab: fields from the kind spec, edits applied through `patchFrontmatter`, the body through `replaceBody`
   - the Raw tab: the whole text, with diagnostics from the spec issues + the parse error ranges (`keyRange`)
   - Ctrl+S saves; when the frontmatter is broken, Form is read-only and Raw is offered
   - plugin items are read-only everywhere
4. Dialogs:
   - New: scope, name with live strict validation, template -> `items.create`
   - Rename: the new name -> `items.rename` with `text` = the frontmatter `name` patched when it equalled the old name
   - Delete: confirm "Move <name> to the ccwraper trash? (<trash dir>)" -> `items.delete`; the toast shows the trash path
5. A selection change while dirty goes through `useDirtyRegistry.guard`.

**Accept:** tests with a mocked `window.ccwrap`:
- the list groups and chips (a user skill shadowing a project skill with the same name; a command shadowed by a skill; a plugin item locked)
- a Form edit of `description` sends `config.write` with the other frontmatter keys, comments and body intact
- a conflict banner with Overwrite resends with the new hash
- broken frontmatter: Form read-only, Raw shows the diagnostic
- New with an invalid name is disabled; a valid one sends `items.create` with the template
- rename sends `newName` + the patched `text`
- delete asks first, then calls `items.delete`
- switching items while dirty asks first
- a plugin item has no Save / Rename / Delete

### WP10. Hooks editor
**Owns:** `src/renderer/features/hooks/**` (`HooksPage.tsx`, `model/hooks-model.ts` (pure, +test), `HookEntryForm.tsx`, `HooksConfirmDialog.tsx`, `EffectiveHooks.tsx`, tests). Read-only imports from `features/settings/model/settings-patch.ts` and `features/settings/use-settings-buffer.ts`, and `Masked.tsx`.
**Do:**
1. `hooks-model.ts`:
   - `readHooks(settingsObj)` -> events, groups and entries, with unknown events and types flagged
   - `opsForEvent(event, groups)` -> the `applyPatch` ops (D8 delete rules)
   - `validateHooks` (D8 rules, using `HookEntrySchema` + the RegExp check)
   - `changedExecutables(before, after)` -> the list of added or changed command / url / mcp tool strings for the confirm dialog
2. The page:
   - the D8 safety banner (always visible)
   - the scope tabs User / Project / Local and Effective
   - per event: a collapsible section with matcher groups, add group / add entry, a type select, the per-type form, and a per-entry JSON box (CodeEditor json) for unknown keys and types; header values are masked
   - an "Add event" select from `HOOK_EVENTS`
   - Save -> `HooksConfirmDialog` (D8) when `changedExecutables` is not empty, with the extra checkbox for Project scope -> `config.write`
   - conflict and dirty handling as P2 (dirty key `hooks:<scope>`)
   - a link "Edit raw JSON in Settings"
3. Effective: `settings.resolve` sources -> the merged listing with source chips, the `disableAllHooks` banner, managed read-only.

**Accept:**
- adding a `PreToolUse` command hook writes `hooks.PreToolUse[0].hooks[0]` and keeps the other settings keys and the order
- editing an entry keeps an unknown key on it
- removing the last entry of an event deletes the event key
- an unknown event key in the file survives a save of another event
- the confirm dialog lists the new command and blocks Project scope saves until the box is checked
- there is no button anywhere that runs a hook (a test asserts no `pty` / `session` API call and no "Run" label)
- an http header value stays masked until revealed
- the matcher RegExp warning shows
- the Effective view merges user + project with chips

### WP11. Integration, live checks, smoke, findings (finishes last)
**Owns:** `README.md` (run notes), `docs/P3-FINDINGS.md` (new), `scripts/cdp-smoke.ts`, `scripts/cdp-client.ts`. Cross-file fixes only with the lead's OK.
**Checklist:**
1. **Sandboxed config run** (`CLAUDE_CONFIG_DIR=D:\claude-tmp\p3-cfg`, `--user-data-dir=D:\claude-tmp\p3-ud`, project `D:\claude-tmp\p3-live`):
   - Skills: create a user and a project skill with the same name -> shadow chip; edit the description in Form -> the file keeps comments and other keys and the backup appears; Raw with broken YAML -> diagnostic, Save blocked; rename (dir moved, `name:` updated); delete -> the item is in `p3-ud\trash` with its manifest and gone from the list; an external edit refreshes / shows the banner; a conflict path works.
   - Commands: a namespaced `a/b` command; a same-name user + project conflict chip; a command shadowed by a same-name skill.
   - Agents: create with the template; `color` / `model` / `tools` form edits; a filename != `name` warning.
   - Hooks: add a `PreToolUse` command hook `echo p3-fixture` in user and project scope, with the confirm dialog (project checkbox); the Effective view shows both; delete them again. **Do not start a session in the sandbox** (no login there), so no hook ever runs.
   - The plugin note shows (no session).
2. **Real config run** (user scope read-only; writes only inside `D:\claude-tmp\p3-live`; the app's normal `settingSources`):
   - Skills / Agents / Hooks views open on the real config: lists render, plugin items appear after one session has started, plugin rows are read-only, hook header values are masked. Nothing is saved, created, renamed or deleted in user scope. `sha1` of `settings.json` before and after is identical, and the `~\.claude\skills|commands|agents` listings are identical before and after.
   - **Live subagent check** (haiku, the WP1 prompt, about $0.05): the working row timer and `~` tokens advance; the ctx % moves mid-stream; the SubagentCard shows running -> done with tokens / tool calls / current tool; children are nested; the status bar shows the turn segment and then the exact last-turn numbers; the session tooltip totals match `result.modelUsage`. Second run: interrupt with Esc while the agent runs -> the card shows stopping / stopped and no orphan running state. Third: Stop agent on a running card -> `task_ended stopped`.
   - Agent precedence cross-check: a project agent with the same name as a built-in or plugin agent, read through the session's `init.agents` and the card. A user + project pair needs user scope, so it is checked only in the sandbox listing; record "winner not verifiable live without writing user scope" if so.
   - The model chip after the first turn shows the display name.
   - Editor: the search panel is themed; the JSON editors do not load the markdown chunk (the chunk list in DevTools or the build graph).
   - Terminal: the WP7 result is re-checked live (exit a Git Bash tab, count `conhost.exe` descendants).
3. `scripts/cdp-smoke.ts` visits Skills / Commands tab / Agents / Hooks too. A `CCWRAP_SMOKE_LIVE=1` branch runs the subagent prompt (opt-in, costs money).
4. typecheck, test and build are green. Record the chunk sizes (entry, editor base, markdown, items pages, hooks page) and the frame times during streaming (a CDP `Performance` sample: p95 frame time while a subagent streams, target under 20 ms).

**Accept:** the checklist passes, or each failure is recorded with a decision. `docs/P3-FINDINGS.md` records:
- the live API cost
- the spike facts (D2 / D4 confirmations or corrections)
- the estimate error (the estimated vs exact output tokens at message end, for a few messages)
- the ctx % before and after the D1 fix on a multi-tool turn
- the trash and EXDEV behaviour seen
- the conhost result
- the deviations: the `items:*` channels (D5), trash in userData (D5), the precedence constants (D9), commands as a tab of Skills (D10), no YAML highlighting (D6)

---

## 4. Collision map (who may edit what after WP0)
- **Lead only:** `package.json`, the lockfile, `src/shared/**` (except `src/shared/frontmatter.ts` + test, which are WP3's), `src/preload/**`, tsconfigs, `vitest.config.ts`, `tests/setup-*.ts`, `src/main/index.ts`, `src/main/ipc/index.ts`, `src/main/paths.ts`, `src/main/services/plugin-registry.ts`, `src/renderer/features/chat/model/types.ts`, `src/renderer/features/items/kinds/types.ts`, `src/renderer/lib/config-queries.ts`, `src/renderer/stores/workspace-store.ts`, `src/renderer/app/shell/{AppShell,LeftRail}.tsx`.
- **Main:**
  - WP1: `sdk-adapter*`, `session-manager*`, `ipc/session.ts`, `scripts/spike.ts`, `tests/fixtures/events/subagent-*`
  - WP4: `items-service*`, `trash*`, `config-service*`, `config-watcher*`, `ipc/items.ts`, `ipc/config.ts`, `tests/fixtures/items/**`
  - WP7: `pty-service*`
  - `mcp-service`, `claude-cli`, `shells`, `sdk-history`, `sdk-settings` (except the WP0 `HOOK_EVENTS` equality test), `history-service` and `atomic-write` are untouched. WP4 imports `atomic-write` read-only for the retry helper; if it needs an export, ask the lead.
- **Renderer:**
  - WP2: `features/chat/model/{reducer,selectors,fixtures}.ts` (+tests), `stores/chat-store.ts`
  - WP8: the rest of `features/chat/**`, `app/shell/{StatusBar,CostMeter}.tsx`, `lib/use-now.ts`
  - WP5: `features/items/kinds/{skill,command,agent,common}.ts`
  - WP9: the rest of `features/items/**`
  - WP10: `features/hooks/**` (the settings files read-only)
  - WP6: `components/editor/**`, `features/mcp/McpPage.tsx` (the tooltip only)
  - `features/settings/**`, `features/memory/**`, `features/terminal/**` and `stores/dirty-registry.ts` are read-only in P3
- **SDK imports** stay limited to `sdk-adapter.ts`, `sdk-history.ts` and `sdk-settings.ts` (+ their tests). The task, usage and hook types never cross into `src/shared` as SDK types; only the normalized shapes do.

## 5. Project-specific risks found while reading
| Risk | Where | Mitigation |
|---|---|---|
| `result.usage` is a per-turn sum, so ctx % is overstated on multi-call turns | `selectors.ts` `selectContextUsage` | D1 / D2: context from the latest main `message_start`; WP11 records before and after |
| Interleaved subagent streams corrupt the single `state.msgId` | `sdk-adapter.ts` `mapMessage` | Per-parent msgId, main-only deltas (WP1) |
| Background agents: the tool result arrives early and the result may be held back | SDK semantics | Card status from task events; `endTurn` does not stop background tasks while the session runs (WP2) |
| Unstable selector results loop React 19 / zustand 5 | new derived selectors | WeakMap memo / `useShallow` (D13); a stability test in WP2 |
| Directory rename on Windows fails with `EPERM` while an editor or AV holds a handle; trash across volumes | WP4 | The retry backoff from `atomic-write`; EXDEV copy + verify; never remove before the copy verified |
| chokidar on missing dirs | WP4 | Parent depth-0 watch, add the root when it appears; a real-chokidar test |
| YAML re-serialization drift | WP3 | No-op = verbatim; only top-level patched keys re-serialized; tests on comments and CRLF |
| Hooks are arbitrary code | WP10 | Never executed; confirm dialog for executables; project-scope checkbox; no hook ever runs in tests or in the sandbox check |
| Editor chunk bloat from markdown's html / js / css graph | WP6 | Lazy language import; size gate |
| The app's live sessions load the user's real settings, so the user's own hooks run during WP8 / WP11 live checks (as in P2) | WP8, WP11 | Live checks run only in the scratch project; WP1's spike uses `settingSources: []` |
