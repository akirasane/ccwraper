import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/stores/chat-store'
import { useExtraDirs } from '@/stores/extra-dirs-store'
import { AddDirButton, ExtraDirsChips } from './ExtraDirsBar'

const pick = vi.fn()
const start = vi.fn().mockResolvedValue({ localId: 'L1' })

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
  window.localStorage.clear()
  useExtraDirs.setState({ byCwd: {} })
  ;(window as unknown as { ccwrap: unknown }).ccwrap = { dialog: { pickDirectory: pick }, session: { start, send: vi.fn() } }
  useChatStore.setState({ convs: {}, localToConv: {}, drafts: {}, draftImages: {}, modes: {}, draftModels: {} })
  useChatStore.getState().createConv({ convId: 'c1', cwd: 'C:\\proj' })
})

describe('extra folders UI', () => {
  it('adds the picked folder as a chip and removes it again', async () => {
    pick.mockResolvedValueOnce('D:\\shared\\lib')
    render(
      <>
        <AddDirButton convId="c1" />
        <ExtraDirsChips convId="c1" />
      </>
    )
    expect(screen.queryByTestId('extra-dirs')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }))
    await waitFor(() => expect(screen.getByTestId('extra-dirs').textContent).toContain('lib'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove folder lib' }))
    expect(screen.queryByTestId('extra-dirs')).toBeNull()
  })

  it('does nothing when the picker is cancelled', async () => {
    pick.mockResolvedValueOnce(null)
    render(<AddDirButton convId="c1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Add folder' }))
    await waitFor(() => expect(pick).toHaveBeenCalled())
    expect(useExtraDirs.getState().dirsFor('C:\\proj')).toEqual([])
  })

  it('a new session for the project starts with the extra folders', async () => {
    useExtraDirs.getState().add('C:\\proj', 'D:\\shared\\lib')
    await useChatStore.getState().submit('c1', 'hello')
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ cwd: 'C:\\proj', additionalDirectories: ['D:\\shared\\lib'] }))
  })

  it('omits additionalDirectories when none are set', async () => {
    await useChatStore.getState().submit('c1', 'hello')
    expect(start.mock.calls[0]![0]).not.toHaveProperty('additionalDirectories')
  })
})
