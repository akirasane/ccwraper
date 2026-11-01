import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CACHE_TTL_MS, FileSearchService, listProjectFiles, rankFiles } from './file-search'

const FILES = ['README.md', 'src/main/index.ts', 'src/renderer/Composer.tsx', 'src/renderer/features/chat/Composer.test.tsx', 'docs/P5-PLAN.md']

describe('rankFiles', () => {
  it('prefers filename matches and shorter paths', () => {
    const r = rankFiles(FILES, 'composer', 5)
    expect(r[0]).toBe('src/renderer/Composer.tsx')
    expect(r).toContain('src/renderer/features/chat/Composer.test.tsx')
    expect(r).not.toContain('README.md')
  })
  it('empty query returns shallow files first, capped by limit', () => {
    const r = rankFiles(FILES, '', 2)
    expect(r).toEqual(['README.md', 'docs/P5-PLAN.md'])
  })
  it('matches across path segments', () => {
    expect(rankFiles(FILES, 'srcmain', 3)).toEqual(['src/main/index.ts'])
  })
})

describe('FileSearchService', () => {
  const dirs: string[] = []
  const tmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'ccwrap-fs-'))
    dirs.push(d)
    return d
  }
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
    vi.useRealTimers()
  })

  it('returns [] for a missing directory', async () => {
    const s = new FileSearchService(async () => FILES)
    expect(await s.search({ cwd: join(tmpdir(), 'nope-ccwrap-xyz'), query: '', limit: 5 })).toEqual([])
  })

  it('caches the listing per cwd until the TTL expires', async () => {
    const d = tmp()
    let t = 1000
    const list = vi.fn(async () => FILES)
    const s = new FileSearchService(list, () => t)
    await s.search({ cwd: d, query: 'a', limit: 5 })
    await s.search({ cwd: d, query: 'b', limit: 5 })
    expect(list).toHaveBeenCalledTimes(1)
    t += CACHE_TTL_MS + 1
    await s.search({ cwd: d, query: 'c', limit: 5 })
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('walk fallback skips node_modules/.git and symlinks, uses forward slashes', async () => {
    const d = tmp()
    mkdirSync(join(d, 'src', 'a'), { recursive: true })
    mkdirSync(join(d, 'node_modules', 'x'), { recursive: true })
    mkdirSync(join(d, '.git'), { recursive: true })
    writeFileSync(join(d, 'src', 'a', 'one.ts'), '')
    writeFileSync(join(d, 'node_modules', 'x', 'dep.js'), '')
    writeFileSync(join(d, '.git', 'HEAD'), '')
    writeFileSync(join(d, 'top.md'), '')
    try {
      symlinkSync(tmpdir(), join(d, 'link'), 'junction')
    } catch {
      /* symlinks may be unavailable; the other assertions still hold */
    }
    const files = (await listProjectFiles(d)).sort()
    expect(files).toEqual(['src/a/one.ts', 'top.md'])
  })
})

describe('rankFiles noise', () => {
  it('literal filename hits beat scattered subsequence matches', () => {
    const files = ['src/components/ui/spinner.tsx', 'src/lib/composer-bus.ts', 'src/chat/Composer.tsx', 'src/editor/index.ts']
    const r = rankFiles(files, 'composer', 4)
    expect(r.slice(0, 2).sort()).toEqual(['src/chat/Composer.tsx', 'src/lib/composer-bus.ts'])
    expect(r.indexOf('src/components/ui/spinner.tsx')).toBeGreaterThan(1)
  })
})

describe('FileSearchService extra dirs', () => {
  it('returns project files relative and extra-folder files absolute', async () => {
    const proj = mkdtempSync(join(tmpdir(), 'ccwrap-p-'))
    const extra = mkdtempSync(join(tmpdir(), 'ccwrap-x-'))
    try {
      const s = new FileSearchService(async (d) => (d.includes('ccwrap-x-') ? ['lib/shared.ts'] : ['src/app.ts']))
      const r = await s.search({ cwd: proj, dirs: [extra], query: '', limit: 10 })
      const base = extra.split(String.fromCharCode(92)).join('/')
      expect(r).toContain('src/app.ts')
      expect(r).toContain(`${base}/lib/shared.ts`)
      expect(await s.search({ cwd: proj, dirs: [join(extra, 'missing')], query: '', limit: 10 })).toEqual(['src/app.ts'])
    } finally {
      rmSync(proj, { recursive: true, force: true })
      rmSync(extra, { recursive: true, force: true })
    }
  })
})
