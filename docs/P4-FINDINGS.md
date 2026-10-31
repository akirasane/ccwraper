# P4 Findings (WP13: integration, packaged build, live checks)

Date: 2026-10-31. Electron 45.1.0, SDK 0.3.312, claude.exe 2.1.314 (user) / 2.1.312 (bundled), app 0.4.0.

Method: the built app was driven and screenshotted over CDP (`scripts/cdp-client.ts`, plus throwaway drivers under `D:\claude-tmp\p13`), and its main process was reached through `--inspect` for seams (notifications, hotkey, window bounds). Screenshots: `D:\claude-tmp\p4-shots` (not committed). Only PIDs the drivers started were ever killed.

**Harness limit (important):** the Claude Code auto-mode classifier denied, twice (before and after the usage-limit reset), the Bash command that drives live chats in the real app ("Modify Shared Resources"). Per the rules this was not worked around. Everything that needs a live model turn is therefore NOT VERIFIED and listed below with manual steps. No model call was made in WP13 (live API cost this pass: $0; 0 turns).

## Gates
- `npm run typecheck` green. `npm test`: 958 passed / 5 skipped, 3 consecutive full runs plus 3 earlier ones (6 runs, all exit 0): **no flakes observed**. About 30 s per run.
- `npm run build` green. Chunks: entry `index` 612 kB (the only one above the 500 kB warning; includes the tab strip), TerminalPanel 552 kB, CodeEditorImpl 361 kB (all lazy), PreferencesPage 11 kB, CommandPalette 13 kB, GitPage 13 kB, UsagePage 17 kB.

