/// <reference types="node" />
import { QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UsageSummary } from '@shared/usage'
import { createQueryClient } from '@/lib/query-client'
import { UsagePage } from './UsagePage'

const tok = (input: number, output: number, cacheRead = 0, cacheCreation = 0) => ({
  input,
  output,
  cacheRead,
  cacheCreation
})

function fixture(over: Partial<UsageSummary> = {}): UsageSummary {
  return {
    from: '2026-10-28',
    to: '2026-10-30',
    days: [
      { date: '2026-10-28', tokens: tok(0, 0), byModel: {}, costUsd: 0, sessions: 0 },
      { date: '2026-10-29', tokens: tok(100, 200, 300, 400), byModel: { 'model-a': 1000 }, costUsd: 1, sessions: 1 },
      { date: '2026-10-30', tokens: tok(50, 100, 150, 200), byModel: { 'model-a': 300, 'model-b': 200 }, costUsd: 0.5, sessions: 2 }
    ],
    projects: [
      { key: 'p1', cwd: 'C:\\work\\alpha', tokens: tok(100, 200, 300, 400), costUsd: 1, sessions: 1, lastActive: 1 },
      { key: 'p2', cwd: 'C:\\work\\beta', tokens: tok(50, 100, 150, 200), costUsd: 0.5, sessions: 2, lastActive: 2 }
    ],
    models: [
      { model: 'model-a', tokens: tok(120, 240, 360, 580), costUsd: 1.25 },
      { model: 'model-b', tokens: tok(30, 60, 90, 20), costUsd: 0.25 }
    ],
    totals: { tokens: tok(150, 300, 450, 600), costUsd: 1.5, sessions: 3, messages: 42 },
    cost: { source: 'ledger', since: '2026-10-01' },
    scan: { files: 12, cachedFiles: 10, skippedFiles: 0, bytesRead: 1, ms: 87, errors: 0 },
    generatedAt: 1,
    ...over
  }
}

const summary = vi.fn()

function setup(cwd?: string) {
  const client = createQueryClient()
  return render(
    <QueryClientProvider client={client}>
      <UsagePage {...(cwd ? { cwd } : {})} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  summary.mockReset()
  summary.mockResolvedValue(fixture())
  ;(window as unknown as { ccwrap: unknown }).ccwrap = { usage: { summary } }
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number) as typeof window.requestAnimationFrame
})

