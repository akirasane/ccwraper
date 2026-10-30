import type { AutoResumeReport } from '../../shared/app'

export interface PowerSave {
  start(type: 'prevent-app-suspension'): number
  stop(id: number): void
}

export interface AutoResumeMainDeps {
  /** Electron's powerSaveBlocker (injected for tests). */
  powerSave: PowerSave
  /** Native toast; content is built by the notification service (tab title and times only). */
  announce: (r: AutoResumeReport) => void
}

/**
 * Main-side half of WP14. The renderer owns the pauses and timers; main keeps the machine awake while at least one
 * pause is pending (`prevent-app-suspension`, released as soon as none is) and shows the native toasts.
 */
export class AutoResumeMain {
  private blocker: number | undefined

  constructor(private deps: AutoResumeMainDeps) {}

  report(r: AutoResumeReport): void {
    this.syncBlocker(r.pending)
    if (r.kind === 'paused' || r.kind === 'resumed') {
      try {
        this.deps.announce(r)
      } catch {
        /* notifications are best effort */
      }
    }
  }

  get holdingAwake(): boolean {
    return this.blocker !== undefined
  }

  private syncBlocker(pending: number): void {
    if (pending > 0 && this.blocker === undefined) {
      try {
        this.blocker = this.deps.powerSave.start('prevent-app-suspension')
      } catch {
        this.blocker = undefined
      }
    } else if (pending <= 0 && this.blocker !== undefined) {
      this.release()
    }
  }

  private release(): void {
    const id = this.blocker
    this.blocker = undefined
    if (id === undefined) return
    try {
      this.deps.powerSave.stop(id)
    } catch {
      /* already released */
    }
  }

  dispose(): void {
    this.release()
  }
}
