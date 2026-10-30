import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FsChangedPayload } from '../../shared/config'
import { createConfigPaths } from '../paths'
import { ConfigService } from './config-service'
import { ConfigWatcher, mcpSliceOf } from './config-watcher'
import type { WatcherLike } from './config-watcher'

const FX = join(__dirname, '../../../tests/fixtures/config')

class FakeWatcher implements WatcherLike {
  watched = new Set<string>()
  handlers = new Map<string, Array<(p: string) => void>>()
  closed = false
  add(p: string | string[]): void {
    for (const x of Array.isArray(p) ? p : [p]) this.watched.add(x)
  }
  unwatch(p: string | string[]): void {
    for (const x of Array.isArray(p) ? p : [p]) this.watched.delete(x)
  }
  on(ev: string, cb: (p: string) => void): void {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), cb])
  }
  async close(): Promise<void> {
    this.closed = true
  }
  fire(ev: 'add' | 'change' | 'unlink', p: string): void {
    for (const h of this.handlers.get(ev) ?? []) h(p)
  }
}

async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition')
    await new Promise((r) => setTimeout(r, 10))
  }
}
const settle = (ms = 80): Promise<void> => new Promise((r) => setTimeout(r, ms))

let root: string
let home: string
let proj: string
let svc: ConfigService
let events: FsChangedPayload[]
const paths = (): ReturnType<typeof createConfigPaths> => createConfigPaths({ CLAUDE_CONFIG_DIR: join(home, '.claude') }, home)

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccwrap-watch-'))
  home = join(root, 'home')
  proj = join(root, 'proj')
  await mkdir(join(home, '.claude'), { recursive: true })
  await mkdir(join(proj, '.claude'), { recursive: true })
  svc = new ConfigService(paths(), join(root, 'backups'))
  events = []
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('mcpSliceOf', () => {
  const text = (): string => readFileSync(join(FX, 'dot-claude-json.json'), 'utf8')

  it('matches the project key with either slash form and ignores unrelated churn', () => {
    const base = mcpSliceOf(text(), 'C:\\fixture\\proj')
    const churn = JSON.parse(text()) as Record<string, any>
    churn.numStartups = 99
    churn.userID = 'x'
    churn.projects['C:/fixture/proj'].lastCost = 12
    churn.projects['C:/fixture/other'].mcpServers['other-srv'].command = 'changed'
    expect(mcpSliceOf(JSON.stringify(churn), 'C:/fixture/proj')).toBe(base)
  })

  it('changes when the mcp slice changes', () => {
    const base = mcpSliceOf(text(), 'C:/fixture/proj')
    const a = JSON.parse(text()) as Record<string, any>
    a.mcpServers['new'] = { command: 'x' }
    expect(mcpSliceOf(JSON.stringify(a), 'C:/fixture/proj')).not.toBe(base)
    const b = JSON.parse(text()) as Record<string, any>
    b.projects['C:/fixture/proj'].enabledMcpjsonServers = []
    expect(mcpSliceOf(JSON.stringify(b), 'C:/fixture/proj')).not.toBe(base)
    const c = JSON.parse(text()) as Record<string, any>
    c.projects['C:/fixture/proj'].mcpServers['x'] = { command: 'y' }
    expect(mcpSliceOf(JSON.stringify(c), 'C:/fixture/proj')).not.toBe(base)
  })

  it('does not include the other project servers', () => {
    expect(mcpSliceOf(text(), 'C:/fixture/proj')).not.toContain('other-srv')
  })
})

