// xterm needs literal colors, so this is the one file in features/** allowed to hold hex (guard test allowlist).
// Values mirror docs/design/README.md "Terminal theme"; theme.test.ts compares them with the README table.
import type { ITerminalOptions, ITheme } from '@xterm/xterm'

export const TERMINAL_THEME: ITheme = {
  background: '#101014',
  foreground: '#D4D4DC',
  cursor: '#A78BFA',
  cursorAccent: '#101014',
  selectionBackground: 'rgba(139, 92, 246, 0.25)',
  selectionInactiveBackground: 'rgba(139, 92, 246, 0.14)',
  black: '#3A3A45',
  red: '#F87171',
  green: '#4ADE80',
  yellow: '#FBBF24',
  blue: '#60A5FA',
  magenta: '#C084FC',
  cyan: '#22D3EE',
  white: '#D4D4DC',
  brightBlack: '#82828F',
  brightRed: '#FCA5A5',
  brightGreen: '#86EFAC',
  brightYellow: '#FDE68A',
  brightBlue: '#93C5FD',
  brightMagenta: '#D8B4FE',
  brightCyan: '#67E8F9',
  brightWhite: '#F4F4F7'
}

/**
 * README stack, with the family names fontsource actually registers first (P2 D9 bug 1).
 * The view awaits `document.fonts.load(TERMINAL_FONT_LOAD)` before `open()` so cell metrics are right.
 */
export const TERMINAL_FONT_FAMILY = '"Geist Mono Variable", "Geist Mono", "Cascadia Code", Consolas, monospace'
export const TERMINAL_FONT_LOAD = '13px "Geist Mono Variable"'

export const TERMINAL_OPTIONS: ITerminalOptions = {
  fontFamily: TERMINAL_FONT_FAMILY,
  fontSize: 13,
  lineHeight: 1.5,
  cursorBlink: true,
  cursorStyle: 'block',
  scrollback: 10000,
  allowTransparency: true,
  allowProposedApi: true, // unicode11 addon
  theme: TERMINAL_THEME
}

/** Search decorations (README). */
export const SEARCH_DECORATIONS = {
  matchBackground: 'rgba(251,191,36,0.22)',
  matchBorder: 'rgba(251,191,36,0.35)',
  matchOverviewRuler: '#FBBF24',
  activeMatchBackground: '#FBBF24',
  activeMatchColorOverviewRuler: '#FBBF24'
} as const

/** Panel height limits: min 120px, max 70% of the viewport, and chat keeps at least 200px. */
export const PANEL_MIN_HEIGHT = 120
export const PANEL_DEFAULT_HEIGHT = 260
export const CHAT_MIN_HEIGHT = 200
export const PANEL_MAX_RATIO = 0.7

export function maxPanelHeight(viewportHeight: number): number {
  return Math.max(PANEL_MIN_HEIGHT, Math.min(Math.floor(viewportHeight * PANEL_MAX_RATIO), viewportHeight - CHAT_MIN_HEIGHT))
}

export function clampPanelHeight(height: number, viewportHeight: number): number {
  if (!Number.isFinite(height)) return PANEL_DEFAULT_HEIGHT
  return Math.round(Math.min(Math.max(height, PANEL_MIN_HEIGHT), maxPanelHeight(viewportHeight)))
}
