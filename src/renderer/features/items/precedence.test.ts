import { describe, expect, it } from 'vitest'
import { item } from './item-fixtures'
import { computeChips, isLoadedInSession } from './precedence'

describe('computeChips', () => {
  it('skills: user beats project', () => {
    const u = item('skill', 'user', 'a')
    const p = item('skill', 'project', 'a')
    const m = computeChips([p, u], 'skill')
    expect(m.get(u)).toEqual({ overrides: 'project' })
    expect(m.get(p)).toEqual({ shadowedBy: 'user' })
  })
  it('agents: project beats user beats plugin', () => {
    const u = item('agent', 'user', 'a')
    const p = item('agent', 'project', 'a')
    const pl = item('agent', 'plugin', 'a')
    const m = computeChips([u, p, pl], 'agent')
    expect(m.get(p)?.overrides).toBe('user, plugin')
    expect(m.get(u)?.shadowedBy).toBe('project')
    expect(m.get(pl)?.shadowedBy).toBe('project')
  })
  it('commands: same name in two scopes is a conflict', () => {
    const u = item('command', 'user', 'x')
    const p = item('command', 'project', 'x')
    const m = computeChips([u, p], 'command')
    expect(m.get(u)?.conflict).toBe(true)
    expect(m.get(p)?.conflict).toBe(true)
  })
  it('a skill shadows a command of the same name', () => {
    const c = item('command', 'user', 'deploy')
    const other = item('command', 'user', 'other')
    const m = computeChips([c, other], 'command', [item('skill', 'project', 'deploy')])
    expect(m.get(c)?.shadowedBySkill).toBe(true)
    expect(m.get(other)).toBeUndefined()
  })
  it('uses the frontmatter name for skills', () => {
    const a = item('skill', 'user', 'dir-a', { frontmatterName: 'same' })
    const b = item('skill', 'project', 'dir-b', { frontmatterName: 'same' })
    expect(computeChips([a, b], 'skill').get(b)?.shadowedBy).toBe('user')
  })
})

describe('isLoadedInSession', () => {
  it('matches plain and plugin-prefixed names', () => {
    expect(isLoadedInSession(item('skill', 'user', 'a'), { skills: ['a'] })).toBe(true)
    expect(isLoadedInSession(item('skill', 'plugin', 'a', { plugin: 'pl' }), { skills: ['pl:a'] })).toBe(true)
    expect(isLoadedInSession(item('skill', 'user', 'a'), { skills: ['b'] })).toBe(false)
    expect(isLoadedInSession(item('command', 'user', 'x/y'), { slashCommands: ['x:y'] })).toBe(true)
    expect(isLoadedInSession(item('agent', 'user', 'a'), undefined)).toBe(false)
  })
})
