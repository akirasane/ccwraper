import type { AuthStatus } from '../../shared/app'
import type { CliRunner } from './claude-cli'

// D12. Runs `claude auth status --json`, maps it to a 3-state enum and drops EVERY other field
// (email, org, directories) before the value leaves this file. Logged-out shape, learned in a sandbox
// CLAUDE_CONFIG_DIR: exit code 1 and { loggedIn: false, authMethod: "none", apiProvider, ... }.

const TTL_MS = 60_000
const TIMEOUT_MS = 10_000

type Mapped = Pick<AuthStatus, 'state' | 'method' | 'reason'>

function boolish(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    if (['true', 'yes', '1'].includes(s)) return true
    if (['false', 'no', '0'].includes(s)) return false
  }
  return undefined
}

function methodOf(raw: unknown): AuthStatus['method'] | 'none' | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim().toLowerCase()
  if (!s) return undefined
  if (s === 'none') return 'none'
  if (/api[_ -]?key/.test(s)) return 'api_key'
  if (/claude\.?ai|subscription|oauth|max|pro|team|enterprise/.test(s)) return 'subscription'
  return 'other'
}

/** Tolerant mapper: unknown shapes give 'unknown'. Exported for tests. */
export function mapAuthStatus(stdout: string): Mapped {
  let json: unknown
  try {
    json = JSON.parse(stdout)
  } catch {
    return { state: 'unknown', reason: 'unparsable output' }
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) return { state: 'unknown', reason: 'unexpected output' }
  const o = json as Record<string, unknown>
  const flag = boolish(o['loggedIn'] ?? o['logged_in'] ?? o['isLoggedIn'] ?? o['authenticated'] ?? o['signedIn'])
  const method = methodOf(o['authMethod'] ?? o['auth_method'] ?? o['method'])
  if (flag === true) return { state: 'signed_in', ...(method && method !== 'none' ? { method } : {}) }
  if (flag === false) return { state: 'signed_out' }
  if (method === 'none') return { state: 'signed_out' }
  if (method) return { state: 'signed_in', method }
  return { state: 'unknown', reason: 'unrecognized shape' }
}

export class AuthStatusService {
  private cache: AuthStatus | undefined
  private inflight: Promise<AuthStatus> | undefined

  constructor(
    private runner: CliRunner,
    private opts: { env?: NodeJS.ProcessEnv; cwd?: string; now?: () => number } = {}
  ) {}

  /** Cached 60 s; `refresh` bypasses the cache. Never returns account details. */
  async get(refresh?: boolean): Promise<AuthStatus> {
    const now = this.opts.now ?? Date.now
    if (!refresh && this.cache && now() - this.cache.checkedAt < TTL_MS) return this.cache
    if (this.inflight) return this.inflight
    const p = this.run(now).finally(() => {
      this.inflight = undefined
    })
    this.inflight = p
    return p
  }

  private async run(now: () => number): Promise<AuthStatus> {
    let status: AuthStatus
    try {
      const res = await this.runner(['auth', 'status', '--json'], {
        cwd: this.opts.cwd ?? process.cwd(),
        ...(this.opts.env ? { env: this.opts.env } : {}),
        timeoutMs: TIMEOUT_MS
      })
      // A logged-out CLI exits 1 but still prints JSON, so parse stdout whatever the exit code.
      if (!res.stdout.trim()) {
        status = { state: 'unknown', checkedAt: now(), reason: res.code === -1 ? 'claude unavailable or timed out' : 'no output' }
      } else {
        const m = mapAuthStatus(res.stdout)
        status = {
          state: m.state,
          ...(m.method ? { method: m.method } : {}),
          checkedAt: now(),
          ...(m.reason ? { reason: m.reason } : {})
        }
      }
    } catch {
      status = { state: 'unknown', checkedAt: now(), reason: 'check failed' }
    }
    this.cache = status
    return status
  }
}
