import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConfigFileRef } from '../../shared/config'
import { ItemsCreateSchema, ItemsDeleteSchema, ItemsRenameSchema } from '../../shared/ipc'
import { createConfigPaths, itemFilePath, trashDir } from '../paths'
import { ConfigService, sha256 } from './config-service'
import { ItemsService, validateNewName } from './items-service'
import { PluginRegistry } from './plugin-registry'
import { Trash, TRASH_MANIFEST } from './trash'
import type { TrashFs } from './trash'
import { nodeTrashFs } from './trash'


let root: string
let home: string
let proj: string
let pluginDir: string
let userData: string
let registry: PluginRegistry
let config: ConfigService
let svc: ItemsService

const exists = (p: string) => stat(p).then(() => true, () => false)
const md = (name: string, desc = 'does things') => `---\nname: ${name}\ndescription: ${desc}\n---\nbody of ${name}\n`
const cfgDir = () => join(home, '.claude')

async function put(file: string, text: string) {
  await mkdir(join(file, '..'), { recursive: true })
  await writeFile(file, text)
}

function make(trashFs?: TrashFs) {
  const paths = createConfigPaths({ CLAUDE_CONFIG_DIR: cfgDir() }, home)
  config = new ConfigService(paths, join(userData, 'backups'), { registry })
  const trash = new Trash(trashDir(userData), trashFs ? { fs: trashFs } : {})
  svc = new ItemsService(paths, registry, config, trash, { sleep: async () => undefined })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccwrap-items-'))
  home = join(root, 'home')
  proj = join(root, 'proj')
  pluginDir = join(root, 'plug', 'acme')
  userData = join(root, 'userData')
  await mkdir(home, { recursive: true })
  await mkdir(proj, { recursive: true })
  registry = new PluginRegistry()
  make()
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('guards', () => {
  it('trash dir and every root live under the temp root', () => {
    expect(trashDir(userData).startsWith(root)).toBe(true)
    expect(cfgDir().startsWith(root)).toBe(true)
  })
})

describe('list', () => {
  it('finds user, project and plugin items for each kind', async () => {
    await put(join(cfgDir(), 'skills', 'alpha', 'SKILL.md'), md('alpha', 'user skill'))
    await put(join(cfgDir(), 'skills', 'alpha', 'refs', 'notes.txt'), 'n')
    await put(join(proj, '.claude', 'skills', 'beta', 'SKILL.md'), md('beta'))
    await put(join(pluginDir, 'skills', 'gamma', 'SKILL.md'), md('gamma'))
    await put(join(cfgDir(), 'commands', 'deploy.md'), md('deploy'))
    await put(join(cfgDir(), 'commands', 'ci', 'build.md'), md('build'))
    await put(join(cfgDir(), 'commands', 'a', 'b', 'c.md'), md('c'))
    await put(join(cfgDir(), 'commands', 'a', 'b', 'c', 'too-deep.md'), md('x'))
    await put(join(proj, '.claude', 'agents', 'rev.md'), md('rev'))
    await put(join(proj, '.claude', 'agents', 'nested', 'no.md'), md('no'))
    await put(join(pluginDir, 'agents', 'pa.md'), md('pa'))
    await put(join(pluginDir, 'commands', 'pc.md'), md('pc'))
    registry.update([{ name: 'acme', path: pluginDir, version: '1.2.0' }])

    const skills = await svc.list('skill', proj)
    expect(skills.pluginsKnown).toBe(true)
    expect(skills.roots.map((r) => [r.scope, r.exists])).toEqual([
      ['user', true],
      ['project', true]
    ])
    expect(skills.items.map((i) => `${i.scope}:${i.name}`)).toEqual(['user:alpha', 'project:beta', 'plugin:gamma'])
    const alpha = skills.items[0]!
    expect(alpha).toMatchObject({ description: 'user skill', frontmatterName: 'alpha', readOnly: false, files: ['refs/notes.txt'] })
    expect(alpha.ref).toEqual({ kind: 'skill', scope: 'user', name: 'alpha' })
    expect(skills.items[1]!.ref).toEqual({ kind: 'skill', scope: 'project', cwd: proj, name: 'beta' })
    expect(skills.items[2]).toMatchObject({ readOnly: true, plugin: 'acme', pluginVersion: '1.2.0', ref: { kind: 'skill', scope: 'plugin', plugin: 'acme', name: 'gamma' } })

    const cmds = await svc.list('command', proj)
    expect(cmds.items.map((i) => i.name)).toEqual(['a/b/c', 'ci/build', 'deploy', 'pc'])
    const agents = await svc.list('agent', proj)
    expect(agents.items.map((i) => `${i.scope}:${i.name}`)).toEqual(['plugin:pa', 'project:rev'])
  })

  it('reports pluginsKnown:false before any init and missing roots as not existing', async () => {
    const l = await svc.list('agent')
    expect(l).toMatchObject({ items: [], pluginsKnown: false, roots: [{ scope: 'user', exists: false }] })
  })

  it('an unquoted ": " description is a warning, not an error (lenient)', async () => {
    await put(join(cfgDir(), 'agents', 'lenient.md'), '---\nname: lenient\ndescription: Use this agent: when x\n---\nbody')
    const l = await svc.list('agent')
    const it = l.items.find((i) => i.name === 'lenient')!
    expect(it.error).toBeUndefined()
    expect(it.warning).toMatch(/Non-strict YAML/)
    expect(it.description).toBe('Use this agent: when x')
  })

  it('flags broken frontmatter and oversized files without failing the list', async () => {
    await put(join(cfgDir(), 'agents', 'bad.md'), '---\n!!broken\n---\nx')
    await put(join(cfgDir(), 'agents', 'huge.md'), 'x'.repeat(1024 * 1024 + 1))
    const l = await svc.list('agent')
    const bad = l.items.find((i) => i.name === 'bad')!
    const huge = l.items.find((i) => i.name === 'huge')!
    expect(bad.error).toBeTruthy()
    expect(huge.error).toMatch(/larger than 1 MB/)
  })

  it('skips symlinked entries and dirs without SKILL.md', async () => {
    await put(join(root, 'outside', 'SKILL.md'), md('evil'))
    await mkdir(join(cfgDir(), 'skills', 'empty'), { recursive: true })
    await put(join(cfgDir(), 'skills', 'real', 'SKILL.md'), md('real'))
    try {
      await symlink(join(root, 'outside'), join(cfgDir(), 'skills', 'linked'), 'junction')
    } catch {
      /* no link support: the assertion below still holds */
    }
    const l = await svc.list('skill')
    expect(l.items.map((i) => i.name)).toEqual(['real'])
  })
})

describe('traversal', () => {
  it('rejects bad names in the IPC schemas', () => {
    for (const name of ['..\\x', 'a/../../b', 'C:\\evil', '/abs', '../x', 'a//b', '.hidden', 'UPPER', 'a b']) {
      expect(ItemsCreateSchema.safeParse({ kind: 'skill', scope: 'user', name, text: '' }).success, name).toBe(false)
      expect(ItemsCreateSchema.safeParse({ kind: 'command', scope: 'user', name, text: '' }).success, name).toBe(false)
    }
    const ref = { kind: 'agent', scope: 'user', name: '..\\x' }
    expect(ItemsDeleteSchema.safeParse({ ref, baseHash: 'h' }).success).toBe(false)
    expect(ItemsRenameSchema.safeParse({ ref: { kind: 'agent', scope: 'user', name: 'ok' }, newName: '../x', baseHash: 'h' }).success).toBe(false)
  })

  it('itemFilePath rejects escapes for every kind', () => {
    for (const kind of ['skill', 'command', 'agent'] as const) {
      for (const name of ['..\\x', 'a/../../b', 'C:\\evil', '/abs', '..']) {
        expect(() => itemFilePath(kind, join(root, 'r'), name), `${kind} ${name}`).toThrow()
      }
    }
  })

  it('the service rejects them too when called directly', async () => {
    for (const name of ['..\\x', 'a/../../b', 'C:\\evil', '/abs']) {
      expect(await svc.create({ kind: 'command', scope: 'user', name, text: md('x') })).toMatchObject({ ok: false, code: 'bad_name' })
    }
    const res = await svc.delete({ ref: { kind: 'command', scope: 'user', name: '../../x' }, baseHash: 'h' })
    expect(res).toMatchObject({ ok: false, code: 'bad_ref' })
    expect(await exists(join(root, 'x.md'))).toBe(false)
  })

  it('validateNewName: strict rule and segment counts', () => {
    expect(validateNewName('command', 'a/b/c')).toBeUndefined()
    expect(validateNewName('command', 'a/b/c/d')).toBeDefined()
    expect(validateNewName('skill', 'a/b')).toBeDefined()
    expect(validateNewName('agent', 'my-agent')).toBeUndefined()
    expect(validateNewName('agent', 'My_Agent')).toBeDefined()
    expect(validateNewName('agent', 'x'.repeat(65))).toBeDefined()
  })

  it('refuses to write through a symlinked skill dir', async () => {
    await mkdir(join(root, 'outside'), { recursive: true })
    await mkdir(join(cfgDir(), 'skills'), { recursive: true })
    try {
      await symlink(join(root, 'outside'), join(cfgDir(), 'skills', 'sneaky'), 'junction')
    } catch {
      return
    }
    const ref: ConfigFileRef = { kind: 'skill', scope: 'user', name: 'sneaky' }
    const r = await config.write(ref, md('sneaky'), null)
    expect(r.ok).toBe(false)
    expect(await exists(join(root, 'outside', 'SKILL.md'))).toBe(false)
    expect(await svc.create({ kind: 'skill', scope: 'user', name: 'sneaky', text: md('x') })).toMatchObject({ ok: false })
    expect(await exists(join(root, 'outside', 'SKILL.md'))).toBe(false)
  })
})

describe('create', () => {
  it('creates a skill dir with SKILL.md, then fails with exists', async () => {
    const r = await svc.create({ kind: 'skill', scope: 'user', name: 'fresh', text: md('fresh') })
    expect(r).toMatchObject({ ok: true, ref: { kind: 'skill', scope: 'user', name: 'fresh' } })
    expect(await readFile(join(cfgDir(), 'skills', 'fresh', 'SKILL.md'), 'utf8')).toBe(md('fresh'))
    const again = await svc.create({ kind: 'skill', scope: 'user', name: 'fresh', text: md('other') })
    expect(again).toMatchObject({ ok: false, code: 'exists' })
    expect(await readFile(join(cfgDir(), 'skills', 'fresh', 'SKILL.md'), 'utf8')).toBe(md('fresh'))
  })

  it('creates nested commands and project agents; project needs a cwd', async () => {
    expect(await svc.create({ kind: 'command', scope: 'project', cwd: proj, name: 'ci/build', text: md('b') })).toMatchObject({ ok: true })
    expect(await exists(join(proj, '.claude', 'commands', 'ci', 'build.md'))).toBe(true)
    expect(await svc.create({ kind: 'agent', scope: 'project', cwd: proj, name: 'rev', text: md('rev') })).toMatchObject({ ok: true })
    expect(await svc.create({ kind: 'agent', scope: 'project', name: 'nocwd', text: md('x') })).toMatchObject({ ok: false, code: 'bad_ref' })
  })

  it('rejects broken frontmatter without writing', async () => {
    const r = await svc.create({ kind: 'agent', scope: 'user', name: 'broken', text: '---\n!!broken\n---\n' })
    expect(r).toMatchObject({ ok: false, code: 'invalid_frontmatter' })
    expect(await exists(join(cfgDir(), 'agents', 'broken.md'))).toBe(false)
  })

  it('treats a file with no frontmatter as valid', async () => {
    expect(await svc.create({ kind: 'command', scope: 'user', name: 'plain', text: 'just a body\n' })).toMatchObject({ ok: true })
  })
})

describe('rename', () => {
  async function seedSkill() {
    await put(join(cfgDir(), 'skills', 'old-name', 'SKILL.md'), md('old-name'))
    await put(join(cfgDir(), 'skills', 'old-name', 'helper.txt'), 'h')
    const ref: ConfigFileRef = { kind: 'skill', scope: 'user', name: 'old-name' }
    return { ref, snap: await config.read(ref) }
  }

  it('moves the skill dir and rewrites name: via text; own writes stay quiet', async () => {
    const { ref, snap } = await seedSkill()
    const r = await svc.rename({ ref, newName: 'new-name', baseHash: snap.hash!, text: md('new-name') })
    expect(r).toMatchObject({ ok: true, ref: { name: 'new-name' } })
    expect(await exists(join(cfgDir(), 'skills', 'old-name'))).toBe(false)
    expect(await readFile(join(cfgDir(), 'skills', 'new-name', 'SKILL.md'), 'utf8')).toBe(md('new-name'))
    expect(await readFile(join(cfgDir(), 'skills', 'new-name', 'helper.txt'), 'utf8')).toBe('h')
    // what the watcher would see: the rewritten file is our own write, the vanished source/dirs are touched paths
    const newHash = sha256(Buffer.from(md('new-name')))
    expect(config.isOwnWrite(join(cfgDir(), 'skills', 'new-name', 'SKILL.md'), newHash)).toBe(true)
    expect(config.isOwnWrite(join(cfgDir(), 'skills', 'old-name', 'SKILL.md'), null)).toBe(true)
    expect(config.isOwnWrite(join(cfgDir(), 'skills', 'old-name'), null)).toBe(true)
    expect(config.isOwnWrite(join(cfgDir(), 'skills', 'new-name'), null)).toBe(true)
  })

  it('renames a command file into a new namespace', async () => {
    await put(join(proj, '.claude', 'commands', 'one.md'), md('one'))
    const ref: ConfigFileRef = { kind: 'command', scope: 'project', cwd: proj, name: 'one' }
    const snap = await config.read(ref)
    const r = await svc.rename({ ref, newName: 'grp/two', baseHash: snap.hash! })
    expect(r).toMatchObject({ ok: true })
    expect(await exists(join(proj, '.claude', 'commands', 'one.md'))).toBe(false)
    expect(await readFile(join(proj, '.claude', 'commands', 'grp', 'two.md'), 'utf8')).toBe(md('one'))
  })

  it('fails with exists, conflict, not_found, read_only and invalid_frontmatter, changing nothing', async () => {
    const { ref, snap } = await seedSkill()
    await put(join(cfgDir(), 'skills', 'taken', 'SKILL.md'), md('taken'))
    expect(await svc.rename({ ref, newName: 'taken', baseHash: snap.hash! })).toMatchObject({ ok: false, code: 'exists' })
    expect(await svc.rename({ ref, newName: 'zzz', baseHash: 'stale' })).toMatchObject({ ok: false, code: 'conflict' })
    expect(await svc.rename({ ref, newName: 'zzz', baseHash: snap.hash!, text: '---\n!!broken\n---\n' })).toMatchObject({
      ok: false,
      code: 'invalid_frontmatter'
    })
    expect(await svc.rename({ ref: { kind: 'skill', scope: 'user', name: 'ghost' }, newName: 'zzz', baseHash: 'h' })).toMatchObject({
      ok: false,
      code: 'not_found'
    })
    expect(
      await svc.rename({ ref: { kind: 'skill', scope: 'plugin', plugin: 'acme', name: 'gamma' }, newName: 'zzz', baseHash: 'h' })
    ).toMatchObject({ ok: false, code: 'read_only' })
    expect(await svc.rename({ ref, newName: 'Bad Name', baseHash: snap.hash! })).toMatchObject({ ok: false, code: 'bad_name' })
    expect(await exists(join(cfgDir(), 'skills', 'old-name', 'SKILL.md'))).toBe(true)
  })

  it('retries a transient EPERM on the directory rename (editor / AV holding a handle)', async () => {
    const { ref, snap } = await seedSkill()
    const { rename: realRename } = await import('node:fs/promises')
    let calls = 0
    const paths = createConfigPaths({ CLAUDE_CONFIG_DIR: cfgDir() }, home)
    const flaky = new ItemsService(paths, registry, config, new Trash(trashDir(userData)), {
      sleep: async () => undefined,
      rename: async (a, b) => {
        if (++calls < 3) throw Object.assign(new Error('busy'), { code: 'EPERM' })
        return realRename(a, b)
      }
    })
    expect(await flaky.rename({ ref, newName: 'after', baseHash: snap.hash! })).toMatchObject({ ok: true })
    expect(calls).toBe(3)
    expect(await exists(join(cfgDir(), 'skills', 'after', 'SKILL.md'))).toBe(true)
  })
})

describe('delete', () => {
  it('moves a skill dir to the trash, removes the source and writes the manifest', async () => {
    await put(join(proj, '.claude', 'skills', 'gone', 'SKILL.md'), md('gone'))
    await put(join(proj, '.claude', 'skills', 'gone', 'x', 'y.txt'), 'y')
    const ref: ConfigFileRef = { kind: 'skill', scope: 'project', cwd: proj, name: 'gone' }
    const snap = await config.read(ref)
    const r = await svc.delete({ ref, baseHash: snap.hash! })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.trashPath!.startsWith(trashDir(userData))).toBe(true)
    expect(await exists(join(proj, '.claude', 'skills', 'gone'))).toBe(false)
    expect(await readFile(join(r.trashPath!, 'gone', 'x', 'y.txt'), 'utf8')).toBe('y')
    const m = JSON.parse(await readFile(join(r.trashPath!, TRASH_MANIFEST), 'utf8'))
    expect(m).toMatchObject({
      originalPath: join(proj, '.claude', 'skills', 'gone'),
      kind: 'skill',
      scope: 'project',
      name: 'gone',
      payload: 'gone'
    })
    expect(config.isOwnWrite(join(proj, '.claude', 'skills', 'gone', 'SKILL.md'), null)).toBe(true)
  })

  it('trashes an agent file and a nested command', async () => {
    await put(join(cfgDir(), 'agents', 'a1.md'), md('a1'))
    await put(join(cfgDir(), 'commands', 'ci', 'run.md'), md('run'))
    for (const ref of [
      { kind: 'agent', scope: 'user', name: 'a1' },
      { kind: 'command', scope: 'user', name: 'ci/run' }
    ] as ConfigFileRef[]) {
      const snap = await config.read(ref)
      const r = await svc.delete({ ref, baseHash: snap.hash! })
      expect(r.ok).toBe(true)
    }
    expect(await exists(join(cfgDir(), 'agents', 'a1.md'))).toBe(false)
    expect(await exists(join(cfgDir(), 'commands', 'ci', 'run.md'))).toBe(false)
  })

  it('refuses on a stale hash and on a plugin ref; the file stays', async () => {
    await put(join(cfgDir(), 'agents', 'keep.md'), md('keep'))
    const ref: ConfigFileRef = { kind: 'agent', scope: 'user', name: 'keep' }
    expect(await svc.delete({ ref, baseHash: 'stale' })).toMatchObject({ ok: false, code: 'conflict' })
    expect(await svc.delete({ ref: { kind: 'agent', scope: 'plugin', plugin: 'acme', name: 'keep' }, baseHash: 'h' })).toMatchObject({
      ok: false,
      code: 'read_only'
    })
    expect(await exists(join(cfgDir(), 'agents', 'keep.md'))).toBe(true)
  })

  it('EXDEV: copies, verifies, then removes the source', async () => {
    const calls: string[] = []
    make({
      ...nodeTrashFs,
      rename: async () => Promise.reject(Object.assign(new Error('x'), { code: 'EXDEV' })),
      cp: async (a, b) => {
        calls.push('cp')
        await nodeTrashFs.cp(a, b)
      },
      rm: async (p) => {
        calls.push('rm')
        await nodeTrashFs.rm(p)
      }
    })
    await put(join(proj, '.claude', 'skills', 'cross', 'SKILL.md'), md('cross'))
    const ref: ConfigFileRef = { kind: 'skill', scope: 'project', cwd: proj, name: 'cross' }
    const snap = await config.read(ref)
    const r = await svc.delete({ ref, baseHash: snap.hash! })
    expect(r.ok).toBe(true)
    expect(calls).toEqual(['cp', 'rm'])
    expect(await exists(join(proj, '.claude', 'skills', 'cross'))).toBe(false)
    if (r.ok) expect(JSON.parse(await readFile(join(r.trashPath!, TRASH_MANIFEST), 'utf8')).method).toBe('copy')
  })

  it('EXDEV verify mismatch returns io and leaves the source untouched', async () => {
    make({
      ...nodeTrashFs,
      rename: async () => Promise.reject(Object.assign(new Error('x'), { code: 'EXDEV' })),
      cp: async (a, b) => {
        await nodeTrashFs.cp(a, b)
        await writeFile(join(b, 'SKILL.md'), 'tampered')
      }
    })
    await put(join(proj, '.claude', 'skills', 'cross', 'SKILL.md'), md('cross'))
    const ref: ConfigFileRef = { kind: 'skill', scope: 'project', cwd: proj, name: 'cross' }
    const snap = await config.read(ref)
    const r = await svc.delete({ ref, baseHash: snap.hash! })
    expect(r).toMatchObject({ ok: false, code: 'io' })
    expect(await readFile(join(proj, '.claude', 'skills', 'cross', 'SKILL.md'), 'utf8')).toBe(md('cross'))
  })
})

