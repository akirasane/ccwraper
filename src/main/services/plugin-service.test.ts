import { describe, expect, it, vi } from 'vitest'
import { PluginActionSchema, PluginsBrowseSchema, PluginsMutateSchema } from '../../shared/ipc'
import type { CliResult, CliRunner } from './claude-cli'
import {
  AVAILABLE_TTL_MS,
  PluginService,
  filterAvailable,
  mutationArgs,
  parseAvailable,
  parseInstalled,
  parseMarketplaces
} from './plugin-service'

const ok = (stdout: string): CliResult => ({ code: 0, stdout, stderr: '' })
const INSTALLED = [
  { id: 'caveman@caveman', version: 'abc', scope: 'user', enabled: true, installedAt: '2026-01-01', lastUpdated: '2026-02-02', extra: 1 },
  { id: 'old@m', version: '1', scope: 'weird', enabled: false },
  { nope: true },
  'x'
]
const AVAILABLE = [
  { pluginId: 'git-helper@official', name: 'git-helper', description: 'Helps with git', marketplaceName: 'official', installCount: 50 },
  { pluginId: 'caveman@caveman', name: 'caveman', description: 'Talk short', marketplaceName: 'caveman', installCount: 10 },
  { pluginId: 'docs@official', name: 'docs', description: 'Write docs about git history', marketplaceName: 'official', installCount: 500 },
  { pluginId: 'zzz@official', name: 'zzz', description: '', marketplaceName: 'official' }
]

describe('parsers', () => {
  it('parseInstalled keeps valid rows, defaults odd scopes to user', () => {
    const r = parseInstalled(INSTALLED)
    expect(r.map((p) => [p.id, p.scope, p.enabled])).toEqual([
      ['caveman@caveman', 'user', true],
      ['old@m', 'user', false]
    ])
    expect(r[0]).toMatchObject({ installedAt: '2026-01-01', lastUpdated: '2026-02-02' })
    expect(parseInstalled({ not: 'an array' })).toEqual([])
  })
  it('parseMarketplaces picks the origin from repo, url, path or install location', () => {
    expect(
      parseMarketplaces([
        { name: 'a', source: 'github', repo: 'o/r', installLocation: 'x' },
        { name: 'b', source: 'git', url: 'https://x/y.git' },
        { name: 'c', source: 'directory', path: 'D:\\m' },
        { name: 'd', installLocation: 'L' },
        {}
      ])
    ).toEqual([
      { name: 'a', source: 'github', origin: 'o/r' },
      { name: 'b', source: 'git', origin: 'https://x/y.git' },
      { name: 'c', source: 'directory', origin: 'D:\\m' },
      { name: 'd', source: 'unknown', origin: 'L' }
    ])
  })
  it('parseAvailable defaults missing counts to 0', () => {
    expect(parseAvailable(AVAILABLE).at(-1)).toMatchObject({ pluginId: 'zzz@official', installCount: 0 })
  })
})

describe('filterAvailable', () => {
  const items = parseAvailable(AVAILABLE)
  it('empty query ranks by install count and flags installed', () => {
    const r = filterAvailable(items, new Set(['caveman@caveman']), '', 3)
    expect(r.total).toBe(4)
    expect(r.items.map((p) => p.name)).toEqual(['docs', 'git-helper', 'caveman'])
    expect(r.items.find((p) => p.name === 'caveman')?.installed).toBe(true)
  })
  it('name hits beat description hits; every term must match', () => {
    expect(filterAvailable(items, new Set(), 'git', 5).items.map((p) => p.name)).toEqual(['git-helper', 'docs'])
    expect(filterAvailable(items, new Set(), 'git history', 5).items.map((p) => p.name)).toEqual(['docs'])
    expect(filterAvailable(items, new Set(), 'nothing-matches', 5)).toEqual({ items: [], total: 0 })
  })
})

describe('mutationArgs', () => {
  it('builds the CLI argument lists', () => {
    expect(mutationArgs({ op: 'install', plugin: 'a@b', scope: 'project' })).toEqual(['plugin', 'install', '-s', 'project', 'a@b'])
    expect(mutationArgs({ op: 'uninstall', plugin: 'a@b', scope: 'user' })).toEqual(['plugin', 'uninstall', '-s', 'user', 'a@b'])
    expect(mutationArgs({ op: 'disable', plugin: 'a@b', scope: 'local' })).toEqual(['plugin', 'disable', '-s', 'local', 'a@b'])
    expect(mutationArgs({ op: 'update', plugin: 'a@b' })).toEqual(['plugin', 'update', 'a@b'])
    expect(mutationArgs({ op: 'marketplaceAdd', source: 'owner/repo' })).toEqual(['plugin', 'marketplace', 'add', 'owner/repo'])
    expect(mutationArgs({ op: 'marketplaceUpdate' })).toEqual(['plugin', 'marketplace', 'update'])
    expect(mutationArgs({ op: 'marketplaceUpdate', name: 'm' })).toEqual(['plugin', 'marketplace', 'update', 'm'])
  })
})

