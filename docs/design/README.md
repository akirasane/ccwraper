# ccwraper design (P1 reference)

Modern premium dark, Linear / Raycast / Arc feel (SPEC section 10, 10.1). Fonts: Geist (UI) and Geist Mono (code, terminal).

## Links

- Project: https://claude.ai/design/p/e1a57c8b-b4b4-44c3-b06f-2a00b33d5f5a
- Main window prototype (interactive): https://claude.ai/design/p/e1a57c8b-b4b4-44c3-b06f-2a00b33d5f5a?file=Main+Window.dc.html
- /design tokens page: https://claude.ai/design/p/e1a57c8b-b4b4-44c3-b06f-2a00b33d5f5a?file=Design+Tokens.dc.html
- Tokens: `docs/design/tokens.css` (source of truth; the project's `tokens.css` mirrors it, and `components.css` there holds the reference component CSS)

Prototype controls: `Ctrl+K` palette (arrows, Enter, Esc, type to fuzzy-filter), ``Ctrl+` `` terminal, `Ctrl+I` inspector, `Ctrl+F` terminal search, `Esc` interrupts the run. The demo plays this sequence: streaming text, Bash running then done, permission dialog, then the commit result. "Replay streaming demo" is in the palette.

## Tailwind mapping

Map every token as `theme.extend` pointing at the CSS variable, e.g. `colors: { bg: { 0: 'var(--bg-0)', 1: 'var(--bg-1)', 2: 'var(--bg-2)', 3: 'var(--bg-3)' }, fg: { DEFAULT: 'var(--text-primary)', 2: 'var(--text-secondary)', 3: 'var(--text-tertiary)', muted: 'var(--text-muted)' }, ok: 'var(--ok)', ... }`, `borderRadius: { xs: '4px', sm: '8px', md: '12px', lg: '16px' }`, `fontSize: { '2xs': '10px', xs: '11px', sm: '12px', base: '13px', md: '14px', lg: '16px', xl: '20px', '2xl': '28px' }`, `transitionDuration: { instant: '80ms', fast: '120ms', base: '180ms', slow: '250ms' }`, `transitionTimingFunction: { out: 'var(--ease-out)', spring: 'var(--ease-spring)' }`. Do not hardcode hex values in components.

## Layout (px)

| Region | Size | Notes |
|---|---|---|
| Window minimum | 1024 x 640 | Set `minWidth`/`minHeight` on BrowserWindow |
| Title bar | 40 high | `-webkit-app-region: drag`; tabs, palette button, toggles are `no-drag`. Window controls are 46 wide each, close hover `#C42B1C` |
| Session tab | 28 high, max 240 wide, min 72 | 8px radius; active tab gets bg-2 plus a 2px accent-gradient underline 6px below |
| Palette trigger (title bar) | 260 x 26, shrinks to 120 | |
| Left rail | 232 wide (56 collapsed) | Project switcher, nav rows 30 high, session rows 2 lines, Settings pinned at bottom |
| Chat column | fluid, content max 760, 24 side padding | Stream gap 14 between blocks |
| Composer | max 760, min 92 high, 12px radius, 1px gradient border | Docked at the bottom with a 220px ambient radial glow behind it |
| Inspector | 320 open, 44 collapsed | Header 40; tabs Session / Changes; collapsed state is an icon column |
| Terminal panel | default 260, min 120, max 70vh | Header 36; chat keeps at least 200 |
| Status bar | 26 high | 11px text, tabular numbers |
| Command palette | 620 wide, top 96 (10vh on short windows), list max 460 / 62vh | Rows 36, group headers 28 |
| Permission dialog | 520 wide, 20 padding, centered | |
| Toast | 340 wide, stack bottom-right 16 / 40, gap 8, max 3 visible | |

## Components and states

All interactive elements: hover lifts 1px (buttons) or raises the bg (rows), press scales to 0.98, keyboard focus shows `--accent-ring` (`:focus-visible` only). Disabled is 42% opacity with `not-allowed`.

| Component | Variants | States |
|---|---|---|
| Button | primary (accent-solid, white text, glow), secondary (bg-2 + border-strong), ghost, danger (tint); sizes 30 / 24, icon 28 / 24 | default, hover, active, focus, disabled |
| Input | text, mono | default, hover, focus (violet border + 3px 18% ring), error (danger border + tint ring, help text in danger), disabled |
| Chip | neutral, selected (accent tint), ok, warn, danger, running; 24 high | default, hover, active |
| Status pill | run (spinner), done (check), err (x); 22 high | glyphs are stacked and crossfade + scale on state change; err shakes once (360ms) |
| Toggle | 30 x 18, knob 12 | off, on (accent-solid), disabled; knob uses spring easing |
| Toast | ok, warn, danger icon; glass-strong | enters with slide-up + fade (250ms), auto-dismiss 4s |
| Tool card | Bash, Edit, Read, etc. Header 38: icon, name, mono arg (ellipsis), meta (duration or +/- counts), hover actions, status pill | running, done, error (danger border, tinted body), needs approval |
| Diff view | unified, 2 line-number gutters 36, sign column 18, 20px lines | add / del rows use 9% tints; rows flash accent once when applied |
| Thinking block | collapsed by default, "Thought for Ns" | collapsed, open (grid-rows 0fr to 1fr, 250ms), active (label shimmer) |
| Streaming text | 14px prose, 1.65 leading | tokens fade in from blur 2px (240ms); gradient caret pulses while streaming |
| Composer | textarea + @file, /cmd, model, mode chips + send | idle (border-strong), focus (accent-gradient border + glow), running (conic sweep 2.4s, send becomes stop, "Esc to interrupt") |
| Permission dialog | glass, scrim 55% | Deny (ghost, Esc), Always allow (secondary, writes `Bash(cmd:*)` to `.claude/settings.local.json`, then toast), Allow once (primary, autofocus, Enter) |
| Command palette | glass, input 52 high, grouped results | highlight pill follows selection via translateY (180ms); the selected row must be scrolled into view |
| Inspector | Session (context bar, tasks, MCP servers), Changes (file list + diff preview) | open, collapsed |
| Terminal panel | shell tabs, + / profile dropdown, cwd, find, split, clear, copy, kill, close | open (slide 40px + fade), closed; resize handle highlights on hover; search overlay (glass) |

## Motion rules

- Durations: instant 80, fast 120, base 180, slow 250. Easing: `--ease-out` by default, `--ease-spring` for toggles, glyph pops and terminal snap. Framer Motion equivalent spring: `{ type: 'spring', stiffness: 500, damping: 32 }`.
- Animate only `transform` and `opacity` (plus `filter` on dialog entry). The prototype animates grid rows for the thinking block, terminal and inspector width for brevity. In the app, animate the panel with transform and resize the chat only after the transition ends. Never animate layout inside the virtualized message list.
- Enter: tool cards slide up 6px + fade (180ms). Session list items stagger 30ms, at most 8 items, the rest appear instantly. Dialogs scale from 0.96 with a 6px blur (180ms). The palette opens in 140ms.
- Loops: spinner 0.8s, caret 1.06s, shimmer 1.6s, composer sweep 2.4s (`@property --sweep`), terminal cursor blink 1.1s steps. Only one sweep at a time.
- Counters (cost, ctx %) tick toward their target over at most 600ms.
- `prefers-reduced-motion: reduce`: all duration tokens drop to 0, press scale to 1, hover lift to 0. There is no shimmer, sweep or caret pulse. The spinner stays but slows to 1.6s, because it carries state.

## Terminal theme (xterm.js `ITheme`)

```json
{
  "background": "#101014",
  "foreground": "#D4D4DC",
  "cursor": "#A78BFA",
  "cursorAccent": "#101014",
  "selectionBackground": "rgba(139, 92, 246, 0.25)",
  "selectionInactiveBackground": "rgba(139, 92, 246, 0.14)",
  "black": "#3A3A45",
  "red": "#F87171",
  "green": "#4ADE80",
  "yellow": "#FBBF24",
  "blue": "#60A5FA",
  "magenta": "#C084FC",
  "cyan": "#22D3EE",
  "white": "#D4D4DC",
  "brightBlack": "#82828F",
  "brightRed": "#FCA5A5",
  "brightGreen": "#86EFAC",
  "brightYellow": "#FDE68A",
  "brightBlue": "#93C5FD",
  "brightMagenta": "#D8B4FE",
  "brightCyan": "#67E8F9",
  "brightWhite": "#F4F4F7"
}
```

Terminal options: `fontFamily: '"Geist Mono", "Cascadia Code", Consolas, monospace'`, `fontSize: 13`, `lineHeight: 1.5`, `cursorBlink: true`, `cursorStyle: 'block'`, `scrollback: 10000`, `allowTransparency: true`. Use the WebGL renderer with ligatures on. Search decorations: `matchBackground: 'rgba(251,191,36,0.22)'`, `matchBorder: 'rgba(251,191,36,0.35)'`, `activeMatchBackground: '#FBBF24'`, `activeMatchColorOverviewRuler: '#FBBF24'`. The cursor glow (`box-shadow 0 0 10px rgba(167,139,250,.65)`) and the top fade are DOM overlays, not xterm options.

## Contrast check (WCAG 2.1, computed)

| Foreground | bg-0 | bg-1 | bg-2 | bg-3 | Verdict |
|---|---|---|---|---|---|
| text-primary #ECECF1 | 16.80 | 16.12 | 15.31 | 14.23 | AA/AAA |
| text-secondary #9A9AA8 | 7.12 | 6.84 | 6.49 | 6.03 | AA/AAA |
| text-tertiary #82828F | 5.22 | 5.01 | 4.76 | 4.42 | AA on bg-0..2; on bg-3 large text only |
| text-muted #62626F | 3.29 | 3.16 | 3.00 | 2.79 | Fails AA. Use only for placeholders, disabled text, decoration |
| accent-text #A78BFA | 7.27 | 6.98 | 6.63 | 6.16 | AA |
| ok #4ADE80 | 11.35 | 10.89 | 10.35 | 9.61 | AA |
| warn #FBBF24 | 11.85 | 11.37 | 10.80 | 10.04 | AA |
| danger #F87171 | 7.15 | 6.86 | 6.52 | 6.06 | AA |
| info #60A5FA | 7.78 | 7.47 | 7.09 | 6.59 | AA |
| ANSI (all except black) | | 6.86 to 17.29 on #101014 | | | AA |
| ANSI black #3A3A45 | | 1.69 | | | Background role only |

- White on accent: #FFF on #8B5CF6 is 4.23 and on #3B82F6 is 3.68, so both fail for text. Filled buttons with labels therefore use `--accent-solid` (#7C3AED 5.70 to #2563EB 5.17). The SPEC gradient stays for borders, rings, the caret and icons, where 3:1 is enough for non-text.
- Semantic text on its own 10% tint stays above 6:1 (ok 9.66, warn 9.91, danger 6.30).
- Assumption: `--text-tertiary` (#82828F) is an addition to the SPEC palette. It is needed because SPEC muted (#62626F) cannot carry readable meta text at AA.