describe('config:write on item refs', () => {
  it('writes an existing item, keeping CRLF, with a first-write backup', async () => {
    await put(join(cfgDir(), 'agents', 'crlf.md'), '---\r\nname: crlf\r\n---\r\nold\r\n')
    const ref: ConfigFileRef = { kind: 'agent', scope: 'user', name: 'crlf' }
    const snap = await config.read(ref)
    const r = await config.write(ref, '---\nname: crlf\n---\nnew\n', snap.hash)
    expect(r.ok).toBe(true)
    expect(await readFile(join(cfgDir(), 'agents', 'crlf.md'), 'utf8')).toBe('---\r\nname: crlf\r\n---\r\nnew\r\n')
    if (r.ok) expect(r.backupPath?.startsWith(userData)).toBe(true)
  })

  it('writes without a BOM', async () => {
    await put(join(cfgDir(), 'agents', 'bom.md'), md('bom'))
    const ref: ConfigFileRef = { kind: 'agent', scope: 'user', name: 'bom' }
    const snap = await config.read(ref)
    await config.write(ref, '\ufeff' + md('bom2'), snap.hash)
    const bytes = await readFile(join(cfgDir(), 'agents', 'bom.md'))
    expect(bytes[0]).not.toBe(0xef)
  })

  it('plugin ref: read works, write is read_only, unknown plugin is bad_ref', async () => {
    await put(join(pluginDir, 'agents', 'pa.md'), md('pa'))
    registry.update([{ name: 'acme', path: pluginDir }])
    const ref: ConfigFileRef = { kind: 'agent', scope: 'plugin', plugin: 'acme', name: 'pa' }
    expect((await config.read(ref)).exists).toBe(true)
    expect(await config.write(ref, md('hack'), sha256(md('pa')))).toMatchObject({ ok: false, code: 'read_only' })
    expect(await readFile(join(pluginDir, 'agents', 'pa.md'), 'utf8')).toBe(md('pa'))
    expect(await config.write({ kind: 'agent', scope: 'plugin', plugin: 'nope', name: 'pa' }, md('x'), null)).toMatchObject({
      ok: false,
      code: 'bad_ref'
    })
  })

  it('broken frontmatter gives invalid_frontmatter and leaves the file untouched', async () => {
    await put(join(cfgDir(), 'agents', 'ok.md'), md('ok'))
    const ref: ConfigFileRef = { kind: 'agent', scope: 'user', name: 'ok' }
    const snap = await config.read(ref)
    const r = await config.write(ref, '---\n!!broken\n---\nx', snap.hash)
    expect(r).toMatchObject({ ok: false, code: 'invalid_frontmatter' })
    expect(await readFile(join(cfgDir(), 'agents', 'ok.md'), 'utf8')).toBe(md('ok'))
  })

  it('a stale base hash gives conflict with the current snapshot', async () => {
    await put(join(cfgDir(), 'agents', 'c.md'), md('c'))
    const ref: ConfigFileRef = { kind: 'agent', scope: 'user', name: 'c' }
    const r = await config.write(ref, md('mine'), 'deadbeef')
    expect(r).toMatchObject({ ok: false, code: 'conflict', current: { exists: true } })
    expect(await readFile(join(cfgDir(), 'agents', 'c.md'), 'utf8')).toBe(md('c'))
  })

  it('bad item refs are bad_ref', async () => {
    expect(await config.write({ kind: 'skill', scope: 'user', name: '..' }, md('x'), null)).toMatchObject({ ok: false, code: 'bad_ref' })
    expect(await config.write({ kind: 'agent', scope: 'project', name: 'x' }, md('x'), null)).toMatchObject({ ok: false, code: 'bad_ref' })
    await expect(config.read({ kind: 'command', scope: 'user', name: 'a/../../b' })).rejects.toThrow()
  })
})
