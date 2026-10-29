# ccwrap — Claude Code Desktop Wrapper (Spec v0.1)

GUI shell around Claude Code. Drives the real engine via `@anthropic-ai/claude-agent-sdk` (latest on npm at spec time: 0.3.312). Does not reimplement the agent.

## 1. Stack
| Layer | Pick |
|---|---|
| Shell | Electron + electron-vite |
| Lang | TypeScript (strict) |
| UI | React + Tailwind + shadcn/ui |
| State | Zustand (live UI) + TanStack Query (file-backed data) |
| Editor/diff | Monaco |
| Terminal | xterm.js + node-pty |
| Motion | `motion` (Framer Motion) + CSS transitions; GSAP only if needed |
| Primitives | Radix UI (via shadcn), `cmdk` palette, `sonner` toasts, `vaul`/Radix dialogs |
| Icons/Fonts | lucide-react; Geist Sans + Geist Mono (bundled, no CDN) |
| Local DB | better-sqlite3 (UI metadata only: pins, tags, tab layout) |
| Validation | Zod |
| Package | electron-builder |

Auth: reuse the user's existing `claude login` (or API key env). App never stores or reads tokens.

## 2. Process architecture
```
Renderer (React)  <-- typed IPC (contextBridge) -->  Main (Node)
                                                      ├─ SessionManager  (1 SDK query per live session)
                                                      ├─ ConfigService   (settings/skills/mcp/commands files)
                                                      ├─ HistoryService  (reads ~/.claude/projects/**/*.jsonl)
                                                      ├─ PtyService      (embedded terminal)
                                                      └─ Db              (sqlite)
```
- Renderer has no Node access. `contextIsolation: true`, `nodeIntegration: false`.
- All SDK objects live in main. Renderer receives plain serializable events.

## 3. Folder layout
```
ccwrap/
  package.json
  electron.vite.config.ts
  src/
    shared/            # types + zod schemas used by both sides
      ipc.ts           # channel names + payload types
      events.ts        # normalized SessionEvent union
      config-schemas.ts
    main/
      index.ts
      ipc/             # one file per domain: session, config, history, pty
      services/
        session-manager.ts
        sdk-adapter.ts      # ONLY file importing the SDK; maps SDK msgs -> SessionEvent
        config-service.ts
        history-service.ts  # jsonl parser, behind adapter (format is unstable)
        mcp-service.ts
        skills-service.ts
        pty-service.ts
      db/
    preload/index.ts
    renderer/
      app/              # routes/layout
      features/
        chat/           # MessageList, ToolCard, ThinkingBlock, DiffView, PermissionDialog, Composer
        sessions/
        settings/
        mcp/
        skills/
        commands/
        usage/
        terminal/
      stores/
      lib/
```
Rule: SDK types never leak past `sdk-adapter.ts`. Upgrade-proofing.

## 4. Normalized event model (`shared/events.ts`)
```ts
type SessionEvent =
  | { t: 'init'; sessionId: string; model: string; tools: string[]; mcp: {name:string; status:string}[]; slashCommands: string[]; cwd: string }
  | { t: 'text_delta'; msgId: string; text: string }
  | { t: 'thinking_delta'; msgId: string; text: string }
  | { t: 'assistant_message'; msgId: string; blocks: Block[]; parentToolUseId?: string }
  | { t: 'tool_use'; toolUseId: string; name: string; input: unknown; parentToolUseId?: string }
  | { t: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { t: 'permission_request'; reqId: string; toolName: string; input: unknown }
  | { t: 'status'; state: 'idle'|'running'|'waiting_permission'|'error' }
  | { t: 'result'; costUsd: number; durationMs: number; turns: number; usage: Usage; isError: boolean }
  | { t: 'error'; message: string };
```
Diff for Edit/Write is computed in the renderer from `tool_use.input` (old_string/new_string/content).

## 5. IPC contract (typed, invoke + event)
Renderer -> Main (invoke):
- `session:start {cwd, prompt, model?, permissionMode?, resumeId?, fork?}` -> `{localId}`
- `session:send {localId, text, attachments?}`
- `session:interrupt {localId}`
- `session:setModel {localId, model}` / `session:setPermissionMode {localId, mode}`
- `session:permissionReply {localId, reqId, decision:'allow'|'deny', remember?:'once'|'session'|'always', updatedInput?}`
- `history:list {cwd?}` / `history:load {sessionId}` / `history:delete|rename`
- `config:read|write {scope:'user'|'project'|'local', ...}`
- `mcp:list|add|remove|update|test`
- `skills:list|read|write|delete|create`
- `commands:list|read|write|delete`
- `pty:open|write|resize|close`

