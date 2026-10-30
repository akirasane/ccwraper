import type { UsageDay, UsageQuery, UsageSummary } from '../../shared/usage'

// WP3 implements this file (D5). WP0 freezes the signature; the stub returns an empty, zero-filled summary.

export interface UsageServiceDeps {
  /** `<configDir>/projects` */
  root: string
  cacheFile: string
  ledgerFile: string
}

function localDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export class UsageService {
  constructor(private deps: UsageServiceDeps) {
    void this.deps
  }

  async summary(q: UsageQuery): Promise<UsageSummary> {
    const today = new Date()
    const days: UsageDay[] = []
    for (let i = q.days - 1; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
      days.push({
        date: localDate(d),
        tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
        byModel: {},
        costUsd: 0,
        sessions: 0
      })
    }
    return {
      from: days[0]!.date,
      to: days[days.length - 1]!.date,
      days,
      projects: [],
      models: [],
      totals: { tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, sessions: 0, messages: 0 },
      cost: { source: 'ledger' },
      scan: { files: 0, cachedFiles: 0, skippedFiles: 0, bytesRead: 0, ms: 0, errors: 0 },
      generatedAt: Date.now()
    }
  }
}
