import { describe, expect, it, vi } from 'vitest'
import sessions from '../../../tests/fixtures/history/sessions.json'
import messages from '../../../tests/fixtures/history/messages.json'
import { HistoryService } from './history-service'
import { normalizeCwdKey } from '../paths'
import type { HistoryApi, RawSessionInfo, RawSessionMessage } from './sdk-history'

const win = process.platform === 'win32'

function fakeApi(opts: { dirBroken?: boolean } = {}): HistoryApi & { calls: unknown[] } {
  const calls: unknown[] = []
  return {
    calls,
    async listSessions(o) {
      calls.push(o)
      if (o?.dir) {
        if (opts.dirBroken) return []
        const k = normalizeCwdKey(o.dir)
        return (sessions as RawSessionInfo[]).filter((s) => s.cwd && normalizeCwdKey(s.cwd) === k)
      }
      return sessions as RawSessionInfo[]
    },
    async getSessionMessages(id, o) {
      calls.push({ id, ...o })
      return id === 's-a1' ? (messages as RawSessionMessage[]) : []
    }
  }
}

const svc = (api = fakeApi(), existing = ['C:\\fixture\\proj', 'c:\\fixture\\proj', 'C:\\fixture\\other\\']) =>
  new HistoryService({ api: async () => api, exists: (p) => existing.includes(p) })

describe('HistoryService.listProjects', () => {
  it.runIf(win)('groups case/trailing-slash variants, shows newest spelling, sorts newest first', async () => {
    const p = await svc().listProjects()
    expect(p.map((x) => x.cwd)).toEqual(['c:\\fixture\\proj', 'C:\\fixture\\other\\', 'C:\\fixture\\missing'])
    expect(p[0]).toMatchObject({ sessionCount: 2, lastModified: 3000, exists: true })
  })
  it.runIf(win)('flags missing cwd as exists:false and skips sessions without cwd', async () => {
    const p = await svc().listProjects()
    expect(p.find((x) => x.cwd.endsWith('missing'))).toMatchObject({ exists: false, sessionCount: 1 })
    expect(p.reduce((n, x) => n + x.sessionCount, 0)).toBe(4)
  })
})

describe('HistoryService.list', () => {
  const forms = ['C:/fixture/proj', 'C:\\fixture\\proj', 'c:\\fixture\\proj', 'C:\\fixture\\proj\\']
  it.runIf(win).each(forms)('finds both spellings for dir %s', async (dir) => {
    const r = await svc().list(dir)
    expect(r.map((s) => s.sessionId)).toEqual(['s-a2', 's-a1'])
  })
  it.runIf(win)('title = customTitle ?? summary ?? firstPrompt', async () => {
    const r = await svc().list('C:\\fixture\\proj')
    expect(r[0]).toMatchObject({ title: 'Renamed A2', cwd: 'c:\\fixture\\proj' })
    expect(r[1]).toMatchObject({ title: 'Summary A1', firstPrompt: 'first a1', gitBranch: 'main', createdAt: 900, fileSize: 10 })
    const other = await svc().list('C:/fixture/other')
    expect(other[0]?.title).toBe('only the first prompt')
  })
  it.runIf(win)('falls back to filtering the full list when dir lookup returns nothing', async () => {
    const api = fakeApi({ dirBroken: true })
    const r = await svc(api).list('C:/fixture/proj')
    expect(r).toHaveLength(2)
    expect(api.calls).toHaveLength(2)
  })
  it('returns [] for unknown project', async () => {
    expect(await svc().list('Z:\\nope')).toEqual([])
  })
})

describe('HistoryService.load', () => {
  it('maps messages to events and passes dir', async () => {
    const api = fakeApi()
    const ev = await svc(api).load('s-a1', 'C:\\fixture\\proj')
    expect(ev.some((e) => e.t === 'user_message')).toBe(true)
    expect(api.calls[0]).toMatchObject({ id: 's-a1', dir: 'C:\\fixture\\proj' })
  })
  it('retries without dir when nothing found, returns [] for unknown session', async () => {
    const api = fakeApi()
    const spy = vi.spyOn(api, 'getSessionMessages')
    expect(await svc(api).load('nope', 'C:\\x')).toEqual([])
    expect(spy).toHaveBeenCalledTimes(2)
  })
})
