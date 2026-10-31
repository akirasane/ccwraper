import { afterEach, describe, expect, it, vi } from 'vitest'
import { IpcChannels } from '../../shared/ipc'

const handlers = new Map<string, (e: unknown, raw?: unknown) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (e: unknown, raw?: unknown) => unknown) => void handlers.set(ch, fn),
    removeHandler: (ch: string) => void handlers.delete(ch)
  }
}))

import { registerCavemanIpc, registerLimitsIpc } from './statusbar'

afterEach(() => handlers.clear())

describe('status bar IPC', () => {
  it('limits:get returns the service state, ignores arguments and disposes', () => {
    const getState = vi.fn(() => ({ limits: [] }))
    const off = registerLimitsIpc({ getState })
    expect(handlers.get(IpcChannels.limitsGet)!({}, { junk: 1 })).toEqual({ limits: [] })
    expect(getState).toHaveBeenCalledWith()
    off()
    expect(handlers.size).toBe(0)
  })

  it('caveman:get refreshes first and returns the state', async () => {
    const refresh = vi.fn(async () => ({ mode: 'ultra', suffix: 'saved 1k' }))
    const off = registerCavemanIpc({ refresh })
    expect(await handlers.get(IpcChannels.cavemanGet)!({}, 'x')).toEqual({ mode: 'ultra', suffix: 'saved 1k' })
    off()
    expect(handlers.size).toBe(0)
  })

  it('uses the documented channel names', () => {
    expect([IpcChannels.limitsState, IpcChannels.limitsGet, IpcChannels.cavemanState, IpcChannels.cavemanGet]).toEqual([
      'limits:state',
      'limits:get',
      'caveman:state',
      'caveman:get'
    ])
  })
})
