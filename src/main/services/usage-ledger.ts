import type { SessionEvent } from '../../shared/events'

// WP3 implements this file (D5). WP0 freezes the signature; the stub writes nothing.

export class UsageLedger {
  constructor(private file: string) {
    void this.file
  }
  /** Appends the per-model cost delta on each `result`. `info` is SessionManager.info(localId). */
  onSessionEvent(_localId: string, _e: SessionEvent, _info: { cwd: string; sdkSessionId?: string } | undefined): void {}
}
