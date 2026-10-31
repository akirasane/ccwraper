import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFS, type AppPrefs, type PrefsSetResult } from '@shared/app'
import { useTerminalStore } from '@/features/terminal/terminal-store'
import { acceleratorFromEvent } from './accelerator'
import { PreferencesPage } from './PreferencesPage'

const info = {
  claudePath: 'C:\\claude\\claude.exe',
  claudeVersion: '2.1.0',
  claudeSource: 'user',
  sdkVersion: '0.2.9',
  platform: 'win32',
  trashDir: 'C:\\ud\\trash',
  version: '0.1.0',
  electronVersion: '33.0.0',
  packaged: true,
  userDataDir: 'C:\\ud'
}

let set: ReturnType<typeof vi.fn>

function setup(hotkeyError?: string) {
  set = vi.fn(async (patch: { hotkey?: { enabled?: boolean } }): Promise<PrefsSetResult> => {
    const prefs: AppPrefs = structuredClone(DEFAULT_PREFS)
    return {
      prefs,
      hotkey: {
        enabled: !!patch.hotkey?.enabled,
        registered: !hotkeyError,
        accelerator: prefs.hotkey.accelerator,
        ...(hotkeyError ? { error: hotkeyError } : {})
      }
    }
  })
  ;(window as unknown as { ccwrap: unknown }).ccwrap = {
    prefs: { get: vi.fn(async () => structuredClone(DEFAULT_PREFS)), set, onChanged: vi.fn(() => () => {}) },
    app: { info: vi.fn(async () => info) },
    update: {
      getState: vi.fn(async () => ({ kind: 'uptodate' })),
      check: vi.fn(async () => ({ kind: 'uptodate' })),
      install: vi.fn(async () => true),
      onState: vi.fn(() => () => {})
    },
    pty: { listShells: vi.fn(async () => [{ id: 'pwsh', label: 'PowerShell 7', path: 'p', isDefault: true }]) }
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <PreferencesPage />
    </QueryClientProvider>
  )
}

beforeEach(() => useTerminalStore.getState().reset())
afterEach(cleanup)

describe('acceleratorFromEvent', () => {
  const ev = (o: Partial<KeyboardEvent>) =>
    ({ key: 'a', code: 'KeyA', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...o }) as KeyboardEvent
  it('builds Control+Alt+Space', () => {
    expect(acceleratorFromEvent(ev({ key: ' ', code: 'Space', ctrlKey: true, altKey: true }))).toEqual({
      kind: 'ok',
      accelerator: 'Control+Alt+Space'
    })
  })
  it('rejects a chord without a modifier and shift alone', () => {
    expect(acceleratorFromEvent(ev({ key: 'k', code: 'KeyK' })).kind).toBe('error')
    expect(acceleratorFromEvent(ev({ key: 'K', code: 'KeyK', shiftKey: true })).kind).toBe('error')
  })
  it('treats a modifier alone as pending and maps F-keys and Win', () => {
    expect(acceleratorFromEvent(ev({ key: 'Control', ctrlKey: true })).kind).toBe('pending')
    expect(acceleratorFromEvent(ev({ key: 'F9', code: 'F9', metaKey: true, shiftKey: true }))).toEqual({
      kind: 'ok',
      accelerator: 'Shift+Super+F9'
    })
  })
})

describe('PreferencesPage', () => {
  it('toggling a pref sends the minimal patch', async () => {
    setup()
    await userEvent.click(await screen.findByTestId('notif-turnDone'))
    expect(set).toHaveBeenCalledWith({ notifications: { turnDone: false } })
    await userEvent.click(screen.getByTestId('confirm-quit'))
    expect(set).toHaveBeenLastCalledWith({ confirmQuitWhileRunning: false })
  })

  it('commits the threshold on blur, clamped', async () => {
    setup()
    const input = await screen.findByTestId('turn-done-min')
    await userEvent.clear(input)
    await userEvent.type(input, '99999')
    fireEvent.blur(input)
    expect(set).toHaveBeenCalledWith({ notifications: { turnDoneMinSeconds: 3600 } })
  })

  it('captures an accelerator and shows the hotkey registration error', async () => {
    setup('Already used by another app')
    const input = await screen.findByTestId('hotkey-input')
    input.focus()
    fireEvent.keyDown(input, { key: 'k', code: 'KeyK', ctrlKey: true, altKey: true })
    await waitFor(() => expect(set).toHaveBeenCalledWith({ hotkey: { accelerator: 'Control+Alt+K' } }))
    expect((await screen.findByTestId('hotkey-error')).textContent).toBe('Already used by another app')
  })

  it('rejects a chord without a modifier locally', async () => {
    setup()
    const input = await screen.findByTestId('hotkey-input')
    input.focus()
    fireEvent.keyDown(input, { key: 'k', code: 'KeyK' })
    expect(await screen.findByTestId('hotkey-capture-error')).toBeTruthy()
    expect(set).not.toHaveBeenCalled()
  })

  it('shows About fields and and has the usage-limit slot', async () => {
    setup()
    expect((await screen.findByTestId('about-version')).textContent).toBe('0.1.0')
    expect(screen.getByTestId('about-claude-version').textContent).toBe('2.1.0')
    expect(screen.getByTestId('about-claude-source').textContent).toBe('user')
    expect(screen.getByTestId('about-sdk').textContent).toBe('0.2.9')
    expect(screen.getByTestId('about-userdata').textContent).toBe('C:\\ud')
    expect(screen.getByTestId('about-trash').textContent).toBe('C:\\ud\\trash')
    expect(screen.getByTestId('prefs-usage-limit')).toBeTruthy()
  })

  it('Updates section: version, status, manual check and the auto toggle', async () => {
    setup()
    expect((await screen.findByTestId('update-current')).textContent).toBe('0.1.0')
    await waitFor(() => expect(screen.getByTestId('update-status').textContent).toMatch(/latest version/))
    const w = (window as unknown as { ccwrap: { update: { check: ReturnType<typeof vi.fn> } } }).ccwrap
    await userEvent.click(screen.getByTestId('update-check'))
    expect(w.update.check).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByTestId('update-auto'))
    await waitFor(() => expect(set).toHaveBeenCalledWith({ autoUpdate: false }))
  })

  it('changes the default shell via the terminal store', async () => {
    setup()
    await screen.findByTestId('default-shell')
    await waitFor(() => expect((screen.getByTestId('default-shell') as HTMLSelectElement).value).toBe('pwsh'))
    fireEvent.change(screen.getByTestId('default-shell'), { target: { value: 'pwsh' } })
    expect(useTerminalStore.getState().defaultShell).toBe('pwsh')
  })
})