describe('PluginService', () => {
  it('list runs both JSON commands and surfaces a CLI failure as error', async () => {
    const run = vi.fn<CliRunner>(async (args) =>
      args.includes('marketplace') ? ok(JSON.stringify([{ name: 'm', source: 'github', repo: 'o/r' }])) : ok(JSON.stringify(INSTALLED))
    )
    const r = await new PluginService({ run }).list()
    expect(r.installed).toHaveLength(2)
    expect(r.marketplaces).toEqual([{ name: 'm', source: 'github', origin: 'o/r' }])
    expect(r.error).toBeUndefined()

    const bad = vi.fn<CliRunner>(async () => ({ code: 1, stdout: '', stderr: 'boom\nmore' }))
    expect(await new PluginService({ run: bad }).list()).toMatchObject({ installed: [], marketplaces: [], error: 'boom' })
    const junk = vi.fn<CliRunner>(async () => ok('not json'))
    expect((await new PluginService({ run: junk }).list()).error).toMatch(/Could not read/)
  })

  it('browse caches the large catalog until the TTL passes or a mutation happens', async () => {
    let t = 0
    const run = vi.fn<CliRunner>(async () => ok(JSON.stringify({ installed: [{ id: 'caveman@caveman', scope: 'user', enabled: true, version: '1' }], available: AVAILABLE })))
    const s = new PluginService({ run, now: () => t })
    const first = await s.browse({ query: 'cave', limit: 5 })
    expect(first.items[0]).toMatchObject({ name: 'caveman', installed: true })
    await s.browse({ query: 'git', limit: 5 })
    expect(run).toHaveBeenCalledTimes(1)
    await s.mutate({ op: 'update', plugin: 'a@b' })
    await s.browse({ query: 'git', limit: 5 })
    expect(run.mock.calls.filter((c) => c[0].includes('--available'))).toHaveLength(2)
    t += AVAILABLE_TTL_MS + 1
    await s.browse({ query: 'git', limit: 5 })
    expect(run.mock.calls.filter((c) => c[0].includes('--available'))).toHaveLength(3)
  })

  it('mutate: success returns output, failure returns the first stderr line plus full output', async () => {
    const run = vi.fn<CliRunner>()
    run.mockResolvedValueOnce({ code: 0, stdout: 'Installed a@b\n', stderr: '' })
    run.mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'Plugin not found\nlooked in 2 marketplaces' })
    const s = new PluginService({ run })
    expect(await s.mutate({ op: 'install', plugin: 'a@b', scope: 'user' })).toEqual({ ok: true, output: 'Installed a@b' })
    expect(await s.mutate({ op: 'install', plugin: 'x@y', scope: 'user' })).toEqual({
      ok: false,
      message: 'Plugin not found',
      output: 'Plugin not found\nlooked in 2 marketplaces'
    })
  })

  it('project and local scope need a project folder; user scope does not', async () => {
    const run = vi.fn<CliRunner>(async () => ok('done'))
    const s = new PluginService({ run })
    expect(await s.mutate({ op: 'enable', plugin: 'a@b', scope: 'project' })).toMatchObject({ ok: false })
    expect(run).not.toHaveBeenCalled()
    expect(await s.mutate({ op: 'enable', plugin: 'a@b', scope: 'project' }, 'C:/proj')).toMatchObject({ ok: true })
    expect(run.mock.calls[0]![1].cwd).toBe('C:/proj')
    expect(await s.mutate({ op: 'enable', plugin: 'a@b', scope: 'user' })).toMatchObject({ ok: true })
  })

  it('serializes mutations', async () => {
    const order: string[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const run = vi.fn<CliRunner>(async (args) => {
      order.push(`start ${args[2]}`)
      if (args[2] === 'a@b') await gate
      order.push(`end ${args[2]}`)
      return ok('')
    })
    const s = new PluginService({ run })
    const p1 = s.mutate({ op: 'update', plugin: 'a@b' })
    const p2 = s.mutate({ op: 'update', plugin: 'c@d' })
    await new Promise((r) => setTimeout(r, 10))
    expect(order).toEqual(['start a@b'])
    release()
    await Promise.all([p1, p2])
    expect(order).toEqual(['start a@b', 'end a@b', 'start c@d', 'end c@d'])
  })
})

describe('plugin schemas', () => {
  it('accept normal ids and sources', () => {
    expect(PluginActionSchema.safeParse({ op: 'install', plugin: 'caveman@caveman', scope: 'user' }).success).toBe(true)
    expect(PluginActionSchema.safeParse({ op: 'update', plugin: 'a.b-c_d' }).success).toBe(true)
    expect(PluginActionSchema.safeParse({ op: 'marketplaceAdd', source: 'JuliusBrussee/caveman' }).success).toBe(true)
    expect(PluginActionSchema.safeParse({ op: 'marketplaceAdd', source: 'https://github.com/o/r.git' }).success).toBe(true)
    expect(PluginActionSchema.safeParse({ op: 'marketplaceAdd', source: 'D:\\my plugins\\market' }).success).toBe(true)
    expect(PluginActionSchema.safeParse({ op: 'marketplaceUpdate' }).success).toBe(true)
  })
  it('reject anything that could become a CLI flag or break the argument list', () => {
    for (const plugin of ['--help', '-s', '', 'a b', 'a@b@c', 'a;rm', '../x', 'a@'])
      expect(PluginActionSchema.safeParse({ op: 'update', plugin }).success, plugin).toBe(false)
    for (const source of ['--config', '-x', '', 'a\nb', 'x'.repeat(501)])
      expect(PluginActionSchema.safeParse({ op: 'marketplaceAdd', source }).success, source).toBe(false)
    expect(PluginActionSchema.safeParse({ op: 'marketplaceRemove', name: '-rf' }).success).toBe(false)
    expect(PluginActionSchema.safeParse({ op: 'install', plugin: 'a@b', scope: 'global' }).success).toBe(false)
    expect(PluginActionSchema.safeParse({ op: 'nuke' }).success).toBe(false)
  })
  it('browse limit is bounded and defaulted', () => {
    expect(PluginsBrowseSchema.parse({ query: '' }).limit).toBe(30)
    expect(PluginsBrowseSchema.safeParse({ query: '', limit: 101 }).success).toBe(false)
    expect(PluginsMutateSchema.safeParse({ action: { op: 'update', plugin: 'a' } }).success).toBe(true)
  })
})
