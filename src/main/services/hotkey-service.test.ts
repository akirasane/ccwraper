import { describe, expect, it, vi } from 'vitest'
import { HotkeyService } from './hotkey-service'

function fakeWindow() {
  const win = {
    focused: false,
    minimized: false,
    isFocused: () => win.focused,
    isMinimized: () => win.minimized,
    isDestroyed: () => false,
    minimize: vi.fn(),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn()
  }
  return win
}

function setup(registerImpl?: (a: string, h: () => void) => boolean) {
  const win = fakeWindow()
  const handlers = new Map<string, () => void>()
  const register = vi.fn(
    registerImpl ??
      ((a: string, h: () => void) => {
        handlers.set(a, h)
        return true
      })
  )
  const unregister = vi.fn((a: string) => void handlers.delete(a))
  const svc = new HotkeyService({ getWindow: () => win as never, register, unregister })
  return { svc, win, register, unregister, handlers }
}

const on = (accelerator: string) => ({ enabled: true, accelerator })

describe('HotkeyService', () => {
  it('is off by default: disabled prefs never register', () => {
    const s = setup()
    expect(s.svc.status()).toEqual({ enabled: false, registered: false, accelerator: '' })
    expect(s.svc.apply({ enabled: false, accelerator: 'Control+Alt+Space' })).toEqual({
      enabled: false, registered: false, accelerator: 'Control+Alt+Space'
    })
    expect(s.register).not.toHaveBeenCalled()
  })

  it('registers when enabled', () => {
    const s = setup()
    expect(s.svc.apply(on('Control+Alt+Space'))).toEqual({ enabled: true, registered: true, accelerator: 'Control+Alt+Space' })
    expect(s.svc.status().registered).toBe(true)
  })

  it('conflict (false) is reported as an error, not thrown', () => {
    const s = setup(() => false)
    const st = s.svc.apply(on('Control+Alt+Space'))
    expect(st).toMatchObject({ enabled: true, registered: false, error: 'Already used by another app' })
  })

  it('invalid accelerator (throws) is reported as an error', () => {
    const s = setup(() => {
      throw new Error('bad')
    })
    const st = s.svc.apply(on('Nope+++'))
    expect(st).toMatchObject({ registered: false, error: 'Not a valid shortcut' })
  })

  it('apply unregisters the previous chord first, and disabling releases it', () => {
    const s = setup()
    s.svc.apply(on('Control+Alt+A'))
    s.svc.apply(on('Control+Alt+B'))
    expect(s.unregister).toHaveBeenCalledWith('Control+Alt+A')
    expect(s.unregister.mock.invocationCallOrder[0]!).toBeLessThan(s.register.mock.invocationCallOrder[1]!)
    s.svc.apply({ enabled: false, accelerator: 'Control+Alt+B' })
    expect(s.unregister).toHaveBeenLastCalledWith('Control+Alt+B')
    expect(s.handlers.size).toBe(0)
  })

  it('a failed registration does not leave something to unregister', () => {
    const s = setup(() => false)
    s.svc.apply(on('Control+Alt+A'))
    s.svc.apply(on('Control+Alt+B'))
    expect(s.unregister).not.toHaveBeenCalled()
  })

  it('toggle: focused -> minimize', () => {
    const s = setup()
    s.svc.apply(on('X'))
    s.win.focused = true
    s.handlers.get('X')!()
    expect(s.win.minimize).toHaveBeenCalled()
    expect(s.win.focus).not.toHaveBeenCalled()
  })

  it('toggle: unfocused -> restore (if minimized), show, focus', () => {
    const s = setup()
    s.svc.apply(on('X'))
    s.win.minimized = true
    s.handlers.get('X')!()
    expect(s.win.restore).toHaveBeenCalled()
    expect(s.win.show).toHaveBeenCalled()
    expect(s.win.focus).toHaveBeenCalled()
    s.win.restore.mockClear()
    s.win.minimized = false
    s.handlers.get('X')!()
    expect(s.win.restore).not.toHaveBeenCalled()
  })

  it('dispose unregisters', () => {
    const s = setup()
    s.svc.apply(on('X'))
    s.svc.dispose()
    expect(s.unregister).toHaveBeenCalledWith('X')
    expect(s.svc.status().registered).toBe(false)
  })
})