Main -> Renderer (event): `session:event {localId, event: SessionEvent}`, `pty:data`, `fs:changed {path}` (chokidar on config files so external edits refresh UI).

## 6. Key behaviors
- **Streaming:** SDK `includePartialMessages: true`; adapter turns deltas into `text_delta`/`thinking_delta`.
- **Permissions:** `canUseTool` returns a Promise held open until `permissionReply` arrives. UI shows dialog; "always" writes a rule into settings `permissions.allow` via ConfigService.
- **Settings/skills/CLAUDE.md:** pass `settingSources: ['user','project','local']` explicitly (SDK does not load by default).
- **Resume/fork:** `resume: sessionId`, optional fork. Session id comes from `init` event.
- **Multi-session:** SessionManager keeps `Map<localId, Query>`; tabs in UI map to localIds. Cap concurrent sessions (default 5).
- **Interrupt:** call SDK interrupt, status -> idle.
- **Slash commands:** sent as plain prompt text; palette populated from `init.slashCommands`.

## 7. Config file map (ConfigService)
| Thing | Path |
|---|---|
| User settings | `~/.claude/settings.json` |
| Project settings | `<proj>/.claude/settings.json` |
| Local settings | `<proj>/.claude/settings.local.json` |
| User MCP / state | `~/.claude.json` |
| Project MCP | `<proj>/.mcp.json` |
| Skills | `~/.claude/skills/*/SKILL.md`, `<proj>/.claude/skills/*/SKILL.md`, plugin skills (read-only) |
| Commands | `~/.claude/commands/*.md`, `<proj>/.claude/commands/*.md` |
| Agents | `~/.claude/agents/*.md`, `<proj>/.claude/agents/*.md` |
| Memory | `CLAUDE.md` (user + project) |
| Sessions | `~/.claude/projects/<encoded-path>/<id>.jsonl` |

Write rules: read-modify-write with atomic temp+rename, keep unknown keys untouched, backup `.bak` before first write per session, never write `~/.claude.json` while a CLI instance may be writing it (prefer `claude mcp ...` CLI for MCP mutations; verify in P0).

## 8. Phases
- **P0 spike (1-2 days):** electron-vite scaffold; sdk-adapter; send one prompt; stream text/thinking/tool events to a raw log view. Verify actual SDK option and message names, partial messages, canUseTool, resume, settingSources. Verify Windows `claude` binary resolution.
- **P1 MVP:** design tokens + base components + `/design` page; chat UI (markdown, tool cards, diff, thinking collapse), permission dialog, project picker, session list + resume, interrupt, cost meter.
- **P2:** settings editor (form + raw JSON + precedence view), MCP manager, `CLAUDE.md` editor, embedded terminal (xterm.js + node-pty, themed).
- **P3:** skills, commands, agents, hooks editors.
- **P4:** usage dashboard, multi-tab, notifications, global hotkey, git panel, packaging/auto-update.

## 9. Risks
| Risk | Mitigation |
|---|---|
| jsonl/config formats are not a public contract | adapter layer + Zod `.passthrough()` + tolerant parsing + fixtures tests |
| SDK lags CLI features | pin version; feature-flag UI per capability seen in `init` |
| Concurrent writes to config with running CLI | atomic writes, chokidar reload, prefer CLI for MCP |
| Large sessions slow UI | virtualized list, lazy-load tool output |
| Windows paths / project dir encoding | central `paths.ts`, tests with Windows fixtures |

## 10. Design system (modern premium dark)
Direction: Linear / Raycast / Arc feel. Dark-first, calm, dense but airy, one accent.

