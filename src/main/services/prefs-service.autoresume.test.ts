import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_AUTO_RESUME_PROMPT, DEFAULT_PREFS } from '../../shared/app'
import { AppPrefsPatchSchema, AutoResumeReportSchema, IpcChannels } from '../../shared/ipc'
import { PrefsService } from './prefs-service'

let dir: string
let file: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ccwrap-prefs-ar-'))
  file = join(dir, 'prefs.json')
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('autoResume prefs (WP14)', () => {
  it('defaults: off, default continuation prompt', () => {
    expect(DEFAULT_PREFS.autoResume).toEqual({ enabled: false, prompt: DEFAULT_AUTO_RESUME_PROMPT })
    expect(DEFAULT_AUTO_RESUME_PROMPT).toBe('Continue where you left off.')
    expect(new PrefsService(file).get().autoResume.enabled).toBe(false)
  })

  it('an older prefs.json without autoResume loads with the defaults (backward compatible)', async () => {
    await writeFile(file, JSON.stringify({ version: 1, confirmQuitWhileRunning: false }))
    const p = new PrefsService(file).get()
    expect(p.confirmQuitWhileRunning).toBe(false)
    expect(p.autoResume).toEqual(DEFAULT_PREFS.autoResume)
  })

  it('patches merge field by field and persist', async () => {
    const p = new PrefsService(file)
    await p.set({ autoResume: { enabled: true } })
    expect(p.get().autoResume).toEqual({ enabled: true, prompt: DEFAULT_AUTO_RESUME_PROMPT })
    await p.set({ autoResume: { prompt: 'go on' } })
    expect(new PrefsService(file).get().autoResume).toEqual({ enabled: true, prompt: 'go on' })
  })

  it('rejects malformed patches', async () => {
    expect(AppPrefsPatchSchema.safeParse({ autoResume: { enabled: 'yes' } }).success).toBe(false)
    expect(AppPrefsPatchSchema.safeParse({ autoResume: { prompt: 'x'.repeat(2001) } }).success).toBe(false)
    expect(AppPrefsPatchSchema.safeParse({ autoResume: { bogus: 1 } }).success).toBe(false)
    await expect(new PrefsService(file).set({ autoResume: { enabled: 1 as never } })).rejects.toThrow()
  })
})

describe('autoresume report contract', () => {
  it('channel name is frozen', () => {
    expect(IpcChannels.autoResumeReport).toBe('autoresume:report')
  })
  it('accepts the three kinds and rejects junk', () => {
    for (const kind of ['paused', 'resumed', 'update']) {
      expect(AutoResumeReportSchema.safeParse({ kind, pending: 0 }).success).toBe(true)
    }
    expect(AutoResumeReportSchema.safeParse({ kind: 'paused', pending: 1, title: 'T', resetAt: 1 }).success).toBe(true)
    expect(AutoResumeReportSchema.safeParse({ kind: 'other', pending: 0 }).success).toBe(false)
    expect(AutoResumeReportSchema.safeParse({ kind: 'paused', pending: -1 }).success).toBe(false)
    expect(AutoResumeReportSchema.safeParse({ kind: 'paused', pending: 1, title: 'x'.repeat(121) }).success).toBe(false)
  })
})
