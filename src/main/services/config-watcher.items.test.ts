import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FsChangedPayload } from '../../shared/config'
import { createConfigPaths } from '../paths'
import { ConfigService } from './config-service'
import { ConfigWatcher } from './config-watcher'
import type { WatcherFactoryOptions, WatcherLike } from './config-watcher'
import { ItemsService } from './items-service'
import { PluginRegistry } from './plugin-registry'
import { Trash } from './trash'

vi.mock('../../shared/frontmatter', async () => import('../../../tests/fixtures/items/fake-frontmatter'))

class FakeWatcher implements WatcherLike {
  watched = new Set<string>()
  handlers = new Map<string, Array<(p: string) => void>>()
  add(p: string | string[]): void {
    for (const x of Array.isArray(p) ? p : [p]) this.watched.add(x)
  }
  unwatch(p: string | string[]): void {
    for (const x of Array.isArray(p) ? p : [p]) this.watched.delete(x)
  }
  on(ev: string, cb: (p: string) => void): void {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), cb])
  }
  async close(): Promise<void> {}
  fire(ev: string, p: string): void {
    for (const h of this.handlers.get(ev) ?? []) h(p)
  }
}

async function until(cond: () => boolean, ms = 4000): Promise<void> {
  const t0 = Date.now()
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition')
    await new Promise((r) => setTimeout(r, 15))
  }
}
const quiet = (ms = 250): Promise<void> => new Promise((r) => setTimeout(r, ms))
const md = (n: string) => `---\nname: ${n}\n---\nbody\n`