**Tokens** (CSS variables, Tailwind-mapped; light theme optional later)
- Surfaces (layered, not flat): `bg-0 #0A0A0C` app, `bg-1 #101014` panels, `bg-2 #16161B` cards, `bg-3 #1D1D24` hover/raised.
- Borders: 1px `rgba(255,255,255,0.06)`, stronger `0.10` on focus/hover. Inner top highlight `inset 0 1px 0 rgba(255,255,255,0.04)` on raised cards.
- Text: `#ECECF1` primary, `#9A9AA8` secondary, `#62626F` muted.
- Accent: one gradient, violet to blue (`#8B5CF6 -> #3B82F6`), used sparingly (send button, focus ring, active tab, streaming indicator). Semantic: green ok, amber warn, red danger, each with 10% tinted bg.
- Radius: 8 / 12 / 16. Shadows: soft, large blur, low opacity; glow only on accent elements.
- Type: Geist Sans UI, Geist Mono code; tight tracking on headings; 13-14px base for density.

**Effects**
- Glass: sidebar, command palette, dialogs use `backdrop-blur` + translucent surface + 1px border. Optional Windows 11 Mica/acrylic via `BrowserWindow.backgroundMaterial`.
- Ambient: faint radial accent glow behind the composer and empty state; subtle noise texture overlay (2-3% opacity) to kill banding.
- Gradient border on the focused composer (animated conic sweep while the agent is running).
- Custom frameless title bar with integrated tabs; thin custom scrollbars; selection color matches accent.

**Motion** (all springs/short eases, 120-250ms, respect `prefers-reduced-motion`)
- Streaming text: smooth token fade-in, soft caret pulse; thinking block shimmer while active, collapses with height spring.
- Tool cards: slide+fade in, status chip morphs running (spinner) -> done (check) -> error (shake). Diff lines highlight-flash when applied.
- Layout: shared-layout transitions for tab switching and sidebar collapse; list items stagger in; dialogs scale+blur in.
- Command palette (Ctrl+K): instant open, fuzzy list with animated highlight pill following selection.
- Micro: button press scale 0.98, hover lift 1px, toggle springs, toast slide-stack, cost/token counters tick-up.
- Perf rule: animate only transform/opacity; no layout animation inside the virtualized message list; cap concurrent animations.

**Layout**
```
┌──────────────────────────────────────────────────────────┐
│ ▢ ccwrap   [tab][tab][+]                    ⌘K   ─ □ ✕  │ title bar
├──────┬───────────────────────────────────────┬───────────┤
│ proj │  chat stream (tool cards, diffs,      │ inspector │
│ sess │  thinking)                            │ files/diff│
│ nav  │                                       │ MCP/ctx   │
│      │  ┌ composer: @file  /cmd  model  mode ┐│ (toggle)  │
├──────┴──┴───────────────────────────────────┴┴───────────┤
│ status: model · mode · ctx 42% · $0.31 · cwd              │
└──────────────────────────────────────────────────────────┘
```
Left rail: Projects/Sessions, Skills, MCP, Settings, Usage. Right inspector collapsible. Everything reachable from the palette.

**Process**
- Build a `/design` page (Storybook-lite) in P1 showing tokens + components so polish stays consistent.
- Mock design in Figma or a quick HTML prototype before P1 UI build if desired.
- Quality bar: 60fps during streaming, no layout shift, visible focus states, WCAG AA contrast on text.

### 10.1 Embedded terminal design
- Engine: xterm.js (WebGL renderer addon for speed) + node-pty (ConPTY on Windows). Addons: fit, search, web-links, unicode11, ligatures.
- Theme: xterm theme mapped from design tokens (bg `bg-1`, transparent-friendly, accent cursor, curated 16-color ANSI palette tuned for dark, AA contrast). Geist Mono, 13px, ligatures on.
- Chrome: docked bottom panel or right inspector tab, glass header with shell tabs (PowerShell / cmd / Git Bash / WSL auto-detected), "+" new tab, split, kill, clear, copy. Drag-resize with spring snap; open/close slide animation; Ctrl+` toggles.
- Polish: soft cursor glow + smooth cursor blink, thin scrollbar, selection uses accent at 25%, subtle top fade when scrolled, search bar overlay (Ctrl+F) with animated match highlight.
- Integration: "Run in terminal" button on Bash tool cards; click file paths/errors in output to open in the inspector/Monaco; per-project cwd; shell profile choice in settings.
- Perf/safety: output batched per frame, scrollback cap (default 10k lines), pty killed on tab close/app quit, no env secrets echoed in UI logs.

## 11. Decisions
1. App name: **ccwraper**.
2. Platform: Windows first, cross-platform later (keep all paths/shell logic in `paths.ts` / services so porting is cheap).
3. Embedded terminal: IN SCOPE, must match the premium design (see 10.1). Built in P2.
