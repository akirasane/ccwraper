import { describe, expect, it } from 'vitest'
import { HookEntrySchema, HooksSettingSchema } from './config-schemas'
import { IpcChannels } from './channels'
import {
  ConfigFileRefSchema,
  ItemsCreateSchema,
  ItemsDeleteSchema,
  ItemsListSchema,
  ItemsRenameSchema,
  SessionStopTaskSchema,
  isValidNewName,
  isValidRefName
} from './ipc'

const CWD = 'C:/fixture/proj'

describe('P3 contracts', () => {
  it('declares the P3 channels', () => {
    expect(IpcChannels.sessionStopTask).toBe('session:stopTask')
    expect(IpcChannels.itemsList).toBe('items:list')
    expect(IpcChannels.itemsCreate).toBe('items:create')
    expect(IpcChannels.itemsRename).toBe('items:rename')
    expect(IpcChannels.itemsDelete).toBe('items:delete')
  })

  it('item refs: user needs no cwd, project does, plugin is its own variant', () => {
    const ok = (r: unknown): boolean => ConfigFileRefSchema.safeParse(r).success
    expect(ok({ kind: 'skill', scope: 'user', name: 'my-skill' })).toBe(true)
    expect(ok({ kind: 'skill', scope: 'project', name: 'my-skill' })).toBe(false)
    expect(ok({ kind: 'skill', scope: 'project', cwd: CWD, name: 'my-skill' })).toBe(true)
    expect(ok({ kind: 'agent', scope: 'plugin', plugin: 'ex@market', name: 'reviewer' })).toBe(true)
    expect(ok({ kind: 'agent', scope: 'plugin', name: 'reviewer' })).toBe(false)
    expect(ok({ kind: 'agent', scope: 'plugin', plugin: 'bad plugin!', name: 'reviewer' })).toBe(false)
  })

  it('the generalized cwd refine still covers settings and memory', () => {
    expect(ConfigFileRefSchema.safeParse({ kind: 'settings', scope: 'local' }).success).toBe(false)
    expect(ConfigFileRefSchema.safeParse({ kind: 'memory', scope: 'projectDotClaude' }).success).toBe(false)
    expect(ConfigFileRefSchema.safeParse({ kind: 'memory', scope: 'user' }).success).toBe(true)
  })

  it('ref names are lenient but never traverse; segment count depends on kind', () => {
    const ref = (kind: string, name: string): boolean =>
      ConfigFileRefSchema.safeParse({ kind, scope: 'user', name }).success
    expect(ref('skill', 'Old_Skill.v2')).toBe(true) // existing files keep working
    expect(ref('command', 'a/b/c')).toBe(true)
    expect(ref('command', 'a/b/c/d')).toBe(false)
    expect(ref('skill', 'a/b')).toBe(false)
    expect(ref('agent', 'a/b')).toBe(false)
    for (const bad of ['..', '../x', 'a/../b', '..\\x', '/abs', 'C:\\x', 'a//b', '.hidden', ''])
      expect(ref('command', bad), bad).toBe(false)
    expect(isValidRefName('command', 'a/b')).toBe(true)
  })

  it('new names are strict kebab-case, <= 64 chars', () => {
    expect(isValidNewName('skill', 'my-skill')).toBe(true)
    expect(isValidNewName('skill', 'My-Skill')).toBe(false)
    expect(isValidNewName('skill', 'my_skill')).toBe(false)
    expect(isValidNewName('skill', 'a--b')).toBe(false)
    expect(isValidNewName('skill', '-a')).toBe(false)
    expect(isValidNewName('skill', 'a'.repeat(65))).toBe(false)
    expect(isValidNewName('skill', 'a'.repeat(64))).toBe(true)
    expect(isValidNewName('command', 'git/commit-all')).toBe(true)
    expect(isValidNewName('command', 'a/b/c/d')).toBe(false)
    expect(isValidNewName('agent', 'a/b')).toBe(false)
    expect(isValidNewName('command', '../x')).toBe(false)
  })

  it('items:list / create / rename / delete schemas', () => {
    expect(ItemsListSchema.safeParse({ kind: 'skill' }).success).toBe(true)
    expect(ItemsListSchema.safeParse({ kind: 'hook' }).success).toBe(false)

    const create = { kind: 'command', scope: 'project', cwd: CWD, name: 'a/b', text: '---\n---\n' }
    expect(ItemsCreateSchema.safeParse(create).success).toBe(true)
    expect(ItemsCreateSchema.safeParse({ ...create, cwd: undefined }).success).toBe(false)
    expect(ItemsCreateSchema.safeParse({ ...create, scope: 'user', cwd: undefined }).success).toBe(true)
    expect(ItemsCreateSchema.safeParse({ ...create, kind: 'skill' }).success).toBe(false) // 2 segments
    expect(ItemsCreateSchema.safeParse({ ...create, name: '..\\x' }).success).toBe(false)
    expect(ItemsCreateSchema.safeParse({ ...create, name: 'Upper' }).success).toBe(false)
    expect(ItemsCreateSchema.safeParse({ ...create, text: 'x'.repeat(2_000_001) }).success).toBe(false)

    const ref = { kind: 'skill', scope: 'user', name: 'old' }
    expect(ItemsRenameSchema.safeParse({ ref, newName: 'new-name', baseHash: 'h' }).success).toBe(true)
    expect(ItemsRenameSchema.safeParse({ ref, newName: 'New', baseHash: 'h' }).success).toBe(false)
    expect(ItemsRenameSchema.safeParse({ ref, newName: 'a/b', baseHash: 'h' }).success).toBe(false)
    expect(ItemsRenameSchema.safeParse({ ref: { kind: 'settings', scope: 'user' }, newName: 'x', baseHash: 'h' }).success).toBe(false)
    const plugin = { kind: 'skill', scope: 'plugin', plugin: 'p', name: 'old' }
    expect(ItemsRenameSchema.safeParse({ ref: plugin, newName: 'x', baseHash: 'h' }).success).toBe(false)
    expect(ItemsDeleteSchema.safeParse({ ref, baseHash: 'h' }).success).toBe(true)
    expect(ItemsDeleteSchema.safeParse({ ref: plugin, baseHash: 'h' }).success).toBe(false)
    expect(ItemsDeleteSchema.safeParse({ ref }).success).toBe(false)
  })

  it('session:stopTask', () => {
    expect(SessionStopTaskSchema.safeParse({ localId: 'l', taskId: 't' }).success).toBe(true)
    expect(SessionStopTaskSchema.safeParse({ localId: 'l', taskId: '' }).success).toBe(false)
  })

  it('hook schemas keep unknown keys and unknown entry types', () => {
    const cmd = HookEntrySchema.parse({ type: 'command', command: 'echo fixture', future: 1 })
    expect((cmd as Record<string, unknown>)['future']).toBe(1)
    expect(HookEntrySchema.safeParse({ type: 'telepathy', whatever: true }).success).toBe(true)
    expect(HookEntrySchema.safeParse({ type: 'http', url: 'nope' }).success).toBe(true) // falls to loose fallback; validated by the editor
    expect(
      HooksSettingSchema.safeParse({ PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo fixture' }] }] }).success
    ).toBe(true)
  })
})
