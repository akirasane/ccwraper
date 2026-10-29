# P0 Findings

Date: 2026-10-30. SDK `@anthropic-ai/claude-agent-sdk` pinned at **0.3.312** (latest on npm; bundles CLI 2.1.312-class binary via optional dep `@anthropic-ai/claude-agent-sdk-win32-x64`).

## Run it
```
npm install
node node_modules/electron/install.js   # only if electron/dist is missing (see Risks)
npm run typecheck
npm run build
npx electron .            # run built app   (or: npm run dev)
npm run spike             # headless adapter verification (spends real API budget, ~$0.5-1)
SPIKE_SKIP_123=1 npm run spike   # only permission + interrupt tests (cheaper)
```

## Verified SDK API (from sdk.d.ts + live runs)
| Spec name | Actual | Status |
|---|---|---|
| `query({prompt, options})` | same; `prompt` may be `string` or `AsyncIterable<SDKUserMessage>` | verified |
| `includePartialMessages` | `Options.includePartialMessages` -> messages `{type:'stream_event', event: BetaRawMessageStreamEvent}`; `message_start.message.id` gives msgId, `content_block_delta.delta.type` = `text_delta` (`.text`) / `thinking_delta` (`.thinking`) | text deltas verified live; thinking deltas implemented, NOT observed (see below) |
| `canUseTool` | `(toolName, input, {signal, suggestions, title, displayName, blockedPath, decisionReason, ...}) => Promise<PermissionResult>`; result `{behavior:'allow', updatedInput?, updatedPermissions?}` or `{behavior:'deny', message, interrupt?}` | verified (Write tool held open, allowed via reply, tool_result followed) |
| `settingSources` | `('user'\|'project'\|'local')[]`; omitted = none loaded | verified (user sources load user's plugins/skills: 114+ tools, 213 slash cmds in init) |
| `resume` | `Options.resume: sessionId`; `forkSession?: boolean`; `sessionId?` to pick a custom id | resume verified (model recalled earlier turns, same session id re-emitted in init); fork NOT tested |
| `interrupt` | `Query.interrupt(): Promise<...>` (needs streaming-input mode, i.e. AsyncIterable prompt) | verified |
| `setModel` / `setPermissionMode` | `Query.setModel(model?)`, `Query.setPermissionMode(mode)` | typed, NOT tested live |
| `pathToClaudeCodeExecutable` | `Options.pathToClaudeCodeExecutable` | verified with user's `claude.exe` |
| `Query.close()` | exists; terminates subprocess | verified |
| `stderr` | `Options.stderr: (data:string)=>void` | verified (exposed as `onStderr`) |
| `thinking` | `Options.thinking: {type:'adaptive'\|'enabled'(budgetTokens)\|'disabled', display?}` | accepted; no thinking blocks returned |
| PermissionMode | `'default'\|'acceptEdits'\|'bypassPermissions'\|'plan'\|'dontAsk'\|'auto'` (SPEC didn't list `dontAsk`/`auto`) | typed |

### Message shapes seen (mapped in `mapMessage`)
- `system/init`: `session_id, model, tools[], mcp_servers[{name,status}], slash_commands[], cwd, permissionMode, skills, plugins, ...`
- `assistant`: `message` (Messages API shape: `id`, `content[]` text/thinking/tool_use), `parent_tool_use_id`.
- `user` (tool results): `message.content[]` with `tool_result` blocks (`tool_use_id`, `content` string|blocks, `is_error`).
- `result`: `total_cost_usd` (cumulative per query), `duration_ms`, `num_turns`, `usage` (snake_case Anthropic usage), `is_error`, `subtype`, `result` (only on success).
- Many other message types exist (`rate_limit_event`, `system/status`, task_*, hook_*, ...); adapter ignores them for now (default branch).

## Live run results (cwd = D:\claude-tmp\spike-cwd)
- Init event: sessionId, model `claude-sonnet-5-5`, tools, slashCommands, mcp all populated.
- Streaming: `text_delta` events arrive (3-6 per short answer), followed by one `assistant_message`, then `result`.
- Result: cost reported (e.g. $0.05-0.14 per short turn with user settings loaded; $0.018 with `settingSources: []`), turns, usage.
- Follow-up `send()` on same query works (streaming input). **`init` is re-emitted at the start of every turn** (tool/slash counts can differ between emissions). The renderer must treat `init` as idempotent/replace.
- Resume: new `query` with `resume` continues context; init carries the same session id.
- Permission: Write in `default` mode -> `canUseTool` -> `permission_request` + `status: waiting_permission`; reply allow -> tool executes. NOTE: `Bash echo ...` did NOT trigger canUseTool (CLI auto-allows read-only commands, and user's allow rules apply when settingSources includes `user`). Tests of permission flows must use Write/Edit with `settingSources: []`.
- Interrupt: after `interrupt()` the CLI emits a `result` with `is_error: true` (error_during_execution) and zero usage; the adapter maps that to `status: idle` (not `error`) when an interrupt was requested.

## Windows binary resolution
- SDK has the bundled `claude.exe` in `node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/` (works without any path option).
- `src/main/paths.ts: resolveClaudeExecutable()` prefers `CCWRAP_CLAUDE_PATH`, then `where.exe claude` (real `.exe` only; `.cmd` shims rejected), then `~/.local/bin/claude.exe`; falls back to SDK bundled. Resolved to `C:\Users\chatkawin.t\.local\bin\claude.exe` (v2.1.312) here and ran fine.
- Packaging (P4): bundled exe cannot be spawned from inside an asar; need `asarUnpack` for the platform package or always use the user's installed claude.

## Deviations from SPEC
1. Tailwind v4 via `@tailwindcss/vite` (works). shadcn/Monaco/xterm etc. not installed yet (out of P0).
2. Toolchain majors are newer than spec era: electron 45.1.0, electron-vite 6.0.0 (needs vite 6-8), **vite 8.3.5**, **TypeScript 7.0.2 (native)**, React 19.3, zod 4.6. TS7 removed `baseUrl` (tsconfig uses relative `paths`).
3. `package.json` is CommonJS (no `"type":"module"`): main/preload bundle as CJS so a sandboxed preload works. The ESM-only SDK is loaded via dynamic `import()` in `sdk-adapter.ts` (confirmed preserved in the bundle).
4. `src/shared/channels.ts` added (zod-free channel names) because the sandboxed preload cannot `require('zod')`; `ipc.ts` re-exports it.
5. Session uses SDK streaming-input mode (AsyncIterable prompt) so `send` and `interrupt` work across turns; SessionManager removes the entry when the SDK loop ends.
6. `permission_request` event gained optional `title`; `init` gained `permissionMode`; `result` gained optional `resultText`.
7. Renderer uses `sandbox: true` window prefs (stronger than spec).
8. `permissionReply.remember` ('session'/'always') is accepted by the schema but NOT implemented (needs `updatedPermissions` from `suggestions` / ConfigService); only allow/deny + updatedInput work.

## Native module toolchain
- Visual Studio 2019 BuildTools **with** VC.Tools.x86.x64 present (`C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools`); Python 3.14; `node-gyp@12.4.0` installed globally already. Not tested: whether node-gyp 12 + Node 26/Electron 45 headers accept VS2019 (likely wants VS2022). No install was attempted.
- `node-pty@1.1.0` ships **prebuilds for win32-x64** (conpty + winpty) -> likely no compile needed (still must be rebuilt/loaded against Electron ABI; verify in P2). `better-sqlite3@13.0.3` ships prebuilt `.node` files in the tarball list (check win32 coverage in P2; fallback `node:sqlite` built into Node/Electron is an alternative for UI metadata).
- Nothing native installed in P0.

## Risks / gotchas found
- **Misleading spawn error**: an invalid `cwd` makes the SDK throw "Claude Code native binary ... exists but failed to launch ... libc". Validate `cwd` exists (and is a directory) before `query()` -- TODO in SessionManager.
- Electron's postinstall did not download the binary under this npm/Node 26 combo; had to run `node node_modules/electron/install.js` once. Consider `npm i` hook docs in README.
- Each turn loads user plugins/skills: ~34k cache-creation tokens, $0.13 on first turn. Fine for users, expensive for tests -> use `settingSources: []` in tests.
- `thinking_delta` unverified: sonnet-5-5 produced no thinking blocks even with `thinking: enabled/budgetTokens`. Mapping follows the Messages API streaming shape; recheck with a model/prompt that thinks.
- Node process exits early in scripts if nothing holds the event loop (SDK subprocess does not keep it alive); spike uses timers.
- `claude mcp add|list|...` subcommands exist (CLI preferred for MCP mutation per SPEC); not exercised.
- Unknown message types are dropped silently by `mapMessage`; consider logging in dev.
- The `init` event can arrive repeatedly; `status` events are synthesized by the adapter (SDK has `system/status` and `session_state_changed` messages that could be mapped later).
