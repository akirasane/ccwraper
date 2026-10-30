import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createConfigPaths } from '../paths'
import { resolveCliBinary, runClaude } from './claude-cli'
import { McpService } from './mcp-service'

describe('resolveCliBinary', () => {
  it('returns a string or undefined without throwing', () => {
    const p = resolveCliBinary()
    expect(p === undefined || typeof p === 'string').toBe(true)
  })
})

// Opt-in: runs the real claude binary, fully redirected to a scratch dir. Never touches the real config.
const IT = process.env['CCWRAP_CLI_IT'] === '1'
describe.skipIf(!IT)('claude mcp integration (CCWRAP_CLI_IT=1)', () => {
  const scratchRoot = process.env['CCWRAP_IT_DIR'] ?? tmpdir()
  mkdirSync(scratchRoot, { recursive: true })
  const root = mkdtempSync(join(scratchRoot, 'ccwrap-mcp-it-'))
  const home = join(root, 'home')
  const cfg = join(home, '.claude')
  const proj = join(root, 'proj dir')
  mkdirSync(cfg, { recursive: true })
  mkdirSync(proj, { recursive: true })
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: cfg }
  const paths = createConfigPaths(env, home)
  const svc = new McpService({ paths, env, run: runClaude })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  const tricky = {
    type: 'stdio',
    command: 'node',
    args: ['C:\\Program Files\\x y\\server.js', 'say "hi" there', "it's"],
    env: { TOKEN: 'abc def' }
  }

  it('is redirected away from the real home', () => {
    const real = process.env['CCWRAP_TEST_REAL_HOME']
    expect(cfg.startsWith(root)).toBe(true)
    expect(paths.globalConfigPath.startsWith(root)).toBe(true)
    if (real) expect(cfg.toLowerCase().startsWith(real.toLowerCase())).toBe(false)
    expect(resolveCliBinary()).toBeTruthy()
  })

  it('add / list / update / remove across all three scopes', { timeout: 120_000 }, async () => {
    for (const scope of ['user', 'project', 'local'] as const) {
      const name = `it-${scope}`
      const add = await svc.add({ scope, cwd: proj, name, config: tricky })
      expect(add, JSON.stringify(add)).toMatchObject({ ok: true })
      const dup = await svc.add({ scope, cwd: proj, name, config: tricky })
      expect(dup.ok).toBe(false)
    }
    let list = await svc.list(proj)
    expect(list.error).toBeUndefined()
    for (const scope of ['user', 'project', 'local']) {
      const e = list.servers.find((s) => s.name === `it-${scope}` && s.scope === scope)
      expect(e?.config).toMatchObject({ command: 'node', args: tricky.args, env: tricky.env })
    }
    expect(existsSync(join(proj, '.mcp.json'))).toBe(true)

    const upd = await svc.update({ scope: 'user', name: 'it-user', newName: 'it-user2', config: { type: 'stdio', command: 'node', args: ['a b'] } })
    expect(upd, JSON.stringify(upd)).toMatchObject({ ok: true })
    list = await svc.list(proj)
    expect(list.servers.some((s) => s.name === 'it-user2' && s.scope === 'user')).toBe(true)
    expect(list.servers.some((s) => s.name === 'it-user')).toBe(false)

    for (const [scope, name] of [['user', 'it-user2'], ['project', 'it-project'], ['local', 'it-local']] as const) {
      expect(await svc.remove({ scope, cwd: proj, name }), name).toMatchObject({ ok: true })
    }
    expect((await svc.list(proj)).servers).toEqual([])
    expect((await svc.remove({ scope: 'user', name: 'it-user2' })).ok).toBe(false)
    // sanity: the redirected file exists, written by the CLI
    expect(readFileSync(paths.globalConfigPath, 'utf8')).toContain('mcpServers')
    writeFileSync(join(root, 'done'), '')
  })

  it('get on a server that cannot start exits 0 with failed status', { timeout: 120_000 }, async () => {
    await svc.add({ scope: 'user', name: 'it-broken', config: { type: 'stdio', command: 'ccwrap-no-such-binary' } })
    const r = await svc.test({ name: 'it-broken' })
    expect(r.status).toBe('failed')
    expect((await svc.test({ name: 'it-missing' })).status).toBe('unknown')
  })
})
