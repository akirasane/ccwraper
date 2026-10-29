# P1 Findings (WP9: integration and live verification)

Date: 2026-10-30. Electron 45.1.0, SDK 0.3.312, claude.exe 2.1.312 (user install), model claude-sonnet-5-5 (no model picker in P1, the default is used).

Method: the built app (`npm run build`, `npx electron . --remote-debugging-port=9222`) was driven and screenshotted over CDP with throwaway Node scripts (mouse and key events, `Input.insertText`, `Page.captureScreenshot`, event taps through `window.ccwrap.session.onEvent`). Scratch project `D:\claude-tmp\p1-live`, settingSources as the app has them (`user`, `project`, `local`). Screenshots are in `D:\claude-tmp\p1-shots` (not committed). Native OS dialogs cannot be driven over CDP, so "Open folder..." was not exercised; the project was selected through the persisted `ccwrap.lastCwd` key.

## Gates
`npm run typecheck`, `npm test` (149 tests) and `npm run build` are green at the final commit.

## Manual checklist
| # | Item | Result | How |
|---|---|---|---|
| 1 | Pick a project | pass | Picker lists 25 history projects; selecting or restoring the scratch cwd starts a draft. "Open folder..." native dialog: not testable over CDP |
| 2 | New session streams markdown + highlighted code | pass | Heading, bullets, shiki python block with copy button; text arrived in model-paced bursts |
| 3 | Bash and Write cards, diff | pass | Write card shows `+1 -0` diff and Done/Error badges; Bash card shows `$ cmd`, duration, result. Edit diff not run live (Write diff and unit tests cover the component) |
| 4 | Permission: Allow once / Deny / Always / Esc | pass | Write: Esc denied (card Error "Denied by user", the model reported the denial); Allow once wrote the file. Bash `mkdir p1sub && echo ok > p1sub/a.txt` prompted; "Always allow" wrote `.claude/settings.local.json` in the scratch project (deleted afterwards). The button label shows only the first of the two rules that were written (`Bash(mkdir p1sub *)` and `Bash(echo ok *)`) |
| 5 | Esc / stop interrupts, idle, no error | pass | Esc in the composer and the Stop button both end in Idle with no error item |
| 6 | Cost meter, ctx %, no doubling on resume | pass | Meter shows the latest total ($0.0804 after turn 1, $0.2350 after 5 turns; resumed session $0.0987), never a sum. ctx 3-9% plausible. Bug fixed: ctx % dropped to 0% after an interrupt |
| 7 | Old session renders; resume + send keeps the id | pass | Resumed one of the P0 spike sessions (not a user session): history rendered, sending appended to the same session (rail count unchanged, entry moved to "just now", init carried the same id). Thinking collapsed, tools paired. Real user sessions were opened view-only, nothing sent |
| 8 | Missing cwd cannot start | pass | Temporarily renamed `D:\claude-tmp\spike-cwd`: project row greyed with tooltip, "Folder not found" notice, session rail disabled. A stale cwd unknown to history relies on the main-process check (unit tested, not live-tested) |
| 9 | `#/design` renders | pass | All sections scroll, no horizontal overflow |
| 10 | Reduced motion | pass | CDP `prefers-reduced-motion: reduce`: `--dur-*` computed 0s, shimmer `animation-name: none`, composer sweep none. The caret is a pseudo-element covered by the zeroed duration token (not sampled directly) |
| 11 | typecheck, test, build | pass | |
| extra | Title bar | pass | `navigator.windowControlsOverlay` visible, titlebar-area width 1143 of 1280, so the right padding is 137px, matching the overlay. Header is `-webkit-app-region: drag`, tab and Interrupt are `no-drag`. Native overlay glyphs are not in CDP screenshots |
| extra | Min window 1024x640 | pass | No horizontal scroll, composer and status bar intact |
| extra | Focus ring | pass | `:focus-visible` shows the accent ring (box-shadow) |

## Thinking
- `thinking_delta` DOES arrive, but only when the session requests summarized thinking (`thinking: {type:'adaptive', display:'summarized'}`) and the model chooses to think. An "ultrathink" prompt did; about 1 of 8 ordinary prompts also produced a block. Observed order: `thinking_delta*`, `assistant_message[thinking]`, `text_delta*`, `assistant_message[text]`. The thinking block is its own `assistant_message`.
- Before the fix the app did not pass `thinking`, and the CLI returned thinking blocks with empty text (a "Thought" label with nothing to expand). The P0 spike with `settingSources: []` never saw thinking because nothing triggers it there; a headless `SPIKE_THINKING=1` run again produced none.

