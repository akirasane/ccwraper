import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginsBrowseResult, PluginsListResult } from '@shared/plugins'
import { PluginsPage } from './PluginsPage'

const LIST: PluginsListResult = {
  installed: [
    { id: 'caveman@caveman', version: '4.0.1', scope: 'user', enabled: true },
    { id: 'tools@official', version: 'abc123def456789', scope: 'project', enabled: false }
  ],
  marketplaces: [{ name: 'caveman', source: 'github', origin: 'JuliusBrussee/caveman' }]
}
const BROWSE: PluginsBrowseResult = {
  total: 40,
  items: [
    { pluginId: 'git-helper@official', name: 'git-helper', description: 'Helps with git', marketplaceName: 'official', installCount: 1500, installed: false },
    { pluginId: 'caveman@caveman', name: 'caveman', description: 'Talk short', marketplaceName: 'caveman', installCount: 10, installed: true }
  ]
}

const api = {
  list: vi.fn(),
  browse: vi.fn(),
  mutate: vi.fn()
}

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
  api.list.mockResolvedValue(LIST)
  api.browse.mockResolvedValue(BROWSE)
  api.mutate.mockResolvedValue({ ok: true, output: 'done' })
  ;(window as unknown as { ccwrap: unknown }).ccwrap = { plugins: api }
})

function mount(cwd: string | null = 'C:/proj'): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <PluginsPage {...(cwd ? { cwd } : {})} />
    </QueryClientProvider>
  )
}

describe('PluginsPage installed tab', () => {
  it('lists installed plugins with scope and version', async () => {
    mount()
    const rows = await screen.findAllByTestId('plugin-row')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('caveman@caveman')).toBeTruthy()
    expect(within(rows[1]!).getByText('project')).toBeTruthy()
  })

  it('toggle disables an enabled plugin in its own scope, with the project cwd', async () => {
    mount()
    fireEvent.click(await screen.findByRole('switch', { name: 'Disable caveman@caveman' }))
    await waitFor(() =>
      expect(api.mutate).toHaveBeenCalledWith({ cwd: 'C:/proj', action: { op: 'disable', plugin: 'caveman@caveman', scope: 'user' } })
    )
  })

  it('enables a disabled plugin', async () => {
    mount()
    fireEvent.click(await screen.findByRole('switch', { name: 'Enable tools@official' }))
    await waitFor(() =>
      expect(api.mutate).toHaveBeenCalledWith({ cwd: 'C:/proj', action: { op: 'enable', plugin: 'tools@official', scope: 'project' } })
    )
  })

  it('uninstall asks first', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Uninstall caveman@caveman' }))
    expect(api.mutate).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Uninstall' }))
    await waitFor(() =>
      expect(api.mutate).toHaveBeenCalledWith({ cwd: 'C:/proj', action: { op: 'uninstall', plugin: 'caveman@caveman', scope: 'user' } })
    )
  })

  it('shows the CLI failure with its output', async () => {
    api.mutate.mockResolvedValueOnce({ ok: false, message: 'Plugin not found', output: 'looked in 2 marketplaces' })
    mount()
    await screen.findAllByTestId('plugin-row')
    fireEvent.click(screen.getAllByRole('button', { name: 'Update' })[0]!)
    const box = await screen.findByTestId('plugins-failure')
    expect(box.textContent).toContain('Plugin not found')
    expect(box.textContent).toContain('looked in 2 marketplaces')
  })
})

describe('PluginsPage browse tab', () => {
  const openBrowse = async (): Promise<void> => {
    await screen.findAllByTestId('plugin-row')
    fireEvent.click(screen.getByRole('tab', { name: /Browse/ }))
    await screen.findAllByTestId('available-row')
  }

  it('shows the catalog with counts and marks installed ones', async () => {
    mount()
    await openBrowse()
    expect(screen.getByTestId('browse-count').textContent).toBe('Showing 2 of 40')
    const rows = screen.getAllByTestId('available-row')
    expect(within(rows[0]!).getByRole('button', { name: /Install/ })).toHaveProperty('disabled', false)
    expect((within(rows[1]!).getByRole('button', { name: /Installed/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('searches with a debounce', async () => {
    mount()
    await openBrowse()
    await userEvent.type(screen.getByLabelText('Search plugins'), 'git')
    await waitFor(() => expect(api.browse).toHaveBeenLastCalledWith({ query: 'git', limit: 30, cwd: 'C:/proj' }))
  })

  it('install shows a trust warning and a scope choice, then installs', async () => {
    mount()
    await openBrowse()
    fireEvent.click(within(screen.getAllByTestId('available-row')[0]!).getByRole('button', { name: /Install/ }))
    const dialog = await screen.findByTestId('install-dialog')
    expect(dialog.textContent).toMatch(/Only install plugins from sources you trust/)
    expect(api.mutate).not.toHaveBeenCalled()
    fireEvent.change(within(dialog).getByLabelText('Install scope'), { target: { value: 'project' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Install' }))
    await waitFor(() =>
      expect(api.mutate).toHaveBeenCalledWith({ cwd: 'C:/proj', action: { op: 'install', plugin: 'git-helper@official', scope: 'project' } })
    )
  })

  it('project scopes are disabled without a project', async () => {
    mount(null)
    await openBrowse()
    fireEvent.click(within(screen.getAllByTestId('available-row')[0]!).getByRole('button', { name: /Install/ }))
    const dialog = await screen.findByTestId('install-dialog')
    const opts = within(dialog).getAllByRole('option') as HTMLOptionElement[]
    expect(opts.map((o) => [o.value, o.disabled])).toEqual([
      ['user', false],
      ['project', true],
      ['local', true]
    ])
  })
})

describe('PluginsPage marketplaces tab', () => {
  const openMarkets = async (): Promise<void> => {
    await screen.findAllByTestId('plugin-row')
    fireEvent.click(screen.getByRole('tab', { name: /Marketplaces/ }))
    await screen.findAllByTestId('marketplace-row')
  }

  it('lists marketplaces, updates and removes one', async () => {
    mount()
    await openMarkets()
    expect(screen.getByText('JuliusBrussee/caveman')).toBeTruthy()
    fireEvent.click(within(screen.getByTestId('marketplace-row')).getByRole('button', { name: 'Update' }))
    await waitFor(() => expect(api.mutate).toHaveBeenCalledWith({ cwd: 'C:/proj', action: { op: 'marketplaceUpdate', name: 'caveman' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove marketplace caveman' }))
    await waitFor(() => expect(api.mutate).toHaveBeenCalledWith({ cwd: 'C:/proj', action: { op: 'marketplaceRemove', name: 'caveman' } }))
  })

  it('add marketplace validates the source and warns about trust', async () => {
    mount()
    await openMarkets()
    fireEvent.click(screen.getByRole('button', { name: 'Add marketplace' }))
    const dialog = await screen.findByTestId('marketplace-dialog')
    expect(dialog.textContent).toMatch(/trust/)
    const add = within(dialog).getByRole('button', { name: 'Add' }) as HTMLButtonElement
    expect(add.disabled).toBe(true)
    await userEvent.type(within(dialog).getByLabelText('Marketplace source'), '--evil')
    expect(add.disabled).toBe(true)
    await userEvent.clear(within(dialog).getByLabelText('Marketplace source'))
    await userEvent.type(within(dialog).getByLabelText('Marketplace source'), 'owner/repo')
    expect(add.disabled).toBe(false)
    fireEvent.click(add)
    await waitFor(() => expect(api.mutate).toHaveBeenCalledWith({ cwd: 'C:/proj', action: { op: 'marketplaceAdd', source: 'owner/repo' } }))
  })
})
