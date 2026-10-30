import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConfigFileRef } from '../../shared/config'
import { createConfigPaths } from '../paths'
import { nodeAtomicFs } from './atomic-write'
import { BACKUPS_KEPT, ConfigService, sha256 } from './config-service'

let root: string
let home: string
let proj: string
let backups: string
let svc: ConfigService

const userSettings: ConfigFileRef = { kind: 'settings', scope: 'user' }
const projSettings = (): ConfigFileRef => ({ kind: 'settings', scope: 'project', cwd: proj })
const localSettings = (): ConfigFileRef => ({ kind: 'settings', scope: 'local', cwd: proj })

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccwrap-cfg-'))
  home = join(root, 'home')
  proj = join(root, 'proj')
  backups = join(root, 'userData', 'backups')
  await mkdir(home, { recursive: true })
  await mkdir(proj, { recursive: true })
  svc = new ConfigService(createConfigPaths({ CLAUDE_CONFIG_DIR: join(home, '.claude') }, home), backups)
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('read', () => {
  it('reports a missing file with null hash', async () => {
    const s = await svc.read(userSettings)
    expect(s).toMatchObject({ exists: false, text: '', hash: null, path: join(home, '.claude', 'settings.json') })
  })

  it('returns text, sha256 of bytes and strips a BOM from text', async () => {
    const p = join(home, '.claude', 'settings.json')
    await mkdir(join(home, '.claude'), { recursive: true })
    const bytes = Buffer.from('﻿{"a":1}', 'utf8')
    await writeFile(p, bytes)
    const s = await svc.read(userSettings)
    expect(s.text).toBe('{"a":1}')
    expect(s.hash).toBe(sha256(bytes))
    expect(s.mtimeMs).toBeGreaterThan(0)
  })
})

describe('write: settings', () => {
  it('creates the missing parent .claude/ dir and the file', async () => {
    const r = await svc.write(projSettings(), '{"model":"x"}\n', null)
    expect(r.ok).toBe(true)
    expect(await readFile(join(proj, '.claude', 'settings.json'), 'utf8')).toBe('{"model":"x"}\n')
    if (r.ok) expect(r.backupPath).toBeUndefined()
  })

  it('rejects invalid JSON and leaves the file untouched', async () => {
    await svc.write(projSettings(), '{"a":1}', null)
    const cur = await svc.read(projSettings())
    const r = await svc.write(projSettings(), '{"a":', cur.hash)
    expect(r).toMatchObject({ ok: false, code: 'invalid_json' })
    expect((await svc.read(projSettings())).text).toBe('{"a":1}')
  })

  it('rejects non-object roots', async () => {
    for (const t of ['[]', '1', 'null', '"s"']) {
      expect(await svc.write(projSettings(), t, null)).toMatchObject({ ok: false, code: 'not_object' })
    }
  })

  it('rejects settings with comments (not strict JSON) as invalid_json', async () => {
    expect(await svc.write(projSettings(), '{ // c\n "a": 1 }', null)).toMatchObject({ ok: false, code: 'invalid_json' })
  })

  it('bad_ref when cwd is missing for a project scope', async () => {
    const r = await svc.write({ kind: 'settings', scope: 'project' }, '{}', null)
    expect(r).toMatchObject({ ok: false, code: 'bad_ref' })
  })

  it('preserves unknown keys and key order after a form-style patch', async () => {
    const orig = await readFile(join(__dirname, '../../../tests/fixtures/config/settings-unknown-keys.json'), 'utf8')
    await svc.write(localSettings(), orig, null)
    const cur = await svc.read(localSettings())
    const obj = JSON.parse(cur.text) as Record<string, unknown>
    obj['model'] = 'opus'
    const r = await svc.write(localSettings(), JSON.stringify(obj, null, 2) + '\n', cur.hash)
    expect(r.ok).toBe(true)
    const after = JSON.parse((await svc.read(localSettings())).text) as Record<string, unknown>
    expect(Object.keys(after)).toEqual(['zzFutureKey', 'model', 'permissions', 'env', 'aaLastKey'])
    expect(after['zzFutureKey']).toEqual({ nested: [1, 2, { a: true }] })
    expect((after['permissions'] as Record<string, unknown>)['futureField']).toBe('keep-me')
    expect(after['aaLastKey']).toBeNull()
    expect(after['model']).toBe('opus')
  })

  it('writes the raw text verbatim (formatting kept)', async () => {
    const text = '{\n\t"b": 1,\r\n\t"a": 2\n}'
    const r = await svc.write(projSettings(), text, null)
    expect(r.ok).toBe(true)
    expect(await readFile(join(proj, '.claude', 'settings.json'), 'utf8')).toBe(text)
  })
})