## Checklist
| # | Item | Result | How / notes |
|---|---|---|---|
| 1 | `app.info().claudePath` empty with the bundled binary | fixed, pass | `getAppInfo` uses `resolveClaudeExecutable()`; test added; packaged `app.info` shows the `app.asar.unpacked\...\claude.exe` path |
| 2 | Auth mapping | pass | Read-only `claude auth status --json` on the real config, only two fields printed: `loggedIn=true`, `authMethod="claude.ai"`. The mapper already maps `claude.ai` to `subscription`; regression test added. In-app `app.authStatus({refresh:true})` returned `signed_in` / `subscription` with only `state, method, checkedAt` keys |
| 3 | Multi-tab live: two tabs streaming, switch mid-stream, drafts, 5-session cap / LRU, background approval toast | NOT TESTABLE (classifier) | Partly seen before the denial: two tabs open (screenshot shows the strip), each keeps its own unsent draft (`draft-one-unsent` / `draft-two-unsent` read back per tab). Streaming, mid-stream switch, LRU suspend/resume and the approval toast are covered only by unit tests |
| 4a | Windows toast in a dev build | partial | `Notification.isSupported()` true, AUMID `com.ccwraper.app` is set in `main/index.ts`, a test `Notification` fired its `show` event (no `failed`). The workstation was locked (lock screen in the desktop capture), so a visible toast could not be confirmed. Taskbar flash / overlay badge: code paths exist, not observed |
| 4b | Global hotkey | partial pass | Enabling `Control+Alt+F10` registered (`globalShortcut.isRegistered` true); an invalid chord gave `Not a valid shortcut`; a chord already owned gave `Already used by another app`; then disabled again (default off restored, accelerator reset to `Control+Alt+Space`). Physically pressing the chord (focus/minimize toggle) was not possible: `SendKeys` returned "Access is denied" and was not worked around. Toggle logic is unit tested |
| 5 | Stop agent, Esc with a running background agent, unprompted-turn fix | NOT TESTABLE (classifier) | Manual steps below |
| 6a | Frame times (subagent / two tabs streaming) | NOT TESTABLE | needs live turns. The rAF sampler is in `D:\claude-tmp\p13\tabs2.js` |
| 6b | Usage dashboard on real history (counts only) | pass | 185 transcript files: cold scan 1399 ms (page ready in 1.8 s); cached re-scan 46 ms (184 cached) and 15 ms (185 cached). The `Rescan` button forces a full re-read (1323 ms, "0 cached"), by design. Event-loop p99 was not re-measured live (WP3 gate covers it). Decision: the time-sliced scan in main is enough, no worker needed |
| 6c | Git page, read-only | pass | On the ccwrap repo: branch, ahead/behind, clean tree, history list of 50 commits; `.git/index` sha unchanged by the page. On a synthetic repo (`D:\claude-tmp\p4-repo`): staged, unstaged, rename and untracked rows with a diff view; index sha unchanged. Conflict rows and the fsmonitor marker were not re-run live (unit tests only) |
| 6d | Command palette | pass | Ctrl+K opens it; every view reachable by typing its name + Enter (MCP, Memory, Skills, Agents, Hooks, Usage, Preferences, Settings, Git); Ctrl+K in the real terminal is ignored; opens elsewhere. Scroll-into-view on a long list and recents: unit tests only. Note: typing "git" ranks "Refresh git" above "Go to Git" (Actions group sorts first by design) |
| 6e | First-run card, preferences | pass (after fix) | Signed-out sandbox: card shows binary, signed-out and project rows; **Sign in types `claude auth login` in a terminal without running it**. Preferences: all sections, About shows version, Electron, SDK, claude path/source, userData, trash, "Updates: manual" |
| 6f | Window state restore, tab persistence, quit guard | pass / partial | Bounds set to 120,90,1100x700 were restored after a graceful close + relaunch; the open history tab came back. Closing while idle quit without a prompt. The busy-session guard needs a live turn: unit tested only |
| 6g | Real Agents page "Broken" agent shows lenient chip | not run | skipped to save time; unit tested (WP11) |
| 7 | Auto-resume with a fake | partial pass | Seam: a pause persisted in `localStorage` (`ccwrap.autoresume.v1`) for a restored read-only history tab, with the pref enabled and the reset 3 h away (never near, so no turn could fire). Observed: tab shows `Paused (usage limit)` with an amber `3h 00m` countdown, banner "Paused until 8:41 PM / Resumes automatically in 3h 00m. Keep ccwraper open." with Cancel and Resume now; **Cancel** removed the tab countdown and the banner became "Usage limit reached. Resets 8:41 PM. Auto-resume cancelled. Resume now", stored as `cancelled: true`. Pref and storage restored to off/empty afterwards. **Not verified:** Resume now, the timed fire at reset + 15 s, the real `rate_limited` event from the CLI, notifications and keep-awake. These need a live session (the SDK 0.3 accepts only a native claude binary, so no fake CLI is possible) and are covered by `controller.test.ts` with fake timers |
| 8 | Packaged build | pass | see below |
| 9 | README note + smoke script | done | README "Auto-resume (P4)" section; `scripts/cdp-smoke.ts` now visits Usage, Git, Preferences, the palette (Ctrl+K, type, Enter) and opens/closes a tab, and runs the packaged exe via `CCWRAP_SMOKE_EXE`. Passed against `dist\win-unpacked` |
| 10 | Test flakes | none seen | 6 runs |
| - | Real-config files unchanged | pass | sha1 of `~/.claude/settings.json` (5de5...) and `CLAUDE.md` (97e5...) and the skills/agents listing taken before; nothing in WP13 writes there. (An after-run comparison was not re-taken because the live part was blocked; the app only ever read them.) |

## Bugs fixed (commits)
- `cc54261` app.info claudePath empty for the bundled binary; real authMethod test.
- `e48bc55`, `75711e3` first-run card was only shown with no project selected; it now appears in the chat empty state (as designed, D12), without clipping in short panes. Test added.
- `75711e3` command palette input showed the global `:focus-visible` ring, clipped at the top of the panel. Test added.
- `c0632f6` usage Models table header was crushed into 5 lines in the half-width card; the grid now splits only at 2xl, header shortened (full label kept for screen readers).
- `217f560` composer textarea drew a second focus ring inside the card's own ring. Test added.
- `8e74108` only en-US locales are packaged (-48 MB unpacked); smoke covers the new views.

