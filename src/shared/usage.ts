// P4 usage dashboard contracts (D5). Plain data; zod-free.

export interface UsageTokens {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

export type UsageRangeDays = 7 | 30 | 90 | 365

export interface UsageQuery {
  days: UsageRangeDays
  cwd?: string
  force?: boolean
}

export interface UsageDay {
  /** YYYY-MM-DD, local calendar date */
  date: string
  tokens: UsageTokens
  /** total tokens per model */
  byModel: Record<string, number>
  costUsd: number
  sessions: number
}

export interface UsageProject {
  key: string
  cwd: string
  tokens: UsageTokens
  costUsd: number
  sessions: number
  lastActive: number
}

export interface UsageModel {
  model: string
  tokens: UsageTokens
  costUsd: number
}

export interface UsageSummary {
  from: string
  to: string
  /** every date in range, zero-filled */
  days: UsageDay[]
  /** sorted by total tokens desc */
  projects: UsageProject[]
  models: UsageModel[]
  totals: { tokens: UsageTokens; costUsd: number; sessions: number; messages: number }
  /** first ledger date; `since` undefined = no in-app sessions yet */
  cost: { source: 'ledger'; since?: string }
  scan: { files: number; cachedFiles: number; skippedFiles: number; bytesRead: number; ms: number; errors: number }
  generatedAt: number
}
