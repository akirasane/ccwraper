import { QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GitDiff, GitFileChange, GitStatus } from '@shared/git'
import type { SessionEventPayload } from '@shared/ipc'
import { createQueryClient } from '@/lib/query-client'
import { useChatStore } from '@/stores/chat-store'
import { GitPage } from './GitPage'

const CWD = 'C:\\fixture\\repo'

const f = (p: Partial<GitFileChange> & { path: string }): GitFileChange => ({ index: '.', worktree: '.', ...p })
const files: GitFileChange[] = [
  f({ path: 'src/staged.ts', index: 'M', added: 3, removed: 1 }),
  f({ path: 'src/work.ts', worktree: 'M', added: 1, removed: 0 }),
  f({ path: 'new.txt', untracked: true }),
  f({ path: 'dir/', untracked: true, isDir: true }),
  f({ path: 'clash.ts', index: 'U', worktree: 'U', conflicted: true })
]
const okStatus = (over: Partial<Extract<GitStatus, { ok: true }>> = {}): GitStatus => ({
  ok: true,
  root: 'C:/fixture/repo',
  branch: 'main',
  detached: false,
  upstream: 'origin/main',
  ahead: 2,
  behind: 1,
  files,
  truncated: false,
  total: files.length,
  ...over
})

let status: ReturnType<typeof vi.fn>
let diff: ReturnType<typeof vi.fn>
let log: ReturnType<typeof vi.fn>
let listener: ((p: SessionEventPayload) => void) | undefined

function setup(): void {
  status = vi.fn(async () => okStatus())
  diff = vi.fn(async (): Promise<GitDiff> => ({ ok: true, patch: '@@ -1 +1 @@\n-a\n+b\n', binary: false, truncated: false }))
  log = vi.fn(async () => ({
    ok: true as const,
    commits: [{ hash: 'abcdef1234', short: 'abcdef1', subject: 'first commit', author: 'Ann', date: '2026-01-02T03:04:05Z' }]
  }))
  listener = undefined
  ;(window as unknown as { ccwrap: unknown }).ccwrap = {
    git: { status, diff, log },
    session: {
      onEvent: (cb: (p: SessionEventPayload) => void) => {
        listener = cb
        return () => {
          listener = undefined
        }
      }
    }
  }
}

function renderPage(cwd: string | undefined = CWD) {
  const qc = createQueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <GitPage cwd={cwd} />
    </QueryClientProvider>
  )
}

beforeEach(setup)
afterEach(() => vi.useRealTimers())

