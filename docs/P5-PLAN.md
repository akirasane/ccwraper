# P5 Plan (Claude Code parity: images + @file, todo panel, rewind, plugins, add-dir, native slash commands)

Date: 2026-11-01. Inputs: `SPEC.md`, `docs/P4-PLAN.md` (format), `src/renderer/features/chat/*`, `src/main/services/sdk-adapter.ts`, `session-manager.ts`, `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`.

Goal: close the high-value gaps between ccwraper and the Claude Code CLI found in the 2026-11-01 audit. Already shipped this session (uncommitted at time of writing): browser-testing MCP presets and the Claude in Chrome (`--chrome`) preference.

Out of P5 (medium value, later): session export, bash mode (`!cmd`), output styles / status line editor, scheduled tasks and cron UI, sandbox settings UI, effort picker audit.

Every item: unit tests for the pure logic, a renderer test for the UI, `npm run typecheck && npm test` green, and one live check in a sandboxed profile (see README "Sandboxed runs"). Live checks spend API budget; keep prompts tiny.

---

## A. Images and `@file` mentions in the composer

Gap: `Composer.tsx` has no paste, drop or `@` handling. Screenshots matter for UI and browser testing.

Tasks:
1. **Spike first:** confirm how the SDK accepts user content with images (`SDKUserMessage.message.content` blocks of `type: 'image'`, base64 source). Check `InputQueue` in `sdk-adapter.ts` only carries plain text today and extend its message type.
2. Composer: `onPaste` (clipboard images), drag-drop of files onto the composer, a file picker button. Show removable thumbnails above the textarea. Limits: png/jpeg/gif/webp, cap size and count (match API limits; reject with a toast, never silently drop).
3. IPC: extend the send-message schema in `shared/ipc.ts` with `images: {mediaType, data}[]` (zod, strict, size-capped). Main passes them as content blocks.
4. Render sent images in `UserMessage.tsx`; persist/resume must not break on image blocks in history.
5. `@file` mentions: typing `@` opens a popup (reuse `SlashPopup` pattern) fed by a main-process file search of the session cwd (respect `.gitignore`, cap results, fuzzy via `palette/fuzzy.ts`). Insert as `@relative/path`. No content inlining: Claude reads it with its own tools, same as the CLI.
6. Security: path search stays inside cwd (and any added dirs from section E); reject `..` escapes and symlink escapes.

Done when: paste a screenshot, ask "what is in this image", get a correct answer; `@src/ma` completes a path; tests cover size/type rejection and path-escape rejection.

## B. Todo / task panel

Gap: TodoWrite / Task* tool progress is not shown anywhere; the agent dock only covers subagents.

Tasks:
1. Find how todo tool calls arrive in the normalized event model (`shared/events.ts`); add a reducer slice (`chat/model/reducer.ts`) holding the latest todo list per conversation (last TodoWrite wins; Task* tools merge by id).
2. `TodoPanel` pinned next to the agent dock: status icons (pending / in progress / done), collapsed summary "3/7", live updates while streaming.
3. Hide the generic tool card noise for TodoWrite (keep a one-line card linking to the panel).
4. Survive resume: rebuild from history when a session is resumed.

Done when: a multi-step prompt shows the checklist updating in place; reducer tests cover replace, merge, resume.

## C. Rewind / checkpoints

Gap: no way to undo Claude's edits. SDK has `enableFileCheckpointing` and `Query.rewindFiles()`.

Tasks:
1. Spike: read `sdk.d.ts` around `enableFileCheckpointing` / `rewindFiles` (lines ~1740, ~3212) for the exact signatures, the message-id it needs, and what it does not cover (files changed through Bash are not tracked; say so in the UI).
2. Pass `enableFileCheckpointing: true` in `startSdkSession`; keep the user-message ids needed to rewind. Add `rewind` to `AdapterSession`, `SessionManager` and IPC.
3. UI: a "Rewind to here" action on each user message (menu). Dialog offers "restore files", "restore files and conversation" where the SDK allows, with a dry-run list of files that will change if the SDK exposes one.
4. Confirm dialog before any restore (destructive). Never run while a turn is streaming.

Done when: edit a file via Claude, rewind, file contents match the pre-edit state; test with a fake `queryImpl`.

## D. Plugin and marketplace management

Gap: plugins are read (`plugin-registry`) but cannot be installed, enabled, disabled, updated or removed.

Tasks:
1. Spike: run `claude plugin --help` and `claude plugin marketplace --help` against the bundled binary (help only) to get the real subcommands. Prefer the CLI over editing `settings.json` / `installed_plugins.json` by hand, same rule as MCP mutations.
2. Main service `plugin-service.ts` wrapping the CLI (list, install, uninstall, enable, disable, update, marketplace add/remove/list) with timeouts and output capture, modelled on `mcp-service.ts`.
3. `PluginsPage` (new nav entry): installed list with enable toggle, update and remove; marketplace browser with search and install; scope selector (user / project).
4. Restart notice: changes apply to new sessions only.

Done when: add a marketplace, install and disable a plugin from the UI in a sandboxed config dir; CLI error output is shown on failure.

## E. Additional directories (`--add-dir`)

Gap: sessions are limited to cwd.

Tasks:
1. Plumb `additionalDirectories` through `AdapterOptions` -> `Options` in `sdk-adapter.ts`, `SessionStartArgs` and IPC (validate each is an existing directory, cap count).
2. UI: "Add directory" in the session header or project picker; list and remove before session start. Persist per project in `localStorage`.
3. Feed these dirs to the `@file` search (section A).

Done when: a session started with an extra dir can read a file there without a permission error about the path.

## F. Slash commands run natively

Gap: `FALLBACK_COMMANDS` lists `/clear`, `/cost`, `/context`, `/usage`, `/model`, `/config`, `/mcp`, `/agents`, `/memory`, `/permissions` but they are only text sent to the model. Unverified which the SDK handles itself.

Tasks:
1. Spike: send each command in a live sandbox session and record what happens (SDK handles, returns an error, or the model improvises). Write results to `docs/P5-FINDINGS.md`.
2. App-side handling for those that do nothing useful over the SDK: `/clear` (new conversation in the tab), `/model` (open `ModelMenu`), `/mcp` `/agents` `/memory` `/config` `/permissions` (navigate to the matching page), `/cost` `/usage` `/context` (show the existing meters or open usage).
3. Leave everything the SDK handles (`/compact`, skills, plugin commands) as pass-through.
4. Intercept in the composer submit path, before sending; unit-test the command router.

Done when: each fallback command either works natively or is documented as pass-through in findings.

---

## Order and sizing

1. A (images + @file): largest, unblocks screenshot-based browser testing. Do the SDK content-block spike first.
2. B (todo panel): small, mostly reducer plus one component.
3. C (rewind): small to medium after its spike.
4. F (slash routing): small once spike results are in.
5. E (add-dir): small.
6. D (plugins): medium; depends on CLI behavior from its spike.

Version: ship as 0.9.0 via the existing `chore(release)` flow once A-C are in; D-F can follow in 0.9.x.

## Risks

- SDK image/content-block and checkpointing signatures differ from assumptions: both have spike steps before any UI work.
- `rewindFiles` does not undo Bash side effects: UI wording must not over-promise.
- Plugin CLI output is unstructured: parse defensively, show raw output on failure.
- Live checks cost money and run real tools: use sandbox profiles, tiny prompts, never a profile with saved hooks.
