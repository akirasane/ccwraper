import { afterEach, describe, expect, it, vi } from 'vitest'
import { IpcChannels } from '../../shared/ipc'

const handlers = new Map<string, (e: unknown, raw?: unknown) => unknown>()
vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (e: unknown, raw?: unknown) => unknown) => void handlers.set(ch, fn),
    removeHandler: (ch: string) => void handlers.delete(ch)
  }
}))

import { registerUpdateIpc } from './update'

afterEach(() => handlers.clear())

describe('update IPC', () => {
  it('forwards getState, check and install, ignores arguments, and disposes', async () => {
    const getState = vi.fn(() => ({ kind: 'idle' as const }))
    const check = vi.fn(async () => ({ kind: 'uptodate' as const }))
    const installNow = vi.fn(() => true)
    const off = registerUpdateIpc({ getState, check, installNow })
    expect(handlers.get(IpcChannels.updateGetState)!({}, { junk: 1 })).toEqual({ kind: 'idle' })
    expect(await handlers.get(IpcChannels.updateCheck)!({}, 'x')).toEqual({ kind: 'uptodate' })
    expect(handlers.get(IpcChannels.updateInstall)!({})).toBe(true)
    expect(check).toHaveBeenCalledWith()
    off()
    expect(handlers.size).toBe(0)
  })

  it('uses the documented channel names', () => {
    expect([IpcChannels.updateState, IpcChannels.updateCheck, IpcChannels.updateInstall, IpcChannels.updateGetState]).toEqual([
      'update:state',
      'update:check',
      'update:install',
      'update:getState'
    ])
  })
})
