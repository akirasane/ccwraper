import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFS, type AppPrefs } from '@shared/app'
import type { CavemanState, LimitEntry, LimitsState } from '@shared/limits'
import { StatusBar } from '@/app/shell/StatusBar'

const T0 = Date.parse('2026-10-31T10:00:00Z')

let limitsPush: ((s: LimitsState) => void) | undefined
let cavemanPush: ((s: CavemanState) => void) | undefined

const entry = (o: Partial<LimitEntry> & Pick<LimitEntry, 'type'>): LimitEntry => ({
  status: 'allowed',
  seenAt: T0,
  stale: false,
  ...o
})

function mount(opts: { limits?: LimitEntry[]; caveman?: CavemanState; prefs?: Partial<AppPrefs> } = {}) {
  limitsPush = undefined
  cavemanPush = undefined
  const prefs: AppPrefs = { ...structuredClone(DEFAULT_PREFS), ...opts.prefs }
  ;(window as unknown as { ccwrap: unknown }).ccwrap = {
    app: { info: vi.fn(async () => ({ claudeVersion: '2.1.0', claudeSource: 'user' })) },
    prefs: { get: vi.fn(async () => prefs), onChanged: vi.fn(() => () => {}) },
    limits: {
      getState: vi.fn(async () => ({ limits: opts.limits ?? [] })),
      onState: vi.fn((cb: (s: LimitsState) => void) => {
        limitsPush = cb
        return () => {}
      })
    },
    caveman: {
      getState: vi.fn(async () => opts.caveman ?? { mode: null, suffix: null }),
      onState: vi.fn((cb: (s: CavemanState) => void) => {
        cavemanPush = cb
        return () => {}
      })
    }
  }
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <StatusBar />
    </QueryClientProvider>
  )
}

beforeEach(() => vi.useFakeTimers({ now: T0, toFake: ['Date', 'setInterval', 'clearInterval'] }))
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const settle = async (): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5)
  })
}

