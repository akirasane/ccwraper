import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createConfigPaths } from '../paths'
import type { CliOptions, CliResult, CliRunner } from './claude-cli'
import { McpService, maskSecrets, parseStatus } from './mcp-service'

const FIX = join(__dirname, '..', '..', '..', 'tests', 'fixtures', 'mcp')
const fixture = (n: string): string => readFileSync(join(FIX, n), 'utf8')

let dir: string
let proj: string
let cfgDir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ccwrap-mcp-'))
  proj = join(dir, 'proj')
  cfgDir = join(dir, 'cfg')
  mkdirSync(proj, { recursive: true })
  mkdirSync(cfgDir, { recursive: true })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function makeService(run: CliRunner = fakeRun([]).run, key: string = proj): McpService {
  writeFileSync(join(cfgDir, '.claude.json'), fixture('claude.json').replace('__KEY__', JSON.stringify(key).slice(1, -1)))
  writeFileSync(join(proj, '.mcp.json'), fixture('mcp.json'))
  const paths = createConfigPaths({ CLAUDE_CONFIG_DIR: cfgDir }, dir)
  return new McpService({ paths, run })
}

function fakeRun(script: Array<Partial<CliResult>>): {
  run: CliRunner
  calls: Array<{ args: string[]; opts: CliOptions }>
} {
  const calls: Array<{ args: string[]; opts: CliOptions }> = []
  let i = 0
  return {
    calls,
    run: async (args, opts) => {
      calls.push({ args, opts })
      return { code: 0, stdout: '', stderr: '', ...(script[i++] ?? {}) }
    }
  }
}