## Bugs found and fixed
1. Interrupted turn zeroed ctx % (the error result with zero usage replaced `lastResult`). Reducer fix plus regression test. (56678e4)
2. Thinking blocks had empty text and an inert expand control. Session start now requests summarized thinking; empty thinking renders as a plain "Thought" label; tests added. (e42e678)
3. No feedback between sending and the first token (10s+ with only a status bar "Running"). Added a "Working" shimmer row; test added. (e42e678)
4. Tool results containing images inlined the base64 JSON into the card. Now `[image: image/jpeg]`; test added. (fcf3337)
5. History replay showed "0ms" on every tool card; hidden when there is no real duration. (414af60)
6. The title bar kept "New session" after the first turn while the rail showed the generated title; it now falls back to the listed session title. (414af60)

## Known gaps and observations (not fixed)
- "Always allow" shows only the first rule of the `addRules` suggestions while compound Bash commands write several. What gets persisted should be visible to the user.
- `getSessionMessages` returned only 2 events for a 64 MB / 19.8k-line session and 11 for a 19 MB one (checked by calling the SDK directly: SDK chain resolution, not our mapping). Large or compacted sessions can look truncated.
- `setPermissionMode` live behaviour was not exercised; there is no model picker.
- Live thinking rendering (active shimmer label) was seen only briefly (thinking lasted about 1s); streaming `thinking_delta` display is mostly covered by unit tests.
- Edit tool diff not run live. MCP tool cards show raw JSON input.
- Tabbing inside the virtualized list can scroll the focused card behind the composer.
- Not verifiable over CDP: native "Open folder..." dialog, real-mouse hit testing of the drag region, native overlay glyph colours.

## Deviations from SPEC
- Tailwind v4 with hand-wrapped Radix primitives (no shadcn CLI); `titleBarOverlay` height 40 with a right inset computed from `env(titlebar-area-width)`.
- Hash router (`#/design`, `#/debug`) instead of a route library.
- Session title is the SDK `customTitle ?? summary ?? firstPrompt` and appears in the rail only after the SDK writes the transcript.
- Thinking is always requested in summarized adaptive mode (SPEC did not specify).
- Permission "remember" persists only `addRules` suggestions to `localSettings` (P0 findings item 8, now implemented).

## Performance notes
- Streaming: store updates are rAF-coalesced; sampling the chat text length showed growth in model-paced bursts with no visible stutter. Stick-to-bottom held (gap 0px) through a long stream and releases only when the user scrolls up.
- History load over IPC (SDK read plus mapping): 17 ms (3 MB), 40-100 ms (6-17 MB), 329 ms (65 MB, 2 events). A 1008-event / 590-tool session showed its first rows 321 ms after the click with 10 DOM rows, 64k px scroll height and a 17 MB JS heap.
- Scrolling that session 400 px per frame for 120 frames: p50 18 ms, p95 37 ms, max 71 ms. Acceptable; a per-kind row size estimate (now a flat 96px) would reduce re-measure jumps.
- Session list: 66 sessions in 25 projects load instantly (largest project has 15 sessions); no pagination tested above that.
- A fresh session with user settings costs about $0.08 (cache creation); follow-up turns $0.01 to $0.03.

## API cost of this verification
About $0.6 in total (4 new sessions, 1 resumed, about 15 short turns, one $0.003 headless spike).

## Prioritized follow-ups for P2
1. Investigate `getSessionMessages` truncation on large or compacted sessions and show a "history truncated" hint.
2. Show every rule "Always allow" will write and let the user pick the scope (session / local / user).
3. Model picker, live `setPermissionMode` test, thinking on/off toggle.
4. Per-kind row size estimates in the virtualizer; "jump to latest" button when scrolled up during streaming.
5. Render image tool results as thumbnails instead of a placeholder; nicer MCP tool cards.
6. Live-test Edit diffs, subagent (`parent_tool_use_id`) nesting and slash commands.
7. Check a CDP smoke script into `scripts/` (the driver used here was throwaway).
8. Embedded terminal (P2 scope per SPEC).