describe('write: conflict detection', () => {
  it('returns conflict + current and writes nothing when the file changed after the read', async () => {
    await svc.write(projSettings(), '{"v":1}', null)
    const read = await svc.read(projSettings())
    // the CLI (or the user) edits the file behind our back
    await writeFile(join(proj, '.claude', 'settings.json'), '{"v":2,"cli":true}')
    const r = await svc.write(projSettings(), '{"v":3}', read.hash)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('conflict')
      expect(r.current?.text).toBe('{"v":2,"cli":true}')
      // overwrite = write again with current.hash
      const again = await svc.write(projSettings(), '{"v":3}', r.current!.hash)
      expect(again.ok).toBe(true)
    }
    expect(await readFile(join(proj, '.claude', 'settings.json'), 'utf8')).toBe('{"v":3}')
  })

  it('conflicts when baseHash is null but the file now exists', async () => {
    await mkdir(join(proj, '.claude'), { recursive: true })
    await writeFile(join(proj, '.claude', 'settings.json'), '{}')
    expect(await svc.write(projSettings(), '{"x":1}', null)).toMatchObject({ ok: false, code: 'conflict' })
  })

  it('conflicts when a hash is given but the file was deleted', async () => {
    const r = await svc.write(projSettings(), '{}', 'deadbeef')
    expect(r).toMatchObject({ ok: false, code: 'conflict', current: { exists: false, hash: null } })
  })
})

describe('backups', () => {
  const files = async (): Promise<string[]> => (await readdir(backups).catch(() => [])).sort()

  it('makes exactly one backup per file per run, outside the project', async () => {
    await svc.write(projSettings(), '{"v":0}', null)
    expect(await files()).toEqual([]) // nothing to back up on creation
    let cur = await svc.read(projSettings())
    const r1 = await svc.write(projSettings(), '{"v":1}', cur.hash)
    cur = await svc.read(projSettings())
    const r2 = await svc.write(projSettings(), '{"v":2}', cur.hash)
    expect(r1.ok && r1.backupPath).toBeTruthy()
    expect(r2.ok && r2.backupPath).toBeUndefined()
    const names = await files()
    expect(names).toHaveLength(1)
    expect(names[0]).toMatch(/^[0-9a-f]{12}-settings\.json\..+\.bak$/)
    if (r1.ok) {
      expect(r1.backupPath!.startsWith(backups)).toBe(true)
      expect(await readFile(r1.backupPath!, 'utf8')).toBe('{"v":0}') // pre-write content
    }
    expect((await readdir(join(proj, '.claude'))).sort()).toEqual(['settings.json'])
  })

  it('keeps only the last 5 backups of a file across runs', async () => {
    await svc.write(projSettings(), '{"v":0}', null)
    let t = Date.UTC(2026, 0, 1)
    for (let i = 1; i <= 7; i++) {
      const run = new ConfigService(createConfigPaths({ CLAUDE_CONFIG_DIR: join(home, '.claude') }, home), backups, { now: () => (t += 1000) })
      const cur = await run.read(projSettings())
      expect((await run.write(projSettings(), `{"v":${i}}`, cur.hash)).ok).toBe(true)
    }
    const names = await files()
    expect(names).toHaveLength(BACKUPS_KEPT)
    // the oldest ones were dropped: the newest backup holds v6
    const newest = names[names.length - 1]!
    expect(await readFile(join(backups, newest), 'utf8')).toBe('{"v":6}')
  })

  it('uses distinct backup names for same-named files in different projects', async () => {
    const other = join(root, 'other')
    await mkdir(join(other, '.claude'), { recursive: true })
    await writeFile(join(other, '.claude', 'settings.json'), '{}')
    await mkdir(join(proj, '.claude'), { recursive: true })
    await writeFile(join(proj, '.claude', 'settings.json'), '{}')
    const a = await svc.read(projSettings())
    const b = await svc.read({ kind: 'settings', scope: 'project', cwd: other })
    await svc.write(projSettings(), '{"a":1}', a.hash)
    await svc.write({ kind: 'settings', scope: 'project', cwd: other }, '{"b":1}', b.hash)
    expect(new Set((await files()).map((n) => n.slice(0, 12))).size).toBe(2)
  })
})