describe('list', () => {
  it('derives scopes, approvals and shadowing from files', async () => {
    const res = await makeService().list(proj)
    expect(res.error).toBeUndefined()
    const by = (n: string, s: string) => res.servers.find((x) => x.name === n && x.scope === s)
    expect(by('alpha', 'user')?.transport).toBe('stdio')
    expect(by('loc', 'local')?.transport).toBe('stdio')
    expect(by('proj-ok', 'project')?.approval).toBe('approved')
    expect(by('proj-no', 'project')?.approval).toBe('rejected')
    expect(by('proj-pending', 'project')?.approval).toBe('pending')
    expect(by('proj-pending', 'project')?.transport).toBe('sse')
    expect(by('shared', 'user')?.shadowedBy).toBe('local')
    expect(by('shared', 'project')?.shadowedBy).toBe('local')
    expect(by('shared', 'local')?.shadowedBy).toBeUndefined()
    expect(by('other', 'local')).toBeUndefined()
    expect(res.projectFile).toBe(join(proj, '.mcp.json'))
  })

  it('local overrides user in the shadow chain even without a local entry for project', async () => {
    const res = await makeService().list(proj)
    expect(res.servers.filter((s) => s.name === 'shared')).toHaveLength(3)
  })

  it('never leaks anything outside the MCP slices', async () => {
    const res = await makeService().list(proj)
    const json = JSON.stringify(res)
    expect(json).not.toContain('oauthAccount')
    expect(json).not.toContain('fixture@example.com')
    expect(json).not.toContain('fixture-user-id')
    expect(json).not.toContain('cachedGrowthBook')
    expect(json).not.toContain('enabledMcpjsonServers')
  })

  it.skipIf(process.platform !== 'win32')('matches backslash and forward-slash project keys', async () => {
    const fwd = proj.replace(/\\/g, '/')
    const bs = proj.replace(/\//g, '\\')
    for (const key of [fwd, bs, bs.toUpperCase()]) {
      const res = await makeService(undefined, key).list(proj)
      expect(res.servers.some((s) => s.name === 'loc' && s.scope === 'local')).toBe(true)
    }
    // and a cwd given with the other slash style / trailing separator
    const res = await makeService(undefined, fwd).list(bs + '\\')
    expect(res.servers.some((s) => s.name === 'loc')).toBe(true)
  })

  it('without cwd lists only user servers', async () => {
    const res = await makeService().list()
    expect(res.servers.map((s) => s.scope)).toEqual(['user', 'user'])
    expect(res.projectFile).toBeUndefined()
  })

  it('settings enableAllProjectMcpServers approves pending, disabled still wins', async () => {
    const paths = createConfigPaths({ CLAUDE_CONFIG_DIR: cfgDir }, dir)
    makeService()
    mkdirSync(join(proj, '.claude'), { recursive: true })
    writeFileSync(join(proj, '.claude', 'settings.local.json'), JSON.stringify({ enableAllProjectMcpServers: true }))
    const res = await new McpService({ paths, run: fakeRun([]).run }).list(proj)
    const ap = (n: string) => res.servers.find((s) => s.name === n && s.scope === 'project')?.approval
    expect(ap('proj-pending')).toBe('approved')
    expect(ap('proj-no')).toBe('rejected')
  })

  it('reports invalid JSON as error without throwing', async () => {
    const svc = makeService()
    writeFileSync(join(proj, '.mcp.json'), '{nope')
    const res = await svc.list(proj)
    expect(res.error).toContain('invalid JSON')
    expect(res.servers.some((s) => s.scope === 'user')).toBe(true)
  })

  it('missing files give an empty list', async () => {
    const paths = createConfigPaths({ CLAUDE_CONFIG_DIR: join(dir, 'none') }, dir)
    const res = await new McpService({ paths, run: fakeRun([]).run }).list(proj)
    expect(res).toMatchObject({ servers: [] })
    expect(res.error).toBeUndefined()
  })
})

describe('mutations', () => {
  const cfg = { type: 'stdio', command: 'node', args: ['C:\\x y\\a.js', 'say "hi"'], env: { TOKEN: 'hunter2' } }

  it('add builds an argument array with the JSON and scope', async () => {
    const f = fakeRun([{ stdout: 'Added stdio MCP server n to user config\n' }])
    const r = await makeService(f.run).add({ scope: 'user', name: 'n', config: cfg })
    expect(r).toEqual({ ok: true, output: 'Added stdio MCP server n to user config' })
    expect(f.calls[0]!.args).toEqual(['mcp', 'add-json', 'n', JSON.stringify(cfg), '-s', 'user'])
    expect(f.calls[0]!.opts.cwd).toBe(cfgDir)
  })

  it('project/local scope run in the project dir and need a cwd', async () => {
    const f = fakeRun([{}])
    const svc = makeService(f.run)
    expect((await svc.add({ scope: 'local', name: 'n', config: cfg })).ok).toBe(false)
    expect(f.calls).toHaveLength(0)
    await svc.add({ scope: 'project', cwd: proj, name: 'n', config: cfg })
    expect(f.calls[0]!.opts.cwd).toBe(proj)
  })

  it('duplicate add passes the CLI message through', async () => {
    const f = fakeRun([{ code: 1, stderr: 'MCP server n already exists in user config' }])
    const r = await makeService(f.run).add({ scope: 'user', name: 'n', config: cfg })
    expect(r).toMatchObject({ ok: false, message: 'MCP server n already exists in user config' })
  })

  it('masks env/header secrets echoed by the CLI', async () => {
    const f = fakeRun([{ code: 1, stderr: 'Invalid configuration: bad value hunter2' }])
    const r = await makeService(f.run).add({ scope: 'user', name: 'n', config: cfg })
    expect(JSON.stringify(r)).not.toContain('hunter2')
    expect(JSON.stringify(r)).toContain('***')
  })

  it('rejects names that look like options', async () => {
    const f = fakeRun([])
    const r = await makeService(f.run).remove({ scope: 'user', name: '--help' })
    expect(r.ok).toBe(false)
    expect(f.calls).toHaveLength(0)
  })

  it('remove uses -s scope', async () => {
    const f = fakeRun([{ stdout: 'Removed' }])
    const r = await makeService(f.run).remove({ scope: 'project', cwd: proj, name: 'proj-ok' })
    expect(r.ok).toBe(true)
    expect(f.calls[0]!.args).toEqual(['mcp', 'remove', 'proj-ok', '-s', 'project'])
  })

  it('remove failure carries the CLI message', async () => {
    const f = fakeRun([{ code: 1, stderr: 'No MCP server named "zz" in user scope' }])
    const r = await makeService(f.run).remove({ scope: 'user', name: 'zz' })
    expect(r).toMatchObject({ ok: false, message: 'No MCP server named "zz" in user scope' })
  })

  it('update = remove then add-json with the new config', async () => {
    const f = fakeRun([{ stdout: 'Removed' }, { stdout: 'Added' }])
    const r = await makeService(f.run).update({ scope: 'user', name: 'alpha', newName: 'beta', config: cfg })
    expect(r.ok).toBe(true)
    expect(f.calls.map((c) => c.args.slice(0, 3))).toEqual([
      ['mcp', 'remove', 'alpha'],
      ['mcp', 'add-json', 'beta']
    ])
  })

  it('update rolls back the old config when add-json fails', async () => {
    const f = fakeRun([{}, { code: 1, stderr: 'Invalid configuration: x' }, { stdout: 'Added back' }])
    const r = await makeService(f.run).update({ scope: 'user', name: 'alpha', config: cfg })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.message).toContain('Invalid configuration')
      expect(r.message).toContain('restored')
    }
    expect(f.calls).toHaveLength(3)
    const old = JSON.parse(f.calls[2]!.args[3]!)
    expect(old).toEqual({ type: 'stdio', command: 'node', args: ['a.js'], env: { TOKEN: 'user-secret-1' } })
    expect(f.calls[2]!.args.slice(0, 3)).toEqual(['mcp', 'add-json', 'alpha'])
  })

  it('update reports a failed rollback and masks secrets', async () => {
    const f = fakeRun([{}, { code: 1, stderr: 'boom' }, { code: 1, stderr: 'rollback boom user-secret-1' }])
    const r = await makeService(f.run).update({ scope: 'user', name: 'alpha', config: cfg })
    expect(r).toMatchObject({ ok: false })
    expect(JSON.stringify(r)).toContain('Rollback FAILED')
    expect(JSON.stringify(r)).not.toContain('user-secret-1')
  })

  it('update stops if remove fails, and refuses missing / colliding names without spawning', async () => {
    const f = fakeRun([{ code: 1, stderr: 'cannot remove' }])
    const svc = makeService(f.run)
    expect(await svc.update({ scope: 'user', name: 'alpha', config: cfg })).toMatchObject({ ok: false, message: 'cannot remove' })
    expect(f.calls).toHaveLength(1)
    expect((await svc.update({ scope: 'user', name: 'nope', config: cfg })).ok).toBe(false)
    expect((await svc.update({ scope: 'user', name: 'alpha', newName: 'shared', config: cfg })).ok).toBe(false)
    expect(f.calls).toHaveLength(1)
  })

  it('serializes concurrent mutations', async () => {
    const order: string[] = []
    const run: CliRunner = async (args) => {
      order.push(`start ${args[2]}`)
      await new Promise((r) => setTimeout(r, 10))
      order.push(`end ${args[2]}`)
      return { code: 0, stdout: '', stderr: '' }
    }
    const svc = makeService(run)
    await Promise.all([svc.remove({ scope: 'user', name: 'a' }), svc.remove({ scope: 'user', name: 'b' })])
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b'])
  })
})

