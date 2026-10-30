import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  bundledClaudePath,
  claudeConfigDir,
  claudeGlobalConfigPath,
  compareVersions,
  createConfigPaths,
  itemFilePath,
  itemsRoot,
  trashDir,
  managedSettingsPath,
  memoryFilePath,
  parseVersion,
  readSdkVersions,
  settingsFilePath
} from './paths'

describe('version helpers', () => {
  it('parses the x.y.z prefix', () => {
    expect(parseVersion('2.1.312 (Claude Code)')).toEqual([2, 1, 312])
    expect(parseVersion('garbage')).toBeUndefined()
  })
  it('compares numerically, not lexically', () => {
    expect(compareVersions('2.1.312', '2.1.312')).toBe(0)
    expect(compareVersions('2.1.9', '2.1.312')).toBe(-1)
    expect(compareVersions('2.10.0', '2.9.99')).toBe(1)
    expect(compareVersions('3.0.0', '2.9.99')).toBe(1)
    expect(compareVersions('nope', '2.1.0')).toBe(0)
  })
  it('reads the installed SDK versions via fs', () => {
    const v = readSdkVersions()
    expect(v.cli).toMatch(/^\d+\.\d+\.\d+/)
    expect(v.sdk).toMatch(/^\d+\.\d+\.\d+/)
  })
})

describe('config locations', () => {
  const home = join(tmpdir(), 'fixture-home')
  const cfg = join(tmpdir(), 'fixture-cfg')

  it('claudeConfigDir honours CLAUDE_CONFIG_DIR, else <home>/.claude', () => {
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: cfg }, home)).toBe(resolve(cfg))
    expect(claudeConfigDir({}, home)).toBe(join(home, '.claude'))
    expect(claudeConfigDir({ CLAUDE_CONFIG_DIR: '' }, home)).toBe(join(home, '.claude'))
  })

  it('claudeGlobalConfigPath is inside CLAUDE_CONFIG_DIR when set, else <home>/.claude.json', () => {
    expect(claudeGlobalConfigPath({ CLAUDE_CONFIG_DIR: cfg }, home)).toBe(join(resolve(cfg), '.claude.json'))
    expect(claudeGlobalConfigPath({}, home)).toBe(join(home, '.claude.json'))
  })

  it('managedSettingsPath per platform', () => {
    expect(managedSettingsPath('win32')).toBe('C:\\Program Files\\ClaudeCode\\managed-settings.json')
    expect(managedSettingsPath('darwin')).toContain('ClaudeCode')
    expect(managedSettingsPath('linux')).toBe('/etc/claude-code/managed-settings.json')
  })

  it.each([
    ['C:\\fixture\\proj'],
    ['C:/fixture/proj'],
    ['C:\\fixture\\proj\\']
  ])('settings and memory paths for project %s (either slash form)', (cwd) => {
    const proj = resolve(cwd)
    expect(resolve(settingsFilePath('project', cwd, {}, home))).toBe(join(proj, '.claude', 'settings.json'))
    expect(resolve(settingsFilePath('local', cwd, {}, home))).toBe(join(proj, '.claude', 'settings.local.json'))
    expect(resolve(memoryFilePath('project', cwd, {}, home))).toBe(join(proj, 'CLAUDE.md'))
    expect(resolve(memoryFilePath('projectDotClaude', cwd, {}, home))).toBe(join(proj, '.claude', 'CLAUDE.md'))
    expect(resolve(memoryFilePath('local', cwd, {}, home))).toBe(join(proj, 'CLAUDE.local.md'))
  })

  it('user scope ignores cwd and uses the config dir', () => {
    expect(settingsFilePath('user', undefined, { CLAUDE_CONFIG_DIR: cfg }, home)).toBe(join(resolve(cfg), 'settings.json'))
    expect(memoryFilePath('user', undefined, {}, home)).toBe(join(home, '.claude', 'CLAUDE.md'))
  })

  it('project and local scopes require a cwd', () => {
    expect(() => settingsFilePath('project')).toThrow(/cwd/)
    expect(() => memoryFilePath('local')).toThrow(/cwd/)
  })

  it('createConfigPaths bundles the same rules', () => {
    const p = createConfigPaths({ CLAUDE_CONFIG_DIR: cfg }, home)
    expect(p.configDir).toBe(resolve(cfg))
    expect(p.globalConfigPath).toBe(join(resolve(cfg), '.claude.json'))
    expect(p.settingsFile('user')).toBe(join(resolve(cfg), 'settings.json'))
  })

  it('bundledClaudePath finds the installed SDK binary on win32-x64', () => {
    const p = bundledClaudePath()
    expect(p).toBeDefined()
    expect(existsSync(p!)).toBe(true)
    expect(bundledClaudePath('linux', 'nope')).toBeUndefined()
  })
})

describe('item paths (P3)', () => {
  const home = join(tmpdir(), 'ccwrap-fixture-home')
  const cfg = join(tmpdir(), 'ccwrap-fixture-cfg')
  const proj = join(tmpdir(), 'ccwrap-fixture-proj')

  it('roots per kind and scope', () => {
    expect(itemsRoot('skill', 'user', undefined, {}, home)).toBe(join(home, '.claude', 'skills'))
    expect(itemsRoot('command', 'user', undefined, { CLAUDE_CONFIG_DIR: cfg }, home)).toBe(join(resolve(cfg), 'commands'))
    expect(itemsRoot('agent', 'project', proj, {}, home)).toBe(join(proj, '.claude', 'agents'))
    expect(() => itemsRoot('skill', 'project', undefined, {}, home)).toThrow(/cwd/)
    expect(createConfigPaths({ CLAUDE_CONFIG_DIR: cfg }, home).itemsRoot('agent', 'user')).toBe(join(resolve(cfg), 'agents'))
  })

  it('file layout: skill dir, namespaced command, flat agent', () => {
    const root = join(proj, '.claude')
    expect(itemFilePath('skill', root, 'my-skill')).toBe(join(root, 'my-skill', 'SKILL.md'))
    expect(itemFilePath('command', root, 'a/b')).toBe(join(root, 'a', 'b.md'))
    expect(itemFilePath('command', root, 'a\\b\\c')).toBe(join(root, 'a', 'b', 'c.md'))
    expect(itemFilePath('agent', root, 'reviewer')).toBe(join(root, 'reviewer.md'))
  })

  it('rejects traversal, absolute names and extra segments (both slash forms)', () => {
    const root = join(proj, '.claude', 'skills')
    for (const bad of ['..', '../x', '..\\x', 'a/../../b', 'a\\..\\..\\b', '/abs', '\\abs', 'C:\\x', 'C:/x', '', 'a//b', './x', 'a/.'])
      expect(() => itemFilePath('command', root, bad), bad).toThrow()
    expect(() => itemFilePath('skill', root, 'a/b')).toThrow()
    expect(() => itemFilePath('agent', root, 'a/b')).toThrow()
  })

  it('trashDir is under userData', () => {
    expect(trashDir('C:\\fixture\\ud')).toBe(join('C:\\fixture\\ud', 'trash'))
  })
})