describe('GitPage', () => {
  it('renders header and grouped files', async () => {
    renderPage()
    expect(await screen.findByTestId('git-branch')).toHaveTextContent('main')
    expect(screen.getByTestId('git-upstream')).toHaveTextContent('origin/main')
    for (const g of ['conflicted', 'staged', 'unstaged', 'untracked']) expect(screen.getByTestId(`group-${g}`)).toBeInTheDocument()
    expect(screen.getAllByTestId('change-row')).toHaveLength(5)
    expect(screen.getByText('Read-only. Use the terminal or Claude to stage and commit.')).toBeInTheDocument()
  })

  it('shows detached HEAD', async () => {
    status.mockResolvedValue(okStatus({ detached: true, branch: undefined, upstream: undefined }))
    renderPage()
    expect(await screen.findByText('Detached HEAD')).toBeInTheDocument()
  })

  it('selecting a staged row calls git.diff with staged true', async () => {
    renderPage()
    await screen.findByTestId('git-branch')
    const row = screen.getAllByTestId('change-row').find((r) => r.getAttribute('data-group') === 'staged')!
    await userEvent.click(row)
    await waitFor(() => expect(diff).toHaveBeenCalledWith({ cwd: CWD, path: 'src/staged.ts', staged: true }))
    expect(await screen.findByTestId('diff-view')).toBeInTheDocument()
  })

  it('untracked text is shown as all added; untracked dir gets a note and no call', async () => {
    diff.mockResolvedValue({ ok: true, untrackedText: 'x\ny\n', binary: false, truncated: false })
    renderPage()
    await screen.findByTestId('git-branch')
    const rows = screen.getAllByTestId('change-row')
    await userEvent.click(rows.find((r) => r.textContent?.includes('new.txt'))!)
    const view = await screen.findByTestId('diff-view')
    expect(view.querySelectorAll('[data-kind="add"]')).toHaveLength(2)
    diff.mockClear()
    await userEvent.click(rows.find((r) => r.textContent?.includes('dir/'))!)
    expect(await screen.findByText(/untracked directory/)).toBeInTheDocument()
    expect(diff).not.toHaveBeenCalled()
  })

  it('shows binary and truncated diff states', async () => {
    diff.mockResolvedValue({ ok: true, binary: true, truncated: false })
    renderPage()
    await screen.findByTestId('git-branch')
    await userEvent.click(screen.getAllByTestId('change-row')[1]!)
    expect(await screen.findByText(/Binary file/)).toBeInTheDocument()
  })

  it('shows the truncated banner', async () => {
    status.mockResolvedValue(okStatus({ truncated: true, total: 3000 }))
    renderPage()
    expect(await screen.findByText('Showing first 5 of 3,000 changes')).toBeInTheDocument()
  })

  it.each([
    ['not_repo', 'Not a git repository'],
    ['git_missing', 'Git was not found'],
    ['unsafe_repo', 'Git does not trust this repository'],
    ['timeout', 'Git took too long to answer']
  ] as const)('renders the %s state', async (code, title) => {
    status.mockResolvedValue({ ok: false, code, message: 'dubious ownership in repository' })
    renderPage()
    expect(await screen.findByText(title)).toBeInTheDocument()
    if (code === 'unsafe_repo') expect(screen.getByText('dubious ownership in repository')).toBeInTheDocument()
  })

  it('lists history and copies a hash', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderPage()
    await screen.findByTestId('git-branch')
    await userEvent.click(screen.getByRole('tab', { name: 'History' }))
    expect(await screen.findByText('first commit')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Copy hash abcdef1' }))
    expect(writeText).toHaveBeenCalledWith('abcdef1234')
  })

  it('has no write controls anywhere', async () => {
    renderPage()
    await screen.findByTestId('git-branch')
    await userEvent.click(screen.getAllByTestId('change-row')[0]!)
    await screen.findByTestId('diff-view')
    const labels = [...screen.queryAllByRole('button'), ...screen.queryAllByRole('tab')].map(
      (b) => `${b.getAttribute('aria-label') ?? ''} ${b.textContent ?? ''}`
    )
    expect(labels.filter((l) => /\b(stage|unstage|commit|discard|checkout|reset|push|pull|revert|restore|stash)\b/i.test(l))).toEqual([])
    const api = (window as unknown as { ccwrap: { git: object } }).ccwrap.git
    expect(Object.keys(api).sort()).toEqual(['diff', 'log', 'status'])
  })
})

describe('result-driven refresh', () => {
  const link = (cwd: string): void => {
    useChatStore.setState({
      localToConv: { L1: 'c1' },
      convs: { c1: { cwd } } as never
    })
  }
  const result = { t: 'result', costUsd: 0, durationMs: 1, turns: 1, usage: {}, isError: false } as never

  it('refetches once, 500 ms after a result for the same cwd', async () => {
    link(CWD)
    renderPage()
    await screen.findByTestId('git-branch')
    expect(status).toHaveBeenCalledTimes(1)
    vi.useFakeTimers()
    act(() => {
      listener?.({ localId: 'L1', event: result })
      listener?.({ localId: 'L1', event: result })
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(499)
    })
    expect(status).toHaveBeenCalledTimes(1)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2)
    })
    expect(status).toHaveBeenCalledTimes(2)
  })

  it('ignores a result for another cwd', async () => {
    link('C:\\other\\project')
    renderPage()
    await screen.findByTestId('git-branch')
    vi.useFakeTimers()
    act(() => listener?.({ localId: 'L1', event: result }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(status).toHaveBeenCalledTimes(1)
  })

  it('Refresh button refetches', async () => {
    renderPage()
    await screen.findByTestId('git-branch')
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(status).toHaveBeenCalledTimes(2))
  })
})
