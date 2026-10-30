import { describe, expect, it } from 'vitest'
import { parseFrontmatter, type FrontmatterDoc } from '@shared/frontmatter'
import { editToolList, formatToolList, parseToolList, splitToolString } from './common'
import { agentSpec } from './agent'
import { commandSpec } from './command'
import { skillSpec } from './skill'
import type { ItemIssue, ItemKindSpec, ItemValidationCtx } from './types'

function doc(data: Record<string, unknown>, error?: FrontmatterDoc['error']): FrontmatterDoc {
  return { hasFrontmatter: true, data, body: '', bodyOffset: 0, error, eol: '\n' }
}

let stub = false
try {
  parseFrontmatter('---\na: 1\n---\n')
} catch {
  stub = true
}

const okSkill = { name: 'my-skill', description: 'Does things.' }
const okAgent = { name: 'reviewer', description: 'Reviews.' }
const skillCtx: ItemValidationCtx = { fileName: 'my-skill' }
const agentCtx: ItemValidationCtx = { fileName: 'reviewer.md' }
const cmdCtx: ItemValidationCtx = { fileName: 'go.md' }

const keys = (issues: ItemIssue[]) => issues.map((i) => i.key)
const hasKey = (issues: ItemIssue[], key: string) => issues.some((i) => i.key === key)

describe('tool list helpers', () => {
  it('splits commas and spaces but not inside parentheses', () => {
    expect(splitToolString('Read, Grep Bash(git add:*, x)')).toEqual(['Read', 'Grep', 'Bash(git add:*, x)'])
  })
  it('keeps string style', () => {
    const p = parseToolList('Read, Grep')!
    expect(p.style).toBe('string')
    expect(editToolList('Read, Grep', [...p.items, 'Bash'])).toBe('Read, Grep, Bash')
    expect(formatToolList(p.items, p.style)).toBe('Read, Grep')
  })
  it('keeps list style', () => {
    const p = parseToolList(['Read', 'Grep'])!
    expect(p.style).toBe('list')
    expect(editToolList(['Read', 'Grep'], ['Read'])).toEqual(['Read'])
  })
  it('defaults to a list when there was no value, and rejects other types', () => {
    expect(editToolList(undefined, ['Read'])).toEqual(['Read'])
    expect(parseToolList(5)).toBeUndefined()
  })
})

describe.each<[string, ItemKindSpec, Record<string, unknown>, ItemValidationCtx]>([
  ['skill', skillSpec, okSkill, skillCtx],
  ['command', commandSpec, { description: 'Does.' }, cmdCtx],
  ['agent', agentSpec, okAgent, agentCtx]
])('%s shared rules', (_n, spec, ok, ctx) => {
  const toolKey = spec.kind === 'agent' ? 'tools' : 'allowed-tools'

  it('clean doc has no issues', () => {
    expect(spec.validate(doc(ok), ctx)).toEqual([])
  })
  it('parse error is the only error severity', () => {
    const issues = spec.validate(doc({}, { message: 'bad yaml', from: 0, to: 1 }), ctx)
    expect(issues).toEqual([{ message: 'bad yaml', severity: 'error' }])
    const bad = spec.validate(doc({ ...ok, [toolKey]: 'Bad Tool!(', model: 'zzz', description: 3 }), ctx)
    expect(bad.length).toBeGreaterThan(0)
    expect(bad.every((i) => i.severity !== 'error')).toBe(true)
  })
  it('tool list: string or list accepted', () => {
    expect(spec.validate(doc({ ...ok, [toolKey]: 'Read, Grep' }), ctx)).toEqual([])
    expect(spec.validate(doc({ ...ok, [toolKey]: ['Read', 'Bash(git:*)'] }), ctx)).toEqual([])
  })
  it('tool list: wrong type warns', () => {
    expect(hasKey(spec.validate(doc({ ...ok, [toolKey]: 5 }), ctx), toolKey)).toBe(true)
  })
  it('tool rule shape: valid passes, invalid warns', () => {
    expect(spec.validate(doc({ ...ok, [toolKey]: ['mcp__srv__tool', 'Bash(npm test)'] }), ctx)).toEqual([])
    const issues = spec.validate(doc({ ...ok, [toolKey]: ['Read', 'bad rule!'] }), ctx)
    expect(issues.filter((i) => i.severity === 'warning' && i.key === toolKey)).toHaveLength(1)
  })
  it('unknown tool: info only when not in knownTools and not mcp__', () => {
    const c = { ...ctx, knownTools: ['Read'] }
    expect(spec.validate(doc({ ...ok, [toolKey]: ['Read', 'mcp__a__b', 'Bash(x)'] }), c)).toEqual([
      { key: toolKey, message: expect.stringContaining('Bash'), severity: 'info' }
    ])
    expect(spec.validate(doc({ ...ok, [toolKey]: ['Read', 'mcp__a__b'] }), c)).toEqual([])
  })
  it('model: aliases, inherit, claude-*, supported values pass', () => {
    const c = { ...ctx, models: [{ value: 'custom-x', displayName: 'X', resolvedModel: 'resolved-x' }] }
    for (const m of ['inherit', 'default', 'opus', 'sonnet', 'fable', 'haiku', 'claude-foo-1', 'custom-x', 'resolved-x']) {
      expect(spec.validate(doc({ ...ok, model: m }), c)).toEqual([])
    }
  })
  it('model: unknown warns', () => {
    const issues = spec.validate(doc({ ...ok, model: 'gpt-9' }), ctx)
    expect(issues).toEqual([{ key: 'model', message: expect.any(String), severity: 'warning' }])
  })
  it('argument/boolean typing warns on wrong type', () => {
    if (spec.kind === 'agent') return
    expect(hasKey(spec.validate(doc({ ...ok, 'disable-model-invocation': 'yes' }), ctx), 'disable-model-invocation')).toBe(true)
    expect(spec.validate(doc({ ...ok, 'disable-model-invocation': true, 'argument-hint': '[x]' }), ctx)).toEqual([])
  })
  it('unknown keys are kept silent', () => {
    expect(spec.validate(doc({ ...ok, futureKey: 1 }), ctx)).toEqual([])
  })
})

