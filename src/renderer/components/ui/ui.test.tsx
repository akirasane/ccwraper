import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  Kbd,
  Spinner,
  StatusPill,
  Textarea,
  Toggle,
  Tooltip
} from './index'

describe('Button', () => {
  it('renders each variant and size with a button role', () => {
    render(
      <>
        <Button variant="primary">P</Button>
        <Button variant="secondary">S</Button>
        <Button variant="ghost">G</Button>
        <Button variant="danger" size="sm">
          D
        </Button>
        <Button size="icon-md" aria-label="icon" />
      </>
    )
    expect(screen.getAllByRole('button')).toHaveLength(5)
    expect(screen.getByRole('button', { name: 'P' }).className).toContain('bg-accent-solid')
    expect(screen.getByRole('button', { name: 'D' }).className).toContain('h-6')
    expect(screen.getByRole('button', { name: 'P' })).toHaveAttribute('type', 'button')
  })

  it('fires onClick and is keyboard-activatable', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<Button onClick={onClick}>Go</Button>)
    await user.tab()
    expect(screen.getByRole('button')).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire when disabled', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(
      <Button disabled onClick={onClick}>
        Go
      </Button>
    )
    await user.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('asChild renders the child element', () => {
    render(
      <Button asChild>
        <a href="#x">link</a>
      </Button>
    )
    expect(screen.getByRole('link', { name: 'link' })).toBeInTheDocument()
  })
})

describe('Input / Textarea', () => {
  it('accepts typing and mono styling', async () => {
    const user = userEvent.setup()
    render(<Input mono aria-label="name" />)
    await user.type(screen.getByRole('textbox', { name: 'name' }), 'abc')
    expect(screen.getByRole('textbox')).toHaveValue('abc')
    expect(screen.getByRole('textbox').className).toContain('font-mono')
  })

  it('error state sets aria-invalid; disabled blocks input', () => {
    render(
      <>
        <Input error aria-label="bad" />
        <Textarea disabled aria-label="off" />
      </>
    )
    expect(screen.getByRole('textbox', { name: 'bad' })).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('textbox', { name: 'off' })).toBeDisabled()
  })
})

describe('Chip', () => {
  it('renders static and interactive chips', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(
      <>
        <Chip variant="ok">fine</Chip>
        <Chip variant="selected" onClick={onClick}>
          pick
        </Chip>
      </>
    )
    expect(screen.getByText('fine').className).toContain('text-ok')
    const btn = screen.getByRole('button', { name: 'pick' })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    await user.click(btn)
    expect(onClick).toHaveBeenCalled()
  })

  it('running chip shows a spinner', () => {
    const { container } = render(<Chip variant="running">busy</Chip>)
    expect(container.querySelector('svg.ccw-spin')).not.toBeNull()
  })
})

describe('StatusPill', () => {
  it('exposes state and label, and shakes only on err', () => {
    const { rerender } = render(<StatusPill state="run" />)
    const pill = screen.getByRole('status')
    expect(pill).toHaveAttribute('data-state', 'run')
    expect(pill).toHaveTextContent('Running')
    expect(pill.className).not.toContain('ccw-shake')

    rerender(<StatusPill state="done" />)
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'done')
    expect(screen.getByRole('status')).toHaveTextContent('Done')

    rerender(<StatusPill state="err" label="Failed" />)
    expect(screen.getByRole('status')).toHaveTextContent('Failed')
    expect(screen.getByRole('status').className).toContain('ccw-shake')
  })

  it('stacks all three glyphs and shows only the active one', () => {
    const { container } = render(<StatusPill state="done" />)
    const glyphs = container.querySelectorAll('span.absolute')
    expect(glyphs).toHaveLength(3)
    expect(Array.from(glyphs).map((g) => g.className.includes('opacity-100'))).toEqual([false, true, false])
  })
})

describe('Toggle', () => {
  it('is a switch toggled by click and Space', async () => {
    const onCheckedChange = vi.fn()
    const user = userEvent.setup()
    render(<Toggle aria-label="auto" onCheckedChange={onCheckedChange} />)
    const sw = screen.getByRole('switch', { name: 'auto' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await user.click(sw)
    expect(onCheckedChange).toHaveBeenLastCalledWith(true)
    sw.focus()
    await user.keyboard(' ')
    expect(onCheckedChange).toHaveBeenLastCalledWith(false)
  })

  it('disabled does not toggle', async () => {
    const onCheckedChange = vi.fn()
    const user = userEvent.setup()
    render(<Toggle disabled aria-label="x" onCheckedChange={onCheckedChange} />)
    await user.click(screen.getByRole('switch'))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})

describe('Kbd / Spinner', () => {
  it('Kbd renders a kbd element', () => {
    render(<Kbd>Esc</Kbd>)
    expect(screen.getByText('Esc').tagName).toBe('KBD')
  })
  it('Spinner is hidden unless labelled', () => {
    const { container, rerender } = render(<Spinner />)
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    rerender(<Spinner label="Loading" />)
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument()
  })
})

describe('Tooltip', () => {
  it('shows content on keyboard focus', async () => {
    const user = userEvent.setup()
    render(
      <Tooltip content="Copy it">
        <Button>trigger</Button>
      </Tooltip>
    )
    await user.tab()
    expect((await screen.findAllByText('Copy it')).length).toBeGreaterThan(0)
    expect(await screen.findByRole('tooltip')).toBeInTheDocument()
  })
})

describe('Dialog', () => {
  it('opens as a modal dialog, labelled, and closes on Escape', async () => {
    const user = userEvent.setup()
    render(
      <Dialog defaultOpen>
        <DialogContent>
          <DialogTitle>Allow Bash?</DialogTitle>
          <DialogDescription>npm test</DialogDescription>
          <Button>Allow once</Button>
        </DialogContent>
      </Dialog>
    )
    const dlg = screen.getByRole('dialog', { name: 'Allow Bash?' })
    expect(dlg).toHaveAccessibleDescription('npm test')
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('Checkbox', () => {
  it('toggles by click and Space, and disabled does not', async () => {
    const onCheckedChange = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(<Checkbox aria-label="ack" onCheckedChange={onCheckedChange} />)
    const cb = screen.getByRole('checkbox', { name: 'ack' })
    expect(cb).toHaveAttribute('aria-checked', 'false')
    await user.click(cb)
    expect(onCheckedChange).toHaveBeenLastCalledWith(true)
    cb.focus()
    await user.keyboard(' ')
    expect(onCheckedChange).toHaveBeenLastCalledWith(false)
    onCheckedChange.mockClear()
    rerender(<Checkbox disabled aria-label="ack" onCheckedChange={onCheckedChange} />)
    await user.click(screen.getByRole('checkbox'))
    expect(onCheckedChange).not.toHaveBeenCalled()
  })
})
