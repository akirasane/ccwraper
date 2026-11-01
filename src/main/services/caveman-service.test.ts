import { mkdtempSync, rmSync, symlinkSync, writeFileSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CavemanState } from '../../shared/limits'
import {
  CAVEMAN_ACTIVE_FILE,
  CAVEMAN_MAX_BYTES,
  CAVEMAN_SUFFIX_FILE,
  CavemanService,
  parseCavemanMode,
  sanitizeSuffix
} from './caveman-service'

let dir: string
let sent: CavemanState[]
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ccw-caveman-'))
  sent = []
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const make = (): CavemanService => new CavemanService({ configDir: dir, broadcast: (s) => sent.push(s) })
const put = (name: string, text: string | Buffer): void => writeFileSync(join(dir, name), text)

describe('parseCavemanMode / sanitizeSuffix', () => {
  it('lowercases and whitelists the mode', () => {
    expect(parseCavemanMode('ULTRA\n')).toBe('ultra')
    expect(parseCavemanMode(' wenyan-lite ')).toBe('wenyan-lite')
    expect(parseCavemanMode('compress')).toBe('compress')
    expect(parseCavemanMode('rm -rf')).toBeNull()
    expect(parseCavemanMode('off')).toBeNull()
    expect(parseCavemanMode('')).toBeNull()
    expect(parseCavemanMode(undefined)).toBeNull()
  })
  it('strips ANSI/ESC sequences and control bytes', () => {
    expect(sanitizeSuffix('\x1b[38;5;172msaved 12.3k\x1b[0m\r\n')).toBe('saved 12.3k')
    expect(sanitizeSuffix('a\x00b\x07c\x7fd')).toBe('abcd')
    expect(sanitizeSuffix('\x1b]0;title\x07ok')).toBe('ok')
    expect(sanitizeSuffix('\x1b[0m')).toBeNull()
  })
})

describe('CavemanService (temp dir fixtures)', () => {
  it('reads mode and suffix and broadcasts once per change', async () => {
    put(CAVEMAN_ACTIVE_FILE, 'ultra\n')
    put(CAVEMAN_SUFFIX_FILE, 'saved 12.3k tokens')
    const s = make()
    expect(await s.refresh()).toEqual({ mode: 'ultra', suffix: 'saved 12.3k tokens' })
    await s.refresh()
    expect(sent).toHaveLength(1)
    put(CAVEMAN_SUFFIX_FILE, 'saved 13k tokens')
    await s.refresh()
    expect(sent.map((x) => x.suffix)).toEqual(['saved 12.3k tokens', 'saved 13k tokens'])
  })

  it('is hidden when the files are missing, mode is off, or the mode is unknown', async () => {
    const s = make()
    expect(await s.refresh()).toEqual({ mode: null, suffix: null })
    put(CAVEMAN_SUFFIX_FILE, 'saved 1k')
    put(CAVEMAN_ACTIVE_FILE, 'off')
    expect(await s.refresh()).toEqual({ mode: null, suffix: null })
    put(CAVEMAN_ACTIVE_FILE, 'turbo')
    expect(await s.refresh()).toEqual({ mode: null, suffix: null })
    expect(sent).toHaveLength(0)
  })

  it('shows the mode without a suffix when the suffix file is missing or empty', async () => {
    put(CAVEMAN_ACTIVE_FILE, 'full')
    expect(await make().refresh()).toEqual({ mode: 'full', suffix: null })
  })

  it('caps reads at 64 bytes', async () => {
    put(CAVEMAN_ACTIVE_FILE, 'lite')
    put(CAVEMAN_SUFFIX_FILE, 'x'.repeat(10_000))
    const r = await make().refresh()
    expect(r.suffix).toBe('x'.repeat(CAVEMAN_MAX_BYTES))
  })

  it('strips control and escape bytes from the suffix', async () => {
    put(CAVEMAN_ACTIVE_FILE, 'full')
    put(CAVEMAN_SUFFIX_FILE, Buffer.from('\x1b[31msaved\x1b[0m \x07 5k\x00'))
    expect((await make().refresh()).suffix).toBe('saved  5k')
  })

  it('refuses symlinks (skipped when the OS does not permit creating them)', async (ctx) => {
    const real = join(dir, 'real.txt')
    writeFileSync(real, 'ultra')
    try {
      symlinkSync(real, join(dir, CAVEMAN_ACTIVE_FILE))
    } catch {
      ctx.skip()
      return
    }
    expect(await make().refresh()).toEqual({ mode: null, suffix: null })
  })

  it('never writes or deletes anything', async () => {
    put(CAVEMAN_ACTIVE_FILE, 'ultra')
    put(CAVEMAN_SUFFIX_FILE, 'saved 1k')
    const before = readdirSync(dir).sort()
    const s = make()
    await s.refresh()
    expect(readdirSync(dir).sort()).toEqual(before)
    expect(readFileSync(join(dir, CAVEMAN_ACTIVE_FILE), 'utf8')).toBe('ultra')
  })

  it('polls on an interval until disposed', async () => {
    // Real timers: the service does real file I/O, which fake timers cannot advance.
    put(CAVEMAN_ACTIVE_FILE, 'lite')
    const s = new CavemanService({ configDir: dir, broadcast: (x) => sent.push(x), pollMs: 30 })
    s.start()
    await vi.waitFor(() => expect(sent.map((x) => x.mode)).toEqual(['lite']), { timeout: 5000 })
    put(CAVEMAN_ACTIVE_FILE, 'full')
    await vi.waitFor(() => expect(sent.map((x) => x.mode)).toEqual(['lite', 'full']), { timeout: 5000 })
    s.dispose()
    put(CAVEMAN_ACTIVE_FILE, 'ultra')
    await new Promise((r) => setTimeout(r, 150))
    expect(sent).toHaveLength(2)
  })
})