describe('skill rules', () => {
  it('name pattern: valid passes, invalid warns', () => {
    expect(skillSpec.validate(doc({ ...okSkill, name: 'a-b-1' }), { fileName: 'a-b-1' })).toEqual([])
    const bad = skillSpec.validate(doc({ ...okSkill, name: 'Bad_Name' }), { fileName: 'Bad_Name' })
    expect(bad.some((i) => i.key === 'name' && i.severity === 'warning')).toBe(true)
    expect(hasKey(skillSpec.validate(doc({ ...okSkill, name: 'a'.repeat(65) }), { fileName: 'x' }), 'name')).toBe(true)
  })
  it('name absent is fine', () => {
    expect(skillSpec.validate(doc({ description: 'd' }), skillCtx)).toEqual([])
  })
  it('name vs directory: match passes, mismatch warns', () => {
    expect(skillSpec.validate(doc(okSkill), { fileName: 'my-skill' })).toEqual([])
    expect(keys(skillSpec.validate(doc(okSkill), { fileName: 'other' }))).toEqual(['name'])
  })
  it('description: present passes, missing/empty/long warns', () => {
    expect(skillSpec.validate(doc({ description: 'x'.repeat(1024) }), skillCtx)).toEqual([])
    expect(keys(skillSpec.validate(doc({}), skillCtx))).toEqual(['description'])
    expect(keys(skillSpec.validate(doc({ description: '  ' }), skillCtx))).toEqual(['description'])
    expect(keys(skillSpec.validate(doc({ description: 'x'.repeat(1025) }), skillCtx))).toEqual(['description'])
  })
  it('context: fork passes, other warns', () => {
    expect(skillSpec.validate(doc({ ...okSkill, context: 'fork' }), skillCtx)).toEqual([])
    expect(hasKey(skillSpec.validate(doc({ ...okSkill, context: 'nope' }), skillCtx), 'context')).toBe(true)
  })
  it('paths string or list passes, number warns; user-invocable boolean', () => {
    expect(skillSpec.validate(doc({ ...okSkill, paths: 'src/**' }), skillCtx)).toEqual([])
    expect(skillSpec.validate(doc({ ...okSkill, paths: ['a', 'b'], 'user-invocable': false, version: 2, license: 'MIT', agent: 'x' }), skillCtx)).toEqual([])
    expect(hasKey(skillSpec.validate(doc({ ...okSkill, paths: 3 }), skillCtx), 'paths')).toBe(true)
    expect(hasKey(skillSpec.validate(doc({ ...okSkill, 'user-invocable': 'no' }), skillCtx), 'user-invocable')).toBe(true)
  })
})

describe('command rules', () => {
  it('description: present passes, missing warns', () => {
    expect(commandSpec.validate(doc({ description: 'd' }), cmdCtx)).toEqual([])
    expect(keys(commandSpec.validate(doc({}), cmdCtx))).toEqual(['description'])
  })
})

