import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, MessageBoxOptions } from 'electron'
import { DEFAULT_PREFS } from '../../shared/app'
import { installQuitGuard } from './quit-guard'

vi.mock('electron', () => ({ dialog: {} }))

class FakeWin extends EventEmitter {
  closes = 0
  destroyed = false
  isDestroyed = (): boolean => this.destroyed
  /** Mimics BrowserWindow.close: emits a cancelable 'close'. */
  close(): void {
    const e = { prevented: false, preventDefault(): void { this.prevented = true } }
    this.emit('close', e)
    if (!e.prevented) this.closes++
  }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

function setup(opts: { busy: number; confirm: boolean; response?: number }) {
  const w = new FakeWin()
  const dialogs: MessageBoxOptions[] = []
  installQuitGuard(w as unknown as BrowserWindow, {
    busyCount: () => opts.busy,
    prefs: { get: () => ({ ...DEFAULT_PREFS, confirmQuitWhileRunning: opts.confirm }) },
    showDialog: async (_w, o) => {
      dialogs.push(o)
      return { response: opts.response ?? 1 }
    }
  })
  return { w, dialogs }
}

describe('quit guard', () => {
  it('busy + pref on: close prevented and the dialog asks, Cancel default', async () => {
    const { w, dialogs } = setup({ busy: 2, confirm: true })
    w.close()
    await tick()
    expect(w.closes).toBe(0)
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0]!.message).toBe('2 sessions are still working. Quit and stop them?')
    expect(dialogs[0]!.buttons).toEqual(['Quit', 'Cancel'])
    expect(dialogs[0]!.defaultId).toBe(1)
  })
  it('Cancel keeps the window open', async () => {
    const { w } = setup({ busy: 1, confirm: true, response: 1 })
    w.close()
    await tick()
    expect(w.closes).toBe(0)
  })
  it('Quit closes the window', async () => {
    const { w } = setup({ busy: 1, confirm: true, response: 0 })
    w.close()
    await tick()
    expect(w.closes).toBe(1)
  })
  it('pref off closes without asking', () => {
    const { w, dialogs } = setup({ busy: 3, confirm: false })
    w.close()
    expect(w.closes).toBe(1)
    expect(dialogs).toHaveLength(0)
  })
  it('nothing busy closes without asking', () => {
    const { w, dialogs } = setup({ busy: 0, confirm: true })
    w.close()
    expect(w.closes).toBe(1)
    expect(dialogs).toHaveLength(0)
  })
  it('repeated close while the dialog is open asks once', async () => {
    const { w, dialogs } = setup({ busy: 1, confirm: true })
    w.close()
    w.close()
    await tick()
    expect(dialogs).toHaveLength(1)
  })
})
