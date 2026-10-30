import { describe, expect, it } from 'vitest'
import { applyPatch } from '@/features/settings/model/settings-patch'
import {
  changedExecutables,
  mergeEffective,
  newGroup,
  opsForEvent,
  readHooks,
  validateHooks,
  type HookGroup
} from './hooks-model'

const cmd = (command: string): HookGroup => ({ matcher: 'Bash', hooks: [{ type: 'command', command }] })

describe('readHooks', () => {
  it('flags unknown events and keeps malformed ones', () => {
    const v = readHooks({ hooks: { PreToolUse: [cmd('a')], FutureEvent: [cmd('b')], Stop: 'nope' } })
    expect(v.events.map((e) => [e.event, e.known, e.malformed])).toEqual([
      ['PreToolUse', true, false],
      ['FutureEvent', false, false],
      ['Stop', true, true]
    ])
  })
  it('no hooks key is an empty view', () => {
    expect(readHooks({ model: 'x' })).toEqual({ events: [], malformed: false })
  })
})

describe('opsForEvent', () => {
  it('adds hooks.PreToolUse[0].hooks[0] and keeps other keys and order', () => {
    const text = '{\n  "model": "opus",\n  "env": { "A": "1" }\n}\n'
    const out = JSON.parse(applyPatch(text, opsForEvent('PreToolUse', [cmd('echo hi')]))) as Record<string, unknown>
    expect(Object.keys(out)).toEqual(['model', 'env', 'hooks'])
    expect(out.hooks).toEqual({ PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] }] })
  })
  it('deletes the event key when no entry is left, but keeps the pre-existing hooks object', () => {
    const text = JSON.stringify({ hooks: { PreToolUse: [cmd('a')], Stop: [cmd('b')] } })
    const out = JSON.parse(applyPatch(text, opsForEvent('PreToolUse', [{ hooks: [] }]))) as { hooks: Record<string, unknown> }
    expect(Object.keys(out.hooks)).toEqual(['Stop'])
  })
  it('an unknown event survives a save of another event', () => {
    const text = JSON.stringify({ hooks: { FutureEvent: [cmd('b')] } })
    const out = JSON.parse(applyPatch(text, opsForEvent('Stop', [cmd('c')]))) as { hooks: Record<string, unknown> }
    expect(Object.keys(out.hooks)).toEqual(['FutureEvent', 'Stop'])
    expect(out.hooks.FutureEvent).toEqual([cmd('b')])
  })
  it('keeps unknown keys on an edited group and entry', () => {
    const g: HookGroup = { matcher: 'Bash', future: 1, hooks: [{ type: 'command', command: 'a', extra: true }] }
    const edited: HookGroup = { ...g, hooks: [{ ...g.hooks[0]!, command: 'b' }] }
    const out = JSON.parse(applyPatch(JSON.stringify({ hooks: { PreToolUse: [g] } }), opsForEvent('PreToolUse', [edited]))) as {
      hooks: { PreToolUse: HookGroup[] }
    }
    expect(out.hooks.PreToolUse[0]).toEqual({ matcher: 'Bash', future: 1, hooks: [{ type: 'command', command: 'b', extra: true }] })
  })
})

describe('validateHooks', () => {
  it('requires the per-type fields', () => {
    const issues = validateHooks({
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: '' },
              { type: 'http', url: 'not a url' },
              { type: 'mcp_tool', server: 's' },
              { type: 'prompt', prompt: '' },
              { type: 'command', command: 'ok', timeout: 0 },
              { type: 'novel', x: 1 }
            ]
          }
        ]
      }
    })
    const byEntry = Object.fromEntries(issues.filter((i) => i.entry !== undefined).map((i) => [i.entry, i]))
    expect(byEntry[0]?.severity).toBe('error')
    expect(byEntry[0]?.message).toMatch(/command is required/)
    expect(byEntry[1]?.severity).toBe('error')
    expect(byEntry[2]?.message).toMatch(/tool is required/)
    expect(byEntry[3]?.severity).toBe('error')
    expect(byEntry[4]?.severity).toBe('error')
    expect(byEntry[5]?.severity).toBe('info')
  })
  it('warns on a matcher that does not compile', () => {
    const issues = validateHooks({ hooks: { PreToolUse: [{ matcher: 'Bash(', hooks: [{ type: 'command', command: 'a' }] }] } })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ severity: 'warning', group: 0 })
    expect(validateHooks({ hooks: { PreToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'a' }] }] } })).toEqual([])
    expect(validateHooks({ hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'a' }] }] } })).toEqual([])
  })
  it('flags an unknown event as info', () => {
    expect(validateHooks({ hooks: { Nope: [cmd('a')] } })[0]).toMatchObject({ severity: 'info', event: 'Nope' })
  })
  it('a fresh group is invalid until the command is filled', () => {
    expect(validateHooks({ hooks: { Stop: [newGroup()] } })[0]?.severity).toBe('error')
  })
})

describe('changedExecutables', () => {
  it('lists added and changed command / url / mcp tool strings, never headers', () => {
    const before = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'keep' }, { type: 'command', command: 'old', timeout: 5 }] }] } }
    const after = {
      hooks: {
        Stop: [
          {
            hooks: [
              { type: 'command', command: 'keep' },
              { type: 'command', command: 'old', timeout: 9 },
              { type: 'http', url: 'https://x.test/h', headers: { Authorization: 'Bearer SECRET' } },
              { type: 'mcp_tool', server: 'srv', tool: 'do' },
              { type: 'prompt', prompt: 'not executable' }
            ]
          }
        ]
      }
    }
    const out = changedExecutables(before, after)
    expect(out).toEqual([
      { event: 'Stop', kind: 'command', text: 'old', change: 'changed' },
      { event: 'Stop', kind: 'http', text: 'https://x.test/h', change: 'added' },
      { event: 'Stop', kind: 'mcp_tool', text: 'srv / do', change: 'added' }
    ])
    expect(JSON.stringify(out)).not.toContain('SECRET')
  })
  it('removals and no-ops change nothing', () => {
    const a = { hooks: { Stop: [cmd('x')] } }
    expect(changedExecutables(a, a)).toEqual([])
    expect(changedExecutables(a, {})).toEqual([])
  })
})

describe('mergeEffective', () => {
  it('merges sources in order, per event', () => {
    const out = mergeEffective([
      { source: 'user', settings: { hooks: { Stop: [cmd('u')] } } },
      { source: 'project', settings: { hooks: { Stop: [cmd('p')], PreToolUse: [cmd('q')] } } }
    ])
    expect(out.map((e) => e.event)).toEqual(['PreToolUse', 'Stop'])
    expect(out[1]!.entries.map((e) => e.source)).toEqual(['user', 'project'])
  })
})
