import { existsSync } from 'node:fs'
import type { HistorySessionInfo, ProjectInfo, SessionEvent } from '../../shared/events'
import { normalizeCwdKey } from '../paths'
import { loadSdkHistory, mapHistoryMessages, type HistoryApi, type RawSessionInfo } from './sdk-history'

export interface HistoryServiceDeps {
  api?: () => Promise<HistoryApi>
  exists?: (p: string) => boolean
}

function toInfo(s: RawSessionInfo, cwd: string): HistorySessionInfo {
  const info: HistorySessionInfo = {
    sessionId: s.sessionId,
    title: s.customTitle || s.summary || s.firstPrompt || s.sessionId,
    cwd,
    lastModified: s.lastModified
  }
  if (s.firstPrompt) info.firstPrompt = s.firstPrompt
  if (s.gitBranch) info.gitBranch = s.gitBranch
  if (s.createdAt != null) info.createdAt = s.createdAt
  if (s.fileSize != null) info.fileSize = s.fileSize
  return info
}

export class HistoryService {
  private apiP?: Promise<HistoryApi>
  private readonly getApi: () => Promise<HistoryApi>
  private readonly exists: (p: string) => boolean

  constructor(deps: HistoryServiceDeps = {}) {
    const loader = deps.api ?? loadSdkHistory
    this.getApi = () => (this.apiP ??= loader())
    this.exists = deps.exists ?? existsSync
  }

  /** Distinct projects derived from all sessions, grouped by normalized cwd, newest first. */
  async listProjects(): Promise<ProjectInfo[]> {
    const api = await this.getApi()
    const all = await api.listSessions()
    const groups = new Map<string, ProjectInfo>()
    for (const s of all) {
      if (!s.cwd) continue
      const key = normalizeCwdKey(s.cwd)
      const g = groups.get(key)
      if (!g) {
        groups.set(key, { key, cwd: s.cwd, exists: false, sessionCount: 1, lastModified: s.lastModified })
      } else {
        g.sessionCount++
        if (s.lastModified > g.lastModified) {
          g.lastModified = s.lastModified
          g.cwd = s.cwd // display the most recent spelling
        }
      }
    }
    const out = [...groups.values()]
    for (const p of out) p.exists = this.exists(p.cwd)
    return out.sort((a, b) => b.lastModified - a.lastModified)
  }

  /** Sessions of one project (any slash form / drive-letter case), newest first. */
  async list(cwd: string): Promise<HistorySessionInfo[]> {
    const api = await this.getApi()
    const key = normalizeCwdKey(cwd)
    const match = (s: RawSessionInfo): s is RawSessionInfo & { cwd: string } =>
      !!s.cwd && normalizeCwdKey(s.cwd) === key
    let rows: Array<RawSessionInfo & { cwd: string }> = []
    try {
      rows = (await api.listSessions({ dir: cwd, includeWorktrees: false })).filter(match)
    } catch {
      /* fall through to the full scan */
    }
    if (rows.length === 0) rows = (await api.listSessions()).filter(match)
    return rows.map((s) => toInfo(s, s.cwd)).sort((a, b) => b.lastModified - a.lastModified)
  }

  /** Replayable events for one past session. */
  async load(sessionId: string, cwd?: string): Promise<SessionEvent[]> {
    const api = await this.getApi()
    let msgs = await api.getSessionMessages(sessionId, cwd ? { dir: cwd } : undefined)
    if (msgs.length === 0 && cwd) msgs = await api.getSessionMessages(sessionId)
    return mapHistoryMessages(msgs)
  }
}