let root: string
let home: string
let proj: string
let events: FsChangedPayload[]
const paths = () => createConfigPaths({ CLAUDE_CONFIG_DIR: join(home, '.claude') }, home)
const items = (kind: string) => events.filter((e) => e.kind === kind)

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccwrap-witems-'))
  home = join(root, 'home')
  proj = join(root, 'proj')
  await mkdir(join(home, '.claude'), { recursive: true })
  await mkdir(proj, { recursive: true })
  events = []
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('item dir watching (fake chokidar)', () => {
  async function make() {
    const fake = new FakeWatcher()
    let opts: WatcherFactoryOptions | undefined
    const svc = new ConfigService(paths(), join(root, 'backups'))
    const w = new ConfigWatcher(paths(), svc, (p) => events.push(p), {
      factory: async (o) => {
        opts = o
        return fake
      },
      debounceMs: 10
    })
    await w.start()
    return { w, fake, svc, ignored: (p: string) => opts!.ignored!(p) }
  }

  it('keeps the watches shallow: skills 2 segments, commands 3, agents 1, no node_modules', async () => {
    const { w, ignored } = await make()
    await w.setProject(proj)
    const u = join(home, '.claude')
    expect(ignored(join(u, 'skills'))).toBe(false)
    expect(ignored(join(u, 'skills', 'a'))).toBe(false)
    expect(ignored(join(u, 'skills', 'a', 'SKILL.md'))).toBe(false)
    expect(ignored(join(u, 'skills', 'a', 'refs', 'x.md'))).toBe(true)
    expect(ignored(join(u, 'skills', 'a', 'node_modules'))).toBe(true)
    expect(ignored(join(u, 'commands', 'a', 'b', 'c.md'))).toBe(false)
    expect(ignored(join(u, 'commands', 'a', 'b', 'c', 'd.md'))).toBe(true)
    expect(ignored(join(u, 'agents', 'x.md'))).toBe(false)
    expect(ignored(join(u, 'agents', 'sub', 'x.md'))).toBe(true)
    // unrelated siblings of the config dir are skipped, registered files are not
    expect(ignored(join(u, 'projects'))).toBe(true)
    expect(ignored(join(u, 'settings.json'))).toBe(false)
    // project: only `.claude` below the project dir, then only the item roots
    expect(ignored(join(proj, 'src'))).toBe(true)
    expect(ignored(join(proj, '.claude'))).toBe(false)
    expect(ignored(join(proj, '.claude', 'agents', 'r.md'))).toBe(false)
    expect(ignored(join(proj, '.claude', 'other'))).toBe(true)
    expect(ignored(join(proj, 'CLAUDE.md'))).toBe(false)
    await w.close()
  })

  it('a skill dir plus SKILL.md is one skill event; commands and agents carry scope and cwd', async () => {
    const { w, fake } = await make()
    await w.setProject(proj)
    const sd = join(home, '.claude', 'skills', 'new-one')
    await mkdir(sd, { recursive: true })
    await writeFile(join(sd, 'SKILL.md'), md('new-one'))
    fake.fire('addDir', sd)
    fake.fire('add', join(sd, 'SKILL.md'))
    await until(() => items('skill').length === 1)
    await quiet()
    expect(items('skill')).toEqual([{ kind: 'skill', scope: 'user', path: join(sd, 'SKILL.md') }])

    const ag = join(proj, '.claude', 'agents', 'rev.md')
    await mkdir(join(ag, '..'), { recursive: true })
    await writeFile(ag, md('rev'))
    fake.fire('add', ag)
    await until(() => items('agent').length === 1)
    expect(items('agent')[0]).toEqual({ kind: 'agent', scope: 'project', cwd: proj, path: ag })
    await w.close()
  })

  it('ignores events deeper than the kind allows', async () => {
    const { w, fake } = await make()
    fake.fire('add', join(home, '.claude', 'agents', 'sub', 'deep.md'))
    fake.fire('add', join(home, '.claude', 'skills', 'a', 'node_modules', 'x.md'))
    await quiet()
    expect(events).toEqual([])
    await w.close()
  })

  it('our own item mutations raise no fs:changed (rename, create, delete)', async () => {
    const { w, fake, svc } = await make()
    const reg = new PluginRegistry()
    const items_ = new ItemsService(paths(), reg, svc, new Trash(join(root, 'userData', 'trash')))
    const u = join(home, '.claude')

    const created = await items_.create({ kind: 'skill', scope: 'user', name: 'alpha', text: md('alpha') })
    expect(created.ok).toBe(true)
    fake.fire('addDir', join(u, 'skills', 'alpha'))
    fake.fire('add', join(u, 'skills', 'alpha', 'SKILL.md'))

    const snap = await svc.read({ kind: 'skill', scope: 'user', name: 'alpha' })
    const renamed = await items_.rename({
      ref: { kind: 'skill', scope: 'user', name: 'alpha' },
      newName: 'beta',
      baseHash: snap.hash!,
      text: md('beta')
    })
    expect(renamed.ok).toBe(true)
    fake.fire('unlink', join(u, 'skills', 'alpha', 'SKILL.md'))
    fake.fire('unlinkDir', join(u, 'skills', 'alpha'))
    fake.fire('addDir', join(u, 'skills', 'beta'))
    fake.fire('add', join(u, 'skills', 'beta', 'SKILL.md'))

    const snap2 = await svc.read({ kind: 'skill', scope: 'user', name: 'beta' })
    const deleted = await items_.delete({ ref: { kind: 'skill', scope: 'user', name: 'beta' }, baseHash: snap2.hash! })
    expect(deleted.ok).toBe(true)
    fake.fire('unlink', join(u, 'skills', 'beta', 'SKILL.md'))
    fake.fire('unlinkDir', join(u, 'skills', 'beta'))

    await quiet(300)
    expect(items('skill')).toEqual([])

    // a genuine external change afterwards is still reported
    const ext = join(u, 'agents', 'ext.md')
    await mkdir(join(ext, '..'), { recursive: true })
    await writeFile(ext, md('ext'))
    fake.fire('add', ext)
    await until(() => items('agent').length === 1)
    await w.close()
  })
})

describe('item dir watching (real chokidar)', () => {
  it('reports a new skill once, and a project .claude/agents created later', async () => {
    const svc = new ConfigService(paths(), join(root, 'backups'))
    const w = new ConfigWatcher(paths(), svc, (p) => events.push(p), { debounceMs: 60 })
    try {
      await w.start()
      await w.setProject(proj)
      await quiet(400) // let chokidar finish its initial scan

      const sd = join(home, '.claude', 'skills', 'live')
      await mkdir(sd, { recursive: true })
      await writeFile(join(sd, 'SKILL.md'), md('live'))
      await until(() => items('skill').length >= 1, 8000)
      await quiet(500)
      expect(items('skill')).toEqual([{ kind: 'skill', scope: 'user', path: join(sd, 'SKILL.md') }])

      // project `.claude` did not exist; create it and an agents dir afterwards
      const agents = join(proj, '.claude', 'agents')
      await mkdir(agents, { recursive: true })
      await quiet(400)
      await writeFile(join(agents, 'late.md'), md('late'))
      await until(() => items('agent').some((e) => e.scope === 'project'), 8000)
      expect(items('agent').find((e) => e.scope === 'project')).toMatchObject({ cwd: proj, path: join(agents, 'late.md') })
    } finally {
      await w.close()
    }
  }, 30000)
})
