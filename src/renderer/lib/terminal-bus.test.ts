import { beforeEach, describe, expect, it, vi } from 'vitest'
import { onRunInTerminal, requestRunInTerminal, resetTerminalBus, setTerminalOpener } from './terminal-bus'

beforeEach(() => resetTerminalBus())

describe('terminal-bus', () => {
  it('delivers a request to subscribers and stops after unsubscribe', () => {
    const cb = vi.fn()
    const off = onRunInTerminal(cb)
    requestRunInTerminal({ cwd: 'C:\\p', command: 'ls' })
    expect(cb).toHaveBeenCalledWith({ cwd: 'C:\\p', command: 'ls' })
    off()
    requestRunInTerminal({ cwd: 'C:\\p', command: 'pwd' })
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('holds a request made before the panel subscribes and delivers it once', () => {
    requestRunInTerminal({ cwd: 'C:\\p', command: 'early' })
    const a = vi.fn()
    onRunInTerminal(a)
    expect(a).toHaveBeenCalledWith({ cwd: 'C:\\p', command: 'early' })
    const b = vi.fn()
    onRunInTerminal(b)
    expect(b).not.toHaveBeenCalled()
  })

  it('calls the shell opener on every request', () => {
    const open = vi.fn()
    setTerminalOpener(open)
    requestRunInTerminal({ cwd: 'C:\\p', command: 'x' })
    expect(open).toHaveBeenCalledTimes(1)
  })
})
