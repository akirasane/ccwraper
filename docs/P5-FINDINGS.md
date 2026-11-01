# P5 Findings

Date: 2026-11-01. Live probes against the bundled CLI 2.1.312 through `startSdkSession` (SDK 0.3.312). Each probe used a throwaway script (not committed) and tiny prompts.

## A. Images and @file

- `SDKUserMessage.message.content` accepts Messages API blocks. An `image` block with a base64 `source` works: a solid red 32x32 PNG was described as "red".
- Order sent: image blocks first, then the text block. Text-only messages stay a plain string.
- Limits enforced in `shared/ipc.ts`: png/jpeg/gif/webp, 5 MB raw per image, 5 images per message, strict base64.
- Resumed history: image-only user turns have no text and are skipped by `sdk-history`; images in old turns are not shown. Known gap.
- `@file` is text only. Claude reads the file with its own tools, as the CLI does. The popup lists files via `git ls-files` (cached 15 s) with a symlink-free walk fallback. The query never touches the filesystem, so there is no path-escape surface.
- Paths with whitespace are inserted as `@"path with spaces"`. Not verified against the CLI.

## B. Task list

- Headless SDK sessions expose no todo tools by default. `Task` and `TaskStop` only. `ToolSearch` finds nothing. `CLAUDE_CODE_ENABLE_TASKS=1` does not change this.
- `tools: [...]` replaces the base set (not wanted). `allowedTools: ['TaskCreate','TaskUpdate','TaskList','TaskGet']` surfaces them while keeping all 31 default tools. `TodoWrite` does not exist in this CLI version; the panel still understands it for older CLIs.
- Result text: `Task #1 created successfully: <subject>`, `Updated task #1 status`. The id is parsed from that text, with a sequential fallback.
- Side effect: the SDK prints `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` once per session, because allow-listed tools skip `canUseTool`. Harmless: the tools only edit the list.

## C. Rewind

- `enableFileCheckpointing: true` plus a caller-supplied `uuid` on the user message is enough. `rewindFiles(uuid, {dryRun})` returned absolute paths, +/- line counts, and restored the file (`two` back to `one`).
- It only restores files changed by the edit tools. Shell side effects are not tracked, and the conversation is not rewound. The dialog says both.
- Conversation fork (`resumeSessionAt`) is not built. It needs a fork-and-reopen flow in the tab model.
- Resumed sessions: user messages from history carry the SDK uuid, so the control appears when the session is live. Whether checkpoints survive a process restart was not tested.

## F. Slash commands over the SDK

| Command | SDK behaviour | App handling |
|---|---|---|
| `/context` `/cost` `/usage` | Answered as an assistant text message, no API call | pass through |
| `/model` | Prints current model and usage. A name argument is app-switched via `setModel` | `/model x` intercepted, bare passes through |
| `/config k=v` | Handles key=value, prints usage otherwise | bare opens Settings, with args passes through |
| `/mcp` `/agents` | One-line summary / "wizard removed" notice | bare opens the page |
| `/help` `/memory` `/permissions` | "isn't available in this environment." | open palette / Memory / Settings |
| `/clear` | Silent, empty result | app clears the transcript, then sends `/clear` |

A project or user command that reuses one of these names is never intercepted (`routeSlash` takes the session's non-builtin command names).

Known gap: after `/clear` the CLI may start a new session id; `meta.sessionId` is not refreshed until the next `init`. A suspend/resume before then would restore the old transcript.

## E. Extra directories

- The SDK's `additionalDirectories` is fixed at launch. The only runtime path (`addDirectories`) accepts strict subfolders of cwd or of an existing root, so it cannot add an arbitrary folder. The app therefore applies folders to sessions started after they are added, and says so in a toast when a session is already live.
- Live check: with a file in a folder outside cwd, `Read` raised a permission prompt without the option and no prompt with it.
- Folders are stored per project in `localStorage` (`ccwrap.extraDirs.v1`), max 10, validated as existing directories in main before the session starts. `@file` search includes them (results are absolute paths).
