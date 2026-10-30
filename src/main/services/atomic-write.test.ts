import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nodeAtomicFs, retryDelayMs, writeFileAtomic } from './atomic-write'
import type { AtomicFs } from './atomic-write'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ccwrap-aw-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('writeFileAtomic', () => {
  it('writes a new file and creates missing parents', async () => {
    const p = join(dir, '.claude', 'settings.json')
    await writeFileAtomic(p, '{"a":1}\n')
    expect(await readFile(p, 'utf8')).toBe('{"a":1}\n')
  })

  it('replaces an existing file and leaves no temp files', async () => {
    const p = join(dir, 'f.json')
    await writeFile(p, 'old')
    await writeFileAtomic(p, 'new')
    expect(await readFile(p, 'utf8')).toBe('new')
    expect(await readdir(dir)).toEqual(['f.json'])
  })

  it('retries EPERM and succeeds on the 3rd attempt', async () => {
    let calls = 0
    const sleeps: number[] = []
    const fs: AtomicFs = {
      ...nodeAtomicFs,
      rename: async (a, b) => {
        calls++
        if (calls < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' })
        return nodeAtomicFs.rename(a, b)
      }
    }
    const p = join(dir, 'f.json')
    await writeFileAtomic(p, 'x', { fs, sleep: async (ms) => void sleeps.push(ms) })
    expect(calls).toBe(3)
    expect(sleeps).toEqual([retryDelayMs(0), retryDelayMs(1)])
    expect(await readFile(p, 'utf8')).toBe('x')
  })

  it('gives up after the retry budget, removes the temp file and rethrows', async () => {
    let calls = 0
    const fs: AtomicFs = {
      ...nodeAtomicFs,
      rename: async () => {
        calls++
        throw Object.assign(new Error('busy'), { code: 'EBUSY' })
      }
    }
    await expect(writeFileAtomic(join(dir, 'f.json'), 'x', { fs, retries: 2, sleep: async () => {} })).rejects.toThrow('busy')
    expect(calls).toBe(3)
    expect(await readdir(dir)).toEqual([])
  })

  it('does not retry non-transient errors', async () => {
    let calls = 0
    const fs: AtomicFs = {
      ...nodeAtomicFs,
      rename: async () => {
        calls++
        throw Object.assign(new Error('nope'), { code: 'ENOENT' })
      }
    }
    await expect(writeFileAtomic(join(dir, 'f.json'), 'x', { fs, sleep: async () => {} })).rejects.toThrow('nope')
    expect(calls).toBe(1)
  })

  it('backoff is capped at 200ms', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([20, 40, 80, 160, 200, 200, 200])
  })
})