describe('agent rules', () => {
  it('name and description required (warning)', () => {
    expect(agentSpec.validate(doc(okAgent), agentCtx)).toEqual([])
    const issues = agentSpec.validate(doc({}), agentCtx)
    expect(keys(issues).sort()).toEqual(['description', 'name'])
    expect(issues.every((i) => i.severity === 'warning')).toBe(true)
  })
  it('file stem vs name: match passes, mismatch warns', () => {
    expect(agentSpec.validate(doc(okAgent), { fileName: 'reviewer.md' })).toEqual([])
    expect(keys(agentSpec.validate(doc(okAgent), { fileName: 'other.md' }))).toEqual(['name'])
  })
  it('disallowedTools checked like tools', () => {
    expect(agentSpec.validate(doc({ ...okAgent, disallowedTools: 'Bash, Write' }), agentCtx)).toEqual([])
    expect(hasKey(agentSpec.validate(doc({ ...okAgent, disallowedTools: ['bad!'] }), agentCtx), 'disallowedTools')).toBe(true)
  })
  it('permissionMode: valid passes, invalid warns', () => {
    expect(agentSpec.validate(doc({ ...okAgent, permissionMode: 'plan' }), agentCtx)).toEqual([])
    expect(hasKey(agentSpec.validate(doc({ ...okAgent, permissionMode: 'wild' }), agentCtx), 'permissionMode')).toBe(true)
  })
  it('color: valid passes, invalid warns', () => {
    expect(agentSpec.validate(doc({ ...okAgent, color: 'cyan' }), agentCtx)).toEqual([])
    expect(hasKey(agentSpec.validate(doc({ ...okAgent, color: 'teal' }), agentCtx), 'color')).toBe(true)
  })
  it('maxTurns: int >= 1 passes, 0 or fraction warns', () => {
    expect(agentSpec.validate(doc({ ...okAgent, maxTurns: 5 }), agentCtx)).toEqual([])
    expect(hasKey(agentSpec.validate(doc({ ...okAgent, maxTurns: 0 }), agentCtx), 'maxTurns')).toBe(true)
    expect(hasKey(agentSpec.validate(doc({ ...okAgent, maxTurns: 1.5 }), agentCtx), 'maxTurns')).toBe(true)
  })
  it('memory: valid passes, invalid warns', () => {
    expect(agentSpec.validate(doc({ ...okAgent, memory: 'local' }), agentCtx)).toEqual([])
    expect(hasKey(agentSpec.validate(doc({ ...okAgent, memory: 'global' }), agentCtx), 'memory')).toBe(true)
  })
  it('effort: level or int passes, other warns', () => {
    expect(agentSpec.validate(doc({ ...okAgent, effort: 'xhigh' }), agentCtx)).toEqual([])
    expect(agentSpec.validate(doc({ ...okAgent, effort: 3 }), agentCtx)).toEqual([])
    expect(hasKey(agentSpec.validate(doc({ ...okAgent, effort: 'huge' }), agentCtx), 'effort')).toBe(true)
  })
  it('background boolean; skills list; mcpServers/hooks/initialPrompt', () => {
    expect(
      agentSpec.validate(doc({ ...okAgent, background: true, skills: ['a'], mcpServers: { x: {} }, hooks: {}, initialPrompt: 'hi' }), agentCtx)
    ).toEqual([])
    expect(hasKey(agentSpec.validate(doc({ ...okAgent, background: 'y' }), agentCtx), 'background')).toBe(true)
    expect(hasKey(agentSpec.validate(doc({ ...okAgent, skills: 'a' }), agentCtx), 'skills')).toBe(true)
  })
})

describe('field specs', () => {
  it('every field has a unique key, and no hex colors appear', () => {
    for (const s of [skillSpec, commandSpec, agentSpec]) {
      const ks = s.fields.map((f) => f.key)
      expect(new Set(ks).size).toBe(ks.length)
      expect(JSON.stringify(s.fields)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    }
  })
})

describe('templates', () => {
  it.each<[ItemKindSpec, ItemValidationCtx, string]>([
    [skillSpec, { fileName: 'new-skill' }, 'new-skill'],
    [commandSpec, { fileName: 'new-cmd.md' }, 'new-cmd'],
    [agentSpec, { fileName: 'new-agent.md' }, 'new-agent']
  ])('template parses and validates clean', (spec, ctx, name) => {
    const text = spec.template(name)
    expect(text.startsWith('---\n')).toBe(true)
    if (stub) return
    const parsed = parseFrontmatter(text)
    expect(parsed.error).toBeUndefined()
    expect(spec.validate(parsed, ctx)).toEqual([])
  })
  it.skipIf(stub)('real parser: yaml error reaches validate as the only error', () => {
    const parsed = parseFrontmatter('---\nname: [oops\n---\nbody')
    const issues = skillSpec.validate(parsed, skillCtx)
    expect(issues.map((i) => i.severity)).toEqual(['error'])
  })
})