describe('UsagePage', () => {
  it('shows a loading state, then KPIs with the est. API value label', async () => {
    summary.mockReturnValue(new Promise(() => undefined))
    setup()
    expect(screen.getByRole('status')).toHaveTextContent(/scanning/i)
  })

  it('renders KPIs, cost note and footnote', async () => {
    setup()
    const kpi = await screen.findByTestId('kpi-cost')
    expect(kpi).toHaveTextContent('Est. API value (not billed)')
    expect(kpi).toHaveTextContent('$1.50')
    expect(kpi).toHaveTextContent('since 2026-10-01')
    expect(screen.getByTestId('kpi-tokens')).toHaveTextContent('1.5k')
    expect(screen.getByTestId('kpi-messages')).toHaveTextContent('42')
    expect(screen.getByText(/not a bill/i)).toBeInTheDocument()
    expect(screen.getByTestId('scan-footer')).toHaveTextContent('12 files (10 cached)')
  })

  it('shows the empty cost note when there is no ledger', async () => {
    summary.mockResolvedValue(fixture({ cost: { source: 'ledger' } }))
    setup()
    expect(await screen.findByTestId('kpi-cost')).toHaveTextContent('No in-app sessions yet')
  })

  it('shows an empty state with no tokens', async () => {
    summary.mockResolvedValue(fixture({ totals: { tokens: tok(0, 0), costUsd: 0, sessions: 0, messages: 0 } }))
    setup()
    expect(await screen.findByText('No usage in this range')).toBeInTheDocument()
  })

  it('draws bars with the right scaleY and chart-token classes', async () => {
    setup()
    await screen.findByTestId('kpi-row')
    const segs = screen.getAllByTestId('bar-segment')
    // day 29: total 1000 is the max (nice max 1000 -> output 200/1000)
    const out = segs.find((s) => s.getAttribute('data-series') === 'output' && s.getAttribute('data-value') === '200')!
    expect(out.getAttribute('data-scale-y')).toBe('0.2000')
    expect(out.getAttribute('class')).toContain('fill-chart-1')
    expect(segs.find((s) => s.getAttribute('data-series') === 'input')!.getAttribute('class')).toContain('fill-chart-2')
    expect(segs.find((s) => s.getAttribute('data-series') === 'cacheCreation')!.getAttribute('class')).toContain('fill-chart-5')
    expect(out.getAttribute('class')).toContain('motion-reduce:transition-none')
  })

  it('Table toggle shows the same numbers', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByTestId('kpi-row')
    await user.click(screen.getAllByRole('button', { name: 'Table' })[0]!)
    const table = screen.getByRole('table', { name: 'Tokens per day' })
    const row = within(table).getByRole('row', { name: /2026-10-29/ })
    expect(row).toHaveTextContent('200')
    expect(row).toHaveTextContent('1,000')
  })

  it('shows the tooltip on hover and on keyboard focus', async () => {
    setup()
    await screen.findByTestId('kpi-row')
    const groups = screen.getAllByTestId('bar-group')
    fireEvent.mouseEnter(groups[1]!)
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('1,000 tokens')
    fireEvent.mouseLeave(groups[1]!.closest('div')!)
    expect(screen.queryByTestId('chart-tooltip')).toBeNull()
    fireEvent.focus(groups[2]!)
    expect(screen.getByTestId('chart-tooltip')).toHaveTextContent('500 tokens')
    expect(screen.getByTestId('chart-tooltip').className).not.toContain('pointer-events-auto')
    expect(groups[2]!.getAttribute('tabindex')).toBe('0')
  })

  it('stacks by model', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByTestId('kpi-row')
    await user.click(screen.getByRole('radio', { name: 'By model' }))
    const segs = screen.getAllByTestId('bar-segment')
    expect(segs.some((s) => s.getAttribute('data-series') === 'model-a')).toBe(true)
    expect(segs.some((s) => s.getAttribute('data-series') === 'output')).toBe(false)
  })

  it('changes the range and project filter', async () => {
    const user = userEvent.setup()
    setup('C:\\work\\alpha')
    await screen.findByTestId('kpi-row')
    await user.click(screen.getByRole('radio', { name: '90 days' }))
    await user.click(screen.getByRole('radio', { name: 'Current project' }))
    await waitFor(() => expect(summary).toHaveBeenLastCalledWith({ days: 90, cwd: 'C:\\work\\alpha' }))
  })

  it('Rescan forces', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByTestId('kpi-row')
    await user.click(screen.getByRole('button', { name: 'Rescan transcripts' }))
    await waitFor(() => expect(summary).toHaveBeenLastCalledWith({ days: 30, force: true }))
  })

  it('models table labels the cost column and shows bars', async () => {
    setup()
    await screen.findByTestId('kpi-row')
    const table = screen.getByRole('table', { name: /by model/i })
    expect(within(table).getByRole('columnheader', { name: /Est\. API value \(not billed\)/ })).toBeInTheDocument()
    expect(screen.getAllByTestId('model-bar')).toHaveLength(2)
  })
})

describe('chart sources', () => {
  it('contain no hex colors', () => {
    const root = join(__dirname, '..', '..')
    const dirs = [join(root, 'features/usage'), join(root, 'components/charts')]
    for (const dir of dirs) {
      for (const f of readdirSync(dir).filter((n) => /\.(tsx?|css)$/.test(n) && !n.includes('.test.'))) {
        expect(readFileSync(join(dir, f), 'utf8'), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      }
    }
  })
})