describe('write: memory', () => {
  const mem: ConfigFileRef = { kind: 'memory', scope: 'project', cwd: '' }
  const ref = (): ConfigFileRef => ({ ...mem, cwd: proj } as ConfigFileRef)

  it('accepts any text, UTF-8 without BOM', async () => {
    const r = await svc.write(ref(), '﻿# Hello é\n', null)
    expect(r.ok).toBe(true)
    const buf = await readFile(join(proj, 'CLAUDE.md'))
    expect(buf[0]).toBe(0x23)
    expect(buf.toString('utf8')).toBe('# Hello é\n')
  })

  it('keeps CRLF of an existing file', async () => {
    await writeFile(join(proj, 'CLAUDE.md'), 'a\r\nb\r\n')
    const cur = await svc.read(ref())
    await svc.write(ref(), 'a\nb\nc\n', cur.hash)
    expect(await readFile(join(proj, 'CLAUDE.md'), 'utf8')).toBe('a\r\nb\r\nc\r\n')
  })

  it('keeps LF of an existing LF file', async () => {
    await writeFile(join(proj, 'CLAUDE.md'), 'a\nb\n')
    const cur = await svc.read(ref())
    await svc.write(ref(), 'a\r\nb\r\n', cur.hash)
    expect(await readFile(join(proj, 'CLAUDE.md'), 'utf8')).toBe('a\nb\n')
  })

  it('resolves the four memory scopes', async () => {
    for (const scope of ['project', 'projectDotClaude', 'local'] as const) {
      expect((await svc.write({ kind: 'memory', scope, cwd: proj }, `# ${scope}\n`, null)).ok).toBe(true)
    }
    expect(await readFile(join(proj, '.claude', 'CLAUDE.md'), 'utf8')).toBe('# projectDotClaude\n')
    expect(await readFile(join(proj, 'CLAUDE.local.md'), 'utf8')).toBe('# local\n')
    expect((await svc.write({ kind: 'memory', scope: 'user' }, '# u\n', null)).ok).toBe(true)
    expect(await readFile(join(home, '.claude', 'CLAUDE.md'), 'utf8')).toBe('# u\n')
  })
})

describe('write: Windows lock retry + own-write registry', () => {
  it('survives EPERM on the first two renames', async () => {
    let n = 0
    const flaky = new ConfigService(createConfigPaths({ CLAUDE_CONFIG_DIR: join(home, '.claude') }, home), backups, {
      sleep: async () => {},
      fs: {
        ...nodeAtomicFs,
        rename: async (a, b) => {
          if (++n < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' })
          return nodeAtomicFs.rename(a, b)
        }
      }
    })
    const r = await flaky.write(projSettings(), '{"ok":true}', null)
    expect(r.ok).toBe(true)
    expect(n).toBe(3)
  })

  it('maps a persistent failure to code io and leaves no temp file', async () => {
    const bad = new ConfigService(createConfigPaths({ CLAUDE_CONFIG_DIR: join(home, '.claude') }, home), backups, {
      sleep: async () => {},
      fs: { ...nodeAtomicFs, rename: async () => Promise.reject(Object.assign(new Error('locked'), { code: 'EPERM' })) }
    })
    expect(await bad.write(projSettings(), '{}', null)).toMatchObject({ ok: false, code: 'io' })
    expect(await readdir(join(proj, '.claude'))).toEqual([])
  })

  it('remembers its own write hash', async () => {
    const r = await svc.write(projSettings(), '{"a":1}', null)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(svc.isOwnWrite(r.snapshot.path, r.snapshot.hash)).toBe(true)
      expect(svc.isOwnWrite(r.snapshot.path, sha256('other'))).toBe(false)
      expect(svc.isOwnWrite(r.snapshot.path, null)).toBe(false)
    }
  })
})
