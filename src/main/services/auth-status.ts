import type { AuthStatus } from '../../shared/app'
import type { CliRunner } from './claude-cli'

// WP1 implements this file (D12). WP0 freezes the signature; the stub reports 'unknown' and runs nothing.

export class AuthStatusService {
  constructor(private runner: CliRunner) {
    void this.runner
  }

  /** Cached 60 s; `refresh` bypasses the cache. Never returns account details. */
  async get(_refresh?: boolean): Promise<AuthStatus> {
    return { state: 'unknown', checkedAt: Date.now(), reason: 'not implemented' }
  }
}