describe('test / get parsing', () => {
  it.each([
    ['Status: \u2713 Connected', 'connected'],
    ['Status: \u2718 Failed to connect', 'failed'],
    ['Status: \u23f8 Pending approval', 'pending'],
    ['Status: Needs authentication', 'needs_auth'],
    ['no status here', 'unknown']
  ])('%s -> %s', (line, status) => {
    expect(parseStatus(`n:\n  Scope: User config\n  ${line}\n  Type: stdio\n`).status).toBe(status)
  })

  it('exit 0 with failed connection is a failed status, not an error', async () => {
    const f = fakeRun([{ stdout: 'n:\n  Status: \u2718 Failed to connect\n  Issue: spawn ENOENT\n' }])
    const r = await makeService(f.run).test({ cwd: proj, name: 'n' })
    expect(r).toMatchObject({ name: 'n', status: 'failed', detail: 'spawn ENOENT' })
    expect(r.output).toContain('Failed to connect')
    expect(f.calls[0]!.args).toEqual(['mcp', 'get', 'n'])
    expect(f.calls[0]!.opts.timeoutMs).toBe(45_000)
  })

  it('missing server (exit 1) is unknown with the message', async () => {
    const f = fakeRun([{ code: 1, stderr: 'No MCP server found with name: zz' }])
    const r = await makeService(f.run).test({ name: 'zz' })
    expect(r.status).toBe('unknown')
    expect(r.detail).toContain('No MCP server found')
  })
})

describe('maskSecrets', () => {
  it('masks env and header values', () => {
    const c = { env: { A: 'sekret-a' }, headers: { Authorization: 'Bearer tok123' } }
    expect(maskSecrets('x sekret-a y Bearer tok123', c)).toBe('x *** y ***')
    expect(maskSecrets('plain')).toBe('plain')
  })
})
