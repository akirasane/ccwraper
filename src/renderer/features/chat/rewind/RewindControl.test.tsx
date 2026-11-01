import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/stores/chat-store'
import { RewindControl, relativeTo } from './RewindControl'

const MID = '11111111-1111-4111-8111-111111111111'
const rewind = vi.fn()

beforeAll(() => {
  class RO {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', RO)
})

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { ccwrap: unknown }).ccwrap = { session: { rewind } }
  useChatStore.setState({ convs: {}, localToConv: {}, drafts: {}, draftImages: {} })
  useChatStore.getState().createConv({ convId: 'c1', cwd: 'C:\\proj', localId: 'L1' })
})

describe('relativeTo', () => {
  it('strips the project prefix on either slash style and case', () => {
    expect(relativeTo('C:\\proj', 'C:\\proj\\src\\a.ts')).toBe('src/a.ts')
    expect(relativeTo('C:/proj/', 'c:/proj/src/a.ts')).toBe('src/a.ts')
    expect(relativeTo('C:\\proj', 'D:\\other\\a.ts')).toBe('D:\\other\\a.ts')
    expect(relativeTo(undefined, 'x')).toBe('x')
  })
})

describe('RewindControl', () => {
  it('renders nothing without a live session', () => {
    act(() => useChatStore.setState({ convs: { c1: { ...useChatStore.getState().convs['c1']!, localId: undefined } } }))
    const { container } = render(<RewindControl convId="c1" messageId={MID} />)
    expect(container.firstChild).toBeNull()
  })

  it('previews with a dry run, then restores only after confirmation', async () => {
    rewind
      .mockResolvedValueOnce({ canRewind: true, filesChanged: ['C:\\proj\\src\\a.ts'], insertions: 3, deletions: 1 })
      .mockResolvedValueOnce({ canRewind: true, filesChanged: ['C:\\proj\\src\\a.ts'] })
    render(<RewindControl convId="c1" messageId={MID} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rewind files to this message' }))
    await waitFor(() => screen.getByTestId('rewind-preview'))
    expect(rewind).toHaveBeenCalledTimes(1)
    expect(rewind).toHaveBeenLastCalledWith({ localId: 'L1', messageId: MID, dryRun: true })
    expect(screen.getByText('src/a.ts')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Restore files' }))
    await waitFor(() => expect(rewind).toHaveBeenCalledTimes(2))
    expect(rewind).toHaveBeenLastCalledWith({ localId: 'L1', messageId: MID, dryRun: false })
    await waitFor(() => expect(screen.queryByTestId('rewind-dialog')).toBeNull())
  })

  it('shows the SDK error when rewinding is impossible', async () => {
    rewind.mockResolvedValueOnce({ canRewind: false, error: 'No file checkpoint found for this message' })
    render(<RewindControl convId="c1" messageId={MID} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rewind files to this message' }))
    await waitFor(() => screen.getByText('No file checkpoint found for this message'))
    expect(screen.queryByRole('button', { name: 'Restore files' })).toBeNull()
  })

  it('cannot restore when no files differ', async () => {
    rewind.mockResolvedValueOnce({ canRewind: true, filesChanged: [] })
    render(<RewindControl convId="c1" messageId={MID} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rewind files to this message' }))
    await waitFor(() => screen.getByText('No file differences found.'))
    expect((screen.getByRole('button', { name: 'Restore files' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('is disabled while a turn is running', () => {
    act(() => useChatStore.setState({ convs: { c1: { ...useChatStore.getState().convs['c1']!, status: 'running' } } }))
    render(<RewindControl convId="c1" messageId={MID} />)
    expect((screen.getByRole('button', { name: 'Rewind files to this message' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
