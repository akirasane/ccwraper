import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { trashDir } from '../paths'
import { Trash, TRASH_MANIFEST, nodeTrashFs } from './trash'
import type { TrashFs, TrashManifest } from './trash'

let root: string
let src: string
let trashRoot: string

const exists = (p: string) => stat(p).then(() => true, () => false)
const errno = (code: string) => Object.assign(new Error(code), { code })

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccwrap-trash-'))
  src = join(root, 'proj', '.claude', 'skills', 'demo')
  trashRoot = trashDir(join(root, 'userData'))
  await mkdir(join(src, 'sub'), { recursive: true })
  await writeFile(join(src, 'SKILL.md'), '---\nname: demo\n---\nbody\n')
  await writeFile(join(src, 'sub', 'a.txt'), 'aaa')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('trash guard', () => {
  it('keeps the trash dir under the temp root', () => {
    expect(trashRoot.startsWith(root)).toBe(true)
    expect(trashRoot.startsWith(process.env['CCWRAP_TEST_REAL_HOME'] ?? '\0')).toBe(false)
  })
})

describe('Trash.move', () => {
  it('renames into a stamped entry dir and writes the manifest', async () => {
    const t = new Trash(trashRoot, { now: () => Date.UTC(2026, 9, 30, 1, 2, 3) })
    const entry = await t.move(src, { kind: 'skill', scope: 'project', name: 'demo' })
    expect(entry.startsWith(trashRoot)).toBe(true)
    expect(entry).toContain('2026-10-30T01-02-03')
    expect(entry).toContain('skill-project-demo')
    expect(await exists(src)).toBe(false)
    expect(await readFile(join(entry, 'demo', 'SKILL.md'), 'utf8')).toContain('name: demo')
    expect(await readFile(join(entry, 'demo', 'sub', 'a.txt'), 'utf8')).toBe('aaa')
    const m = JSON.parse(await readFile(join(entry, TRASH_MANIFEST), 'utf8')) as TrashManifest
    expect(m).toMatchObject({ originalPath: src, kind: 'skill', scope: 'project', name: 'demo', payload: 'demo', method: 'rename' })
    expect(m.trashedAt).toBe('2026-10-30T01:02:03.000Z')
  })

  it('encodes slashes of a command name and avoids entry collisions', async () => {
    const a = join(root, 'a', 'build.md')
    const b = join(root, 'b', 'build.md')
    await mkdir(join(root, 'a'), { recursive: true })
    await mkdir(join(root, 'b'), { recursive: true })
    await writeFile(a, 'x')
    await writeFile(b, 'y')
    const t = new Trash(trashRoot, { now: () => 1 })
    const e1 = await t.move(a, { kind: 'command', scope: 'user', name: 'ci/build' })
    const e2 = await t.move(b, { kind: 'command', scope: 'user', name: 'ci/build' })
    expect(e1).toContain('ci__build')
    expect(e2).not.toBe(e1)
    expect(await readFile(join(e2, 'build.md'), 'utf8')).toBe('y')
  })

  it('retries a transient EPERM rename with backoff', async () => {
    let calls = 0
    const sleeps: number[] = []
    const fs: TrashFs = {
      ...nodeTrashFs,
      rename: async (a, b) => {
        if (++calls < 3) throw errno('EPERM')
        return nodeTrashFs.rename(a, b)
      }
    }
    const t = new Trash(trashRoot, { fs, sleep: async (ms) => void sleeps.push(ms) })
    await t.move(src, { kind: 'skill', scope: 'user', name: 'demo' })
    expect(calls).toBe(3)
    expect(sleeps).toEqual([20, 40])
    expect(await exists(src)).toBe(false)
  })

  it('gives up on a persistent EPERM and leaves the source', async () => {
    const fs: TrashFs = { ...nodeTrashFs, rename: async () => Promise.reject(errno('EPERM')) }
    const t = new Trash(trashRoot, { fs, sleep: async () => undefined, retries: 2 })
    await expect(t.move(src, { kind: 'skill', scope: 'user', name: 'demo' })).rejects.toThrow('EPERM')
    expect(await exists(join(src, 'SKILL.md'))).toBe(true)
  })

  it('EXDEV: copies, verifies, then removes the source', async () => {
    const order: string[] = []
    const fs: TrashFs = {
      ...nodeTrashFs,
      rename: async () => Promise.reject(errno('EXDEV')),
      cp: async (a, b) => {
        order.push('cp')
        await nodeTrashFs.cp(a, b)
      },
      rm: async (p) => {
        order.push(`rm:${p === src ? 'src' : 'other'}`)
        await nodeTrashFs.rm(p)
      }
    }
    const t = new Trash(trashRoot, { fs })
    const entry = await t.move(src, { kind: 'skill', scope: 'project', name: 'demo' })
    expect(order).toEqual(['cp', 'rm:src'])
    expect(await exists(src)).toBe(false)
    expect(await readFile(join(entry, 'demo', 'sub', 'a.txt'), 'utf8')).toBe('aaa')
    const m = JSON.parse(await readFile(join(entry, TRASH_MANIFEST), 'utf8')) as TrashManifest
    expect(m.method).toBe('copy')
  })

  it('EXDEV with a verify mismatch leaves the source untouched and removes only its own partial copy', async () => {
    const removed: string[] = []
    const fs: TrashFs = {
      ...nodeTrashFs,
      rename: async () => Promise.reject(errno('EXDEV')),
      cp: async (a, b) => {
        await nodeTrashFs.cp(a, b)
        await writeFile(join(b, 'sub', 'a.txt'), 'CORRUPT') // different bytes, same name
      },
      rm: async (p) => {
        removed.push(p)
        await nodeTrashFs.rm(p)
      }
    }
    const t = new Trash(trashRoot, { fs })
    await expect(t.move(src, { kind: 'skill', scope: 'project', name: 'demo' })).rejects.toThrow(/did not match/)
    expect(await readFile(join(src, 'sub', 'a.txt'), 'utf8')).toBe('aaa')
    expect(await readFile(join(src, 'SKILL.md'), 'utf8')).toContain('demo')
    expect(removed.every((p) => p.startsWith(trashRoot))).toBe(true)
    expect(removed).not.toContain(src)
  })

  it('EXDEV with a failing copy leaves the source untouched', async () => {
    const fs: TrashFs = {
      ...nodeTrashFs,
      rename: async () => Promise.reject(errno('EXDEV')),
      cp: async () => Promise.reject(errno('ENOSPC'))
    }
    const t = new Trash(trashRoot, { fs })
    await expect(t.move(src, { kind: 'skill', scope: 'project', name: 'demo' })).rejects.toThrow('ENOSPC')
    expect(await exists(join(src, 'SKILL.md'))).toBe(true)
  })

  it('refuses things already inside the trash', async () => {
    const t = new Trash(trashRoot)
    const e = await t.move(src, { kind: 'skill', scope: 'user', name: 'demo' })
    await expect(t.move(join(e, 'demo'), { kind: 'skill', scope: 'user', name: 'again' })).rejects.toThrow(/inside the trash/)
    expect((await readdir(e)).sort()).toEqual([TRASH_MANIFEST, 'demo'])
  })

  it('refuses a symlink source', async () => {
    const link = join(root, 'link')
    try {
      await (await import('node:fs/promises')).symlink(src, link, 'junction')
    } catch {
      return // cannot create links here
    }
    const t = new Trash(trashRoot)
    await expect(t.move(link, { kind: 'skill', scope: 'user', name: 'l' })).rejects.toThrow(/symlink/)
    expect(await exists(join(src, 'SKILL.md'))).toBe(true)
  })
})
