import { describe, expect, it } from 'vitest'
import { routeSlash } from './slash-router'

describe('routeSlash', () => {
  it('routes bare app-handled commands', () => {
    expect(routeSlash('/clear')).toEqual({ kind: 'clear' })
    expect(routeSlash('  /clear  ')).toEqual({ kind: 'clear' })
    expect(routeSlash('/help')).toEqual({ kind: 'palette' })
    expect(routeSlash('/memory')).toEqual({ kind: 'view', view: 'memory' })
    expect(routeSlash('/permissions')).toEqual({ kind: 'view', view: 'settings' })
    expect(routeSlash('/config')).toEqual({ kind: 'view', view: 'settings' })
    expect(routeSlash('/mcp')).toEqual({ kind: 'view', view: 'mcp' })
    expect(routeSlash('/agents')).toEqual({ kind: 'view', view: 'agents' })
    expect(routeSlash('/hooks')).toEqual({ kind: 'view', view: 'hooks' })
    expect(routeSlash('/plugins')).toEqual({ kind: 'view', view: 'plugins' })
    expect(routeSlash('/plugin')).toEqual({ kind: 'view', view: 'plugins' })
  })

  it('is case-insensitive on the command name', () => {
    expect(routeSlash('/Clear')).toEqual({ kind: 'clear' })
  })

  it('/model with an argument switches the model; bare /model passes through', () => {
    expect(routeSlash('/model opus')).toEqual({ kind: 'model', model: 'opus' })
    expect(routeSlash('/model sonnet[1m]')).toEqual({ kind: 'model', model: 'sonnet[1m]' })
    expect(routeSlash('/model')).toBeNull()
  })

  it('passes through commands the CLI answers itself', () => {
    for (const t of ['/context', '/cost', '/usage', '/compact', '/compact keep the plan', '/review 12', '/init'])
      expect(routeSlash(t)).toBeNull()
  })

  it('passes through commands with arguments (belong to the CLI)', () => {
    expect(routeSlash('/config autoCompact=true')).toBeNull()
    expect(routeSlash('/mcp list')).toBeNull()
    expect(routeSlash('/clear now')).toBeNull()
  })

  it('does not touch plain text, paths, plugin commands or unknown names', () => {
    expect(routeSlash('hello')).toBeNull()
    expect(routeSlash('/')).toBeNull()
    expect(routeSlash('/usr/bin/env')).toBeNull()
    expect(routeSlash('/my-plugin:memory')).toBeNull()
    expect(routeSlash('/deploy')).toBeNull()
  })

  it('a project or user command with a built-in name wins', () => {
    expect(routeSlash('/memory', new Set(['memory']))).toBeNull()
    expect(routeSlash('/clear', new Set(['deploy']))).toEqual({ kind: 'clear' })
  })
})