describe('ConfigWatcher (fake chokidar)', () => {
  async function make(): Promise<{ w: ConfigWatcher; fake: FakeWatcher }> {
    const fake = new FakeWatcher()
    const w = new ConfigWatcher(paths(), svc, (p) => events.push(p), {
      factory: async () => fake,
      debounceMs: 10,
      globalDebounceMs: 30
    })
    await w.start()
    return { w, fake }
  }

  it('watches the fixed set, then the project set, and swaps on project change', async () => {
    const { w, fake } = await make()
    const p = paths()
    expect([...fake.watched].sort()).toEqual([p.settingsFile('user'), p.memoryFile('user'), p.globalConfigPath].sort())
    await w.setProject(proj)
    expect(fake.watched.size).toBe(3 + 6)
    for (const f of [
      join(proj, '.claude', 'settings.json'),
      join(proj, '.claude', 'settings.local.json'),
      join(proj, '.mcp.json'),
      join(proj, 'CLAUDE.md'),
      join(proj, '.claude', 'CLAUDE.md'),
      join(proj, 'CLAUDE.local.md')
    ])
      expect(fake.watched.has(f)).toBe(true)
    await w.setProject(null)
    expect(fake.watched.size).toBe(3)
    await w.close()
    expect(fake.closed).toBe(true)
  })

  it('emits fs:changed for an external settings edit with scope and cwd', async () => {
    const { w, fake } = await make()
    await w.setProject(proj)
    const f = join(proj, '.claude', 'settings.local.json')
    await writeFile(f, '{"a":1}')
    fake.fire('add', f)
    await until(() => events.length === 1)
    expect(events[0]).toEqual({ kind: 'settings', scope: 'local', cwd: proj, path: f })
    await w.close()
  })

  it('coalesces bursts into one event (debounce)', async () => {
    const { w, fake } = await make()
    const f = paths().settingsFile('user')
    await writeFile(f, '{"a":1}')
    for (let i = 0; i < 5; i++) fake.fire('change', f)
    await until(() => events.length >= 1)
    await settle()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'settings', scope: 'user' })
    await w.close()
  })

  it('reports memory scopes and .mcp.json as kind mcp / scope project', async () => {
    const { w, fake } = await make()
    await w.setProject(proj)
    await writeFile(join(proj, 'CLAUDE.local.md'), 'x')
    await writeFile(join(proj, '.mcp.json'), '{"mcpServers":{}}')
    fake.fire('add', join(proj, 'CLAUDE.local.md'))
    fake.fire('add', join(proj, '.mcp.json'))
    await until(() => events.length === 2)
    expect(events).toContainEqual({ kind: 'memory', scope: 'local', cwd: proj, path: join(proj, 'CLAUDE.local.md') })
    expect(events).toContainEqual({ kind: 'mcp', scope: 'project', cwd: proj, path: join(proj, '.mcp.json') })
    await w.close()
  })

  it('reports deletion (unlink)', async () => {
    const f = paths().memoryFile('user')
    await writeFile(f, 'hello')
    const { w, fake } = await make()
    await rm(f)
    fake.fire('unlink', f)
    await until(() => events.length === 1)
    expect(events[0]).toMatchObject({ kind: 'memory', scope: 'user' })
    await w.close()
  })

  it('drops our own writes but reports a later external edit of the same file', async () => {
    const { w, fake } = await make()
    await w.setProject(proj)
    const ref = { kind: 'settings', scope: 'project', cwd: proj } as const
    const r = await svc.write(ref, '{"mine":true}', null)
    expect(r.ok).toBe(true)
    const f = join(proj, '.claude', 'settings.json')
    fake.fire('add', f)
    await settle(120)
    expect(events).toHaveLength(0)

    await writeFile(f, '{"external":true}')
    fake.fire('change', f)
    await until(() => events.length === 1)

    // external edit that reverts to exactly our earlier bytes must still be reported
    await writeFile(f, '{"mine":true}')
    fake.fire('change', f)
    await until(() => events.length === 2)
    await w.close()
  })

  it('does not emit when the file hash is unchanged', async () => {
    const f = paths().settingsFile('user')
    await writeFile(f, '{"a":1}')
    const { w, fake } = await make()
    fake.fire('change', f)
    await until(() => events.length === 1)
    fake.fire('change', f) // touched, same content
    await settle(120)
    expect(events).toHaveLength(1)
    await w.close()
  })

  describe('global .claude.json', () => {
    it('emits nothing for churn outside the MCP slice, one event when the slice changes', async () => {
      const g = paths().globalConfigPath
      const orig = await readFile(join(FX, 'dot-claude-json.json'), 'utf8')
      await writeFile(g, orig)
      const { w, fake } = await make()
      await w.setProject('C:\\fixture\\proj')

      const churn = JSON.parse(orig) as Record<string, any>
      churn.numStartups = 2
      churn.projects['C:/fixture/proj'].lastCost = 9
      await writeFile(g, JSON.stringify(churn))
      fake.fire('change', g)
      await settle(150)
      expect(events).toHaveLength(0)

      churn.projects['C:/fixture/proj'].mcpServers['added'] = { command: 'x' }
      await writeFile(g, JSON.stringify(churn))
      fake.fire('change', g)
      await until(() => events.length === 1)
      expect(events[0]).toEqual({ kind: 'mcp', cwd: 'C:\\fixture\\proj', path: g })

      // another churn after the slice change: still quiet
      churn.numStartups = 3
      await writeFile(g, JSON.stringify(churn))
      fake.fire('change', g)
      await settle(150)
      expect(events).toHaveLength(1)
      await w.close()
    })

    it('ignores a half-written (unparsable) .claude.json', async () => {
      const g = paths().globalConfigPath
      await writeFile(g, await readFile(join(FX, 'dot-claude-json.json'), 'utf8'))
      const { w, fake } = await make()
      await writeFile(g, '{"mcpServers": {')
      fake.fire('change', g)
      await settle(120)
      expect(events).toHaveLength(0)
      await w.close()
    })

    it('ignores events for paths it does not watch', async () => {
      const { w, fake } = await make()
      fake.fire('change', join(root, 'random.txt'))
      await settle(60)
      expect(events).toHaveLength(0)
      await w.close()
    })
  })
})

describe('ConfigWatcher (real chokidar, temp dir)', () => {
  it('sees create, modify and an atomic rename-over write', async () => {
    const w = new ConfigWatcher(paths(), svc, (p) => events.push(p), { debounceMs: 40, globalDebounceMs: 40 })
    await w.start()
    await w.setProject(proj)
    await settle(300) // let chokidar finish its initial scan
    const f = join(proj, '.claude', 'settings.json')

    await writeFile(f, '{"a":1}') // create
    await until(() => events.length >= 1, 5000)
    expect(events[0]).toMatchObject({ kind: 'settings', scope: 'project', cwd: proj })

    const n = events.length
    await writeFile(f, '{"a":2}') // modify
    await until(() => events.length > n, 5000)

    const m = events.length
    await writeFile(f + '.x.tmp', '{"a":3}') // atomic: temp + rename over
    await rename(f + '.x.tmp', f)
    await until(() => events.length > m, 5000)
    expect(await readFile(f, 'utf8')).toBe('{"a":3}')

    // and our own atomic write through ConfigService stays silent
    const cur = await svc.read({ kind: 'settings', scope: 'project', cwd: proj })
    const k = events.length
    await svc.write({ kind: 'settings', scope: 'project', cwd: proj }, '{"a":4}', cur.hash)
    await settle(500)
    expect(events.length).toBe(k)
    await w.close()
  }, 20000)
})
