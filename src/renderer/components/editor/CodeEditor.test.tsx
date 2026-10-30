import { diagnosticCount, forceLinting } from '@codemirror/lint'
import { EditorView } from '@codemirror/view'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CodeEditor, type CodeEditorProps } from './CodeEditor'

beforeAll(() => {
  // jsdom has no layout; CodeMirror measures ranges.
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }
  Range.prototype.getBoundingClientRect = () => rect as DOMRect
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList
})

async function mount(props: Partial<CodeEditorProps> = {}, strict = false) {
  const onChange = vi.fn()
  const all: CodeEditorProps = { value: '{"a":1}', onChange, language: 'json', ariaLabel: 'Raw settings', ...props }
  const ui = <CodeEditor {...all} />
  const r = render(strict ? <StrictMode>{ui}</StrictMode> : ui)
  const content = await screen.findByRole('textbox', { name: 'Raw settings' })
  const view = EditorView.findFromDOM(r.container.querySelector('.cm-editor') as HTMLElement)!
  return { ...r, content, view, onChange }
}

describe('CodeEditor (CodeMirror)', () => {
  it('mounts with the value and an accessible name', async () => {
    const { content, view } = await mount({}, true)
    expect(content).toHaveAttribute('aria-label', 'Raw settings')
    expect(view.state.doc.toString()).toBe('{"a":1}')
    expect(document.querySelectorAll('.cm-editor')).toHaveLength(1)
  })

  it('fires onChange on edits, not on external value changes', async () => {
    const { view, onChange, rerender } = await mount()
    act(() => view.dispatch({ changes: { from: 0, insert: 'x' }, userEvent: 'input.type' }))
    expect(onChange).toHaveBeenCalledWith('x{"a":1}')
    onChange.mockClear()
    rerender(<CodeEditor value="{}" onChange={onChange} language="json" ariaLabel="Raw settings" />)
    await waitFor(() => expect(view.state.doc.toString()).toBe('{}'))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('works controlled', async () => {
    function Host() {
      const [v, setV] = useState('a')
      return <CodeEditor value={v} onChange={setV} language="markdown" ariaLabel="Notes" />
    }
    const r = render(<Host />)
    await screen.findByRole('textbox', { name: 'Notes' })
    const view = EditorView.findFromDOM(r.container.querySelector('.cm-editor') as HTMLElement)!
    act(() => view.dispatch({ changes: { from: 1, insert: 'b' } }))
    expect(view.state.doc.toString()).toBe('ab')
  })

  it('Ctrl+S calls onSave', async () => {
    const onSave = vi.fn()
    const { content } = await mount({ onSave })
    fireEvent.keyDown(content, { key: 's', code: 'KeyS', keyCode: 83, ctrlKey: true })
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('readOnly blocks edits and is exposed to assistive tech', async () => {
    const { content, view, onChange } = await mount({ readOnly: true })
    expect(content).toHaveAttribute('aria-readonly', 'true')
    // Programmatic dispatch bypasses readOnly by design; user commands must not.
    fireEvent.keyDown(content, { key: 'Enter', code: 'Enter', keyCode: 13 })
    expect(view.state.doc.toString()).toBe('{"a":1}')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('the same key edits when not readOnly (control for the test above)', async () => {
    const { content, view, onChange } = await mount()
    act(() => view.dispatch({ selection: { anchor: 0 } }))
    fireEvent.keyDown(content, { key: 'Enter', code: 'Enter', keyCode: 13 })
    expect(view.state.doc.toString()).toContain('\n')
    expect(onChange).toHaveBeenCalled()
  })

  it('reports JSON parse errors and external diagnostics', async () => {
    const { view } = await mount({
      value: '{"a":',
      diagnostics: [{ from: 0, to: 1, message: 'schema warning', severity: 'warning' }]
    })
    act(() => forceLinting(view))
    await waitFor(() => expect(diagnosticCount(view.state)).toBe(2))
  })

  it('clamps out-of-range external diagnostics', async () => {
    const { view } = await mount({
      value: '{}',
      diagnostics: [{ from: 50, to: 99, message: 'late', severity: 'error' }]
    })
    act(() => forceLinting(view))
    await waitFor(() => expect(diagnosticCount(view.state)).toBe(1))
  })

  it('switches to markdown with line wrapping', async () => {
    const { container } = await mount({ language: 'markdown', value: '# hi' })
    expect(container.querySelector('.cm-lineWrapping')).not.toBeNull()
  })
})