describe('StatusBar usage limits', () => {
  it('shows "--" placeholders and the first-message hint when nothing has arrived', async () => {
    mount()
    await settle()
    const box = screen.getByTestId('status-limits')
    expect(box).toHaveAttribute('data-empty')
    expect(box.textContent).toMatch(/5h --\s*7d --/)
    expect(box.getAttribute('aria-label')).toMatch(/Updates after the first message of a session/)
  })

  it('renders bar, percent and countdown for both windows', async () => {
    mount({
      limits: [
        entry({ type: 'five_hour', usedPercent: 42, resetsAt: T0 + 83 * 60_000 }),
        entry({ type: 'seven_day', usedPercent: 12, resetsAt: T0 + (2 * 24 + 4) * 3_600_000 })
      ]
    })
    await settle()
    expect(screen.getByTestId('limit-five_hour-pct')).toHaveTextContent('42%')
    expect(screen.getByTestId('limit-five_hour-reset')).toHaveTextContent('1h23m')
    expect(screen.getByTestId('limit-seven_day-pct')).toHaveTextContent('12%')
    expect(screen.getByTestId('limit-seven_day-reset')).toHaveTextContent('2d4h')
    const meter = screen.getByRole('meter', { name: '5-hour limit used' })
    expect(meter).toHaveAttribute('aria-valuenow', '42')
    expect(meter).toHaveAttribute('aria-valuemax', '100')
    expect(screen.getByTestId('limit-five_hour-fill')).toHaveStyle({ width: '42%' })
  })

  it('colors ok < 70, warn 70-90, danger >= 90', async () => {
    mount({
      limits: [entry({ type: 'five_hour', usedPercent: 69 }), entry({ type: 'seven_day', usedPercent: 70 })]
    })
    await settle()
    expect(screen.getByTestId('limit-five_hour')).toHaveAttribute('data-level', 'ok')
    expect(screen.getByTestId('limit-five_hour-fill').className).toMatch(/bg-ok/)
    expect(screen.getByTestId('limit-seven_day')).toHaveAttribute('data-level', 'warn')
    expect(screen.getByTestId('limit-seven_day-fill').className).toMatch(/bg-warn/)
    act(() => limitsPush!({ limits: [entry({ type: 'five_hour', usedPercent: 90 }), entry({ type: 'seven_day', usedPercent: 89 })] }))
    expect(screen.getByTestId('limit-five_hour')).toHaveAttribute('data-level', 'danger')
    expect(screen.getByTestId('limit-five_hour-fill').className).toMatch(/bg-danger/)
    expect(screen.getByTestId('limit-seven_day')).toHaveAttribute('data-level', 'warn')
  })

  it('marks restored values as stale with the last-seen time, in the accessible label', async () => {
    mount({ limits: [entry({ type: 'five_hour', usedPercent: 30, resetsAt: T0 + 600_000, stale: true, seenAt: T0 - 3_600_000 })] })
    await settle()
    expect(screen.getByTestId('limit-five_hour')).toHaveAttribute('data-stale', 'true')
    expect(screen.getByRole('meter', { name: '5-hour limit used' }).getAttribute('aria-valuetext')).toMatch(/last seen \d\d:\d\d/)
  })

  it('shows 0% and "reset" once the reset time has passed, and the countdown ticks', async () => {
    mount({ limits: [entry({ type: 'five_hour', usedPercent: 95, resetsAt: T0 + 90_000, stale: true })] })
    await settle()
    expect(screen.getByTestId('limit-five_hour-reset')).toHaveTextContent('1m')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(95_000)
    })
    expect(screen.getByTestId('limit-five_hour-pct')).toHaveTextContent('0%')
    expect(screen.getByTestId('limit-five_hour-reset')).toHaveTextContent('reset')
    expect(screen.getByTestId('limit-five_hour')).toHaveAttribute('data-expired', 'true')
    expect(screen.getByTestId('limit-five_hour')).not.toHaveAttribute('data-stale')
  })

  it('updates when main pushes a new state', async () => {
    mount()
    await settle()
    act(() => limitsPush!({ limits: [entry({ type: 'five_hour', usedPercent: 10, resetsAt: T0 + 3_600_000 })] }))
    expect(screen.getByTestId('limit-five_hour-pct')).toHaveTextContent('10%')
    expect(screen.getByTestId('limit-seven_day')).toHaveAttribute('data-empty')
  })

  it('is hidden when showLimitsBar is off', async () => {
    mount({ prefs: { showLimitsBar: false }, limits: [entry({ type: 'five_hour', usedPercent: 10 })] })
    await settle()
    await waitFor(() => expect(screen.queryByTestId('status-limits')).toBeNull())
  })

  it('does not wrap: nowrap on the bar and no fixed width that grows with text', async () => {
    mount({ limits: [entry({ type: 'five_hour', usedPercent: 10 })] })
    await settle()
    expect(screen.getByTestId('status-bar').className).toMatch(/whitespace-nowrap/)
    expect(screen.getByTestId('status-limits').className).toMatch(/whitespace-nowrap/)
  })
})

describe('StatusBar caveman badge', () => {
  it('shows CAVEMAN for full and CAVEMAN:ULTRA with the suffix verbatim', async () => {
    mount({ caveman: { mode: 'full', suffix: null } })
    await settle()
    expect(screen.getByTestId('status-caveman')).toHaveTextContent(/^CAVEMAN$/)
    act(() => cavemanPush!({ mode: 'ultra', suffix: 'saved 12.3k tokens' }))
    expect(screen.getByTestId('status-caveman')).toHaveTextContent('CAVEMAN:ULTRA')
    expect(screen.getByTestId('status-caveman-suffix')).toHaveTextContent('saved 12.3k tokens')
    expect(screen.getByTestId('status-caveman').className).toMatch(/text-accent-text/)
  })

  it('is hidden when the mode is missing or off, and when the pref is off', async () => {
    mount({ caveman: { mode: null, suffix: 'saved 1k' } })
    await settle()
    expect(screen.queryByTestId('status-caveman')).toBeNull()
    cleanup()
    mount({ prefs: { showCavemanBadge: false }, caveman: { mode: 'ultra', suffix: null } })
    await settle()
    await waitFor(() => expect(screen.queryByTestId('status-caveman')).toBeNull())
  })

  it('disappears when the plugin goes off', async () => {
    mount({ caveman: { mode: 'ultra', suffix: 'x' } })
    await settle()
    expect(screen.getByTestId('status-caveman')).toBeInTheDocument()
    act(() => cavemanPush!({ mode: null, suffix: null }))
    expect(screen.queryByTestId('status-caveman')).toBeNull()
  })
})
