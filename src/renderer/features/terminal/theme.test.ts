/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  clampPanelHeight,
  maxPanelHeight,
  PANEL_DEFAULT_HEIGHT,
  SEARCH_DECORATIONS,
  TERMINAL_FONT_FAMILY,
  TERMINAL_OPTIONS,
  TERMINAL_THEME
} from './theme'

const readme = readFileSync(resolve(__dirname, '../../../../docs/design/README.md'), 'utf8')

describe('terminal theme', () => {
  it('ITheme equals the README table', () => {
    const section = readme.slice(readme.indexOf('## Terminal theme'))
    const json = /```json\n([\s\S]*?)```/.exec(section)![1]!
    expect(TERMINAL_THEME).toEqual(JSON.parse(json))
  })

  it('options follow the README (corrected mono stack, scrollback, cursor)', () => {
    expect(TERMINAL_OPTIONS).toMatchObject({
      fontSize: 13,
      lineHeight: 1.5,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      allowTransparency: true
    })
    expect(TERMINAL_FONT_FAMILY.startsWith('"Geist Mono Variable"')).toBe(true)
    expect(TERMINAL_THEME.selectionBackground).toBe('rgba(139, 92, 246, 0.25)')
  })

  it('search decorations equal the README values', () => {
    expect(SEARCH_DECORATIONS.matchBackground).toBe('rgba(251,191,36,0.22)')
    expect(SEARCH_DECORATIONS.matchBorder).toBe('rgba(251,191,36,0.35)')
    expect(SEARCH_DECORATIONS.activeMatchBackground).toBe('#FBBF24')
    expect(SEARCH_DECORATIONS.activeMatchColorOverviewRuler).toBe('#FBBF24')
  })
})

describe('panel height clamp', () => {
  it('clamps to 120px .. 70vh and keeps 200px for chat', () => {
    expect(clampPanelHeight(10, 1000)).toBe(120)
    expect(clampPanelHeight(900, 1000)).toBe(700)
    expect(clampPanelHeight(300, 1000)).toBe(300)
    // short viewport: chat keeps 200px, never below the 120px minimum
    expect(maxPanelHeight(400)).toBe(200)
    expect(clampPanelHeight(390, 400)).toBe(200)
    expect(clampPanelHeight(300, 250)).toBe(120)
    expect(clampPanelHeight(Number.NaN, 1000)).toBe(PANEL_DEFAULT_HEIGHT)
  })
})
