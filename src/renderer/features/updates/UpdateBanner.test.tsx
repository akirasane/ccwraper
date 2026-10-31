import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '@shared/app'
import { UpdateBanner } from './UpdateBanner'

let push: (s: UpdateState) => void
let install: ReturnType<typeof vi.fn>

function setup(initial: UpdateState): void {
  install = vi.fn(async () => true)
  ;(window as unknown as { ccwrap: unknown }).ccwrap = {
    update: {
      getState: vi.fn(async () => initial),
      check: vi.fn(),
      install,
      onState: vi.fn((cb: (s: UpdateState) => void) => {
        push = cb
        return () => {}
      })
    }
  }
  render(<UpdateBanner />)
}

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

describe('UpdateBanner', () => {
  it('renders nothing for disabled, idle, uptodate and error states', async () => {
    setup({ kind: 'uptodate' })
    await act(async () => {})
    expect(screen.queryByTestId('update-banner')).toBeNull()
    act(() => push({ kind: 'error', message: 'x' }))
    expect(screen.queryByTestId('update-banner')).toBeNull()
  })

  it('shows download progress, then Restart to update which calls install', async () => {
    setup({ kind: 'downloading', version: '0.6.0', percent: 42 })
    expect((await screen.findByTestId('update-banner-text')).textContent).toBe('Update v0.6.0 downloading 42%')
    expect(screen.queryByTestId('update-banner-install')).toBeNull()
    act(() => push({ kind: 'ready', version: '0.6.0' }))
    await userEvent.click(screen.getByRole('button', { name: 'Restart to update' }))
    expect(install).toHaveBeenCalledTimes(1)
  })

  it('dismisses per version and shows again for a newer one', async () => {
    setup({ kind: 'ready', version: '0.6.0' })
    await userEvent.click(await screen.findByTestId('update-banner-dismiss'))
    expect(screen.queryByTestId('update-banner')).toBeNull()
    expect(window.localStorage.getItem('ccwrap.update.dismissed')).toBe('0.6.0')
    act(() => push({ kind: 'downloading', version: '0.6.0', percent: 100 }))
    expect(screen.queryByTestId('update-banner')).toBeNull()
    act(() => push({ kind: 'ready', version: '0.7.0' }))
    await waitFor(() => expect(screen.getByTestId('update-banner-text').textContent).toContain('v0.7.0'))
  })
})
