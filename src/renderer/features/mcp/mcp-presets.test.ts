import { describe, expect, it } from 'vitest'
import { BROWSER_PRESETS, presetForm } from './mcp-model'

describe('presetForm', () => {
  const pw = BROWSER_PRESETS[0]!
  it('wraps npx in cmd /c on Windows', () => {
    const f = presetForm(pw, 'user', true)
    expect(f.command).toBe('cmd')
    expect(f.args).toEqual(['/c', 'npx', '-y', '@playwright/mcp@latest'])
    expect(f.name).toBe('playwright')
  })
  it('keeps npx elsewhere', () => {
    const f = presetForm(pw, 'local', false)
    expect(f.command).toBe('npx')
    expect(f.args).toEqual(['-y', '@playwright/mcp@latest'])
    expect(f.scope).toBe('local')
  })
})