## Visual review (against docs/design/README.md; Claude Design project not opened)
Looked at: tab strip, first-run card, palette, usage, git (clean, history, changes), preferences (top and About), auto-resume banner and tab countdown. No further layout bugs found at 1280x800 and 1100x700. The native window-controls overlay is not captured by CDP screenshots, so the tab strip beside it was checked only by geometry (about 140 px reserved right of the search box): **human check**. Toasts over the footer: not seen (needs a live toast).

## Known gaps / minor polish
- Git change rows for a file that is both staged and modified show the combined `+n -n` on both rows (numstat is merged per file).
- Palette ranking: "git" selects "Refresh git" first.
- The empty first tab and "New tab" reuse an empty draft tab (intended); the smoke script types a draft first.
- Rescan button is a forced full re-read (1.4 s on 185 files), cached range switches take 15-46 ms.
- `dist\ccwraper Setup 0.4.0.exe` (230,754,925 bytes, built earlier in WP7 before the locale trim) was not rebuilt; rebuild once before release.

## Packaging
- `npm run dist:dir`: 16 s (warm). Unpacked app 618 MB after the locale trim (666 MB before): `ccwraper.exe` 250 MB, `app.asar` 15 MB, `app.asar.unpacked` 295 MB (285 MB is the SDK's claude.exe, 10 MB node-pty incl. arm64/darwin prebuilds that could be excluded later for about 5 MB).
- `pkg-smoke.ts` passed: fonts and CSP from file://, CSP enforced, packaged `app.info` (bundled 2.1.312, unpacked path), pwsh and Git Bash with OpenConsole from `app.asar.unpacked`, no DevTools/reload, single instance.
- **Icon alpha:** not reproducible. `build/icon.png` corners are alpha 0; the generated ICO holds seven 32-bit PNG entries (colour type 6); the icon extracted from the built exe has alpha 0 at the corner. White corners are likely an Explorer / light-background rendering of the 64 px inset, human check.
- Unsigned, no auto-update (deferred, D8 / D10). The installer was never run, nothing installed, signed or published.

## SPEC / plan deviations
No `cmdk` and no sqlite (D7, D1); git is a main view (D6); cost only for in-app sessions, estimates only (D5); auto-update deferred (D10), unsigned builds (D8); dark only (D12); hotkey off by default and no tray (D4); dev userData `ccwraper-dev` (D8); the first-run card is in the chat empty state (shown also when a project is selected).

## Perf notes
Usage scan 1.4 s cold / 15-46 ms cached for 185 files (1.5 G tokens of history). Frame times were not sampled live (blocked).

## Manual (human-only) checks for v1.0
1. Two live Haiku tabs streaming: switch mid-stream, drafts kept, 6th live session suspends the LRU idle one and resumes on its next prompt, background permission toast and Show.
2. Stop agent on a running background agent card (`task_ended stopped`), Esc while it runs (stopping, then stopped, no orphan), and the unprompted turn after it finishes. Prompt: "Use the Agent tool to run `Start-Sleep 30` in Bash in the background, then list the files."
3. Frame time p95 under 20 ms with a subagent streaming and with two tabs (paste the rAF sampler from `D:\claude-tmp\p13\tabs2.js` into DevTools).
4. Auto-resume end to end: enable it, seed a pause with the reset 20 s away on a real idle session tab, check Resume now and the timed send at reset + 15 s, the notification and that the machine stays awake. Do not provoke a real limit.
5. Windows toast in dev, `win-unpacked` and the installed app (Start-menu launch, AUMID), click focuses the right tab; taskbar flash and overlay badge; hotkey chord pressed for real (focus/minimize), and a real conflict.
6. Quit while a session is busy asks first (Cancel default).
7. Tab strip beside the native window controls at several window widths; icon corners in Explorer/taskbar; installer flow.

## Prioritized remaining work for v1.0
1. Run the manual checks above (items 1, 2, 4, 5 first; they exercise the riskiest new code).
2. Rebuild the NSIS installer once and smoke the installed build by hand; decide on signing.
3. Version bump to 1.0.0 (lead's call) after 1 and 2.
4. Polish: per-side git numstat, palette ranking for exact view names, optional exclusion of non-win32-x64 node-pty prebuilds, reduce the 612 kB entry chunk.
5. Later: auto-update (needs signing and a publish target), light theme.
