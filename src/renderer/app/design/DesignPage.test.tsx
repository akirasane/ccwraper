import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DesignPage } from './DesignPage'

describe('DesignPage', () => {
  it('renders every section without errors and without touching IPC', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const boom = vi.fn(() => Promise.reject(new Error('IPC touched')))
    ;(window as unknown as { ccwrap: unknown }).ccwrap = { session: { start: boom, send: boom, interrupt: boom } }
    render(<DesignPage />)
    for (const id of ['colors', 'type', 'surfaces', 'ansi', 'motion', 'primitives', 'chat']) {
      expect(screen.getByTestId(`section-${id}`)).toBeInTheDocument()
    }
    // README components table (P1 rows)
    const page = screen.getByTestId('design-page')
    for (const text of ['Button:', 'Input and Textarea', 'Chip:', 'Status pill', 'Toggle', 'Toast', 'Tool card:', 'Diff view', 'Thinking block', 'Streaming text', 'Composer:', 'Permission dialog', 'Open dialog']) {
      expect(within(page).getAllByText(new RegExp(text)).length).toBeGreaterThan(0)
    }
    // tool card states
    const cards = within(screen.getByTestId('tool-cards'))
    expect(cards.getAllByRole('status').map((s) => s.getAttribute('data-state'))).toEqual(['run', 'done', 'err', 'run'])
    expect(screen.getAllByTestId('diff-view').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('thinking-block')).toHaveLength(3)
    // permission dialog opens from the trigger and closes on Esc
    await userEvent.click(screen.getByRole('button', { name: /Bash request/ }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(boom).not.toHaveBeenCalled()
    expect((window as unknown as { ccwrap: { session: { start: unknown } } }).ccwrap.session.start).toBe(boom)
    expect(err).not.toHaveBeenCalled()
    err.mockRestore()
  })
})
