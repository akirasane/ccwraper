import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, RefreshCw, Search, Trash2 } from 'lucide-react'
import * as React from 'react'
import type { PluginsMutateArgs } from '@shared/ipc'
import type { AvailablePlugin, InstalledPlugin, MarketplaceInfo, PluginScope } from '@shared/plugins'
import {
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  toast,
  Toggle
} from '@/components/ui'

type Tab = 'installed' | 'browse' | 'marketplaces'
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'installed', label: 'Installed' },
  { id: 'browse', label: 'Browse' },
  { id: 'marketplaces', label: 'Marketplaces' }
]

const TRUST_NOTE =
  'Plugins run with your permissions. They can add commands, hooks that execute shell commands, and MCP servers. Only install plugins from sources you trust.'

type Failure = { title: string; message: string; output?: string }

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value)
  React.useEffect(() => {
    const h = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(h)
  }, [value, ms])
  return v
}

export function PluginsPage({ cwd }: { cwd?: string }): React.JSX.Element {
  const qc = useQueryClient()
  const [tab, setTab] = React.useState<Tab>('installed')
  const [failure, setFailure] = React.useState<Failure | undefined>()
  const [installing, setInstalling] = React.useState<AvailablePlugin | undefined>()
  const [removing, setRemoving] = React.useState<InstalledPlugin | undefined>()
  const [addingMarketplace, setAddingMarketplace] = React.useState(false)

  const list = useQuery({
    queryKey: ['plugins', 'list', cwd ?? ''],
    queryFn: () => window.ccwrap.plugins.list({ ...(cwd ? { cwd } : {}) })
  })
  const refresh = (): Promise<void> => qc.invalidateQueries({ queryKey: ['plugins'] })

  const mutation = useMutation({
    mutationFn: async (v: { action: PluginsMutateArgs; ok: string }) => {
      const res = await window.ccwrap.plugins.mutate({ ...(cwd ? { cwd } : {}), action: v.action })
      return { res, ok: v.ok }
    },
    onSuccess: async ({ res, ok }) => {
      if (res.ok) {
        toast.success(ok, { description: 'Applies to new sessions.' })
        setFailure(undefined)
      } else {
        setFailure({ title: 'Plugin command failed', message: res.message, ...(res.output ? { output: res.output } : {}) })
      }
      await refresh()
    },
    onError: (e) => setFailure({ title: 'Plugin command failed', message: e instanceof Error ? e.message : String(e) })
  })
  const run = (action: PluginsMutateArgs, ok: string): void => mutation.mutate({ action, ok })
  const busy = mutation.isPending

  const installed = list.data?.installed ?? []
  const marketplaces = list.data?.marketplaces ?? []

  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="plugins-page" aria-label="Plugins">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-[var(--tracking-tight)] text-fg">Plugins</h2>
          <p className="truncate font-mono text-sm text-fg-3">{cwd ?? 'No project selected (user scope only)'}</p>
        </div>
        <Button variant="ghost" size="icon-md" aria-label="Refresh" onClick={() => void refresh()}>
          <RefreshCw size={14} />
        </Button>
      </header>

      <div role="tablist" aria-label="Plugin views" className="flex gap-1 border-b border-border px-6 pt-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={
              'rounded-t-sm px-3 py-1.5 text-sm ' +
              (tab === t.id ? 'border-b-2 border-accent-from text-fg' : 'text-fg-3 hover:text-fg-2')
            }
          >
            {t.label}
            {t.id === 'installed' && list.data ? <span className="ml-1.5 text-xs text-fg-muted">{installed.length}</span> : null}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {list.isPending && <p className="text-base text-fg-3">Loading plugins...</p>}
        {(list.error || list.data?.error) && (
          <div role="alert" className="mb-3 rounded-sm border border-danger-border bg-danger-bg p-2 text-sm text-danger">
            {list.data?.error ?? (list.error instanceof Error ? list.error.message : 'Could not load plugins')}
          </div>
        )}
        {failure && (
          <div role="alert" className="mb-3 rounded-sm border border-danger-border bg-danger-bg p-2 text-sm text-danger" data-testid="plugins-failure">
            <p className="font-medium">{failure.message}</p>
            {failure.output && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-xs">{failure.output}</pre>}
          </div>
        )}

        {tab === 'installed' && list.data && (
          <InstalledList
            plugins={installed}
            busy={busy}
            onToggle={(p, enabled) =>
              run({ op: enabled ? 'enable' : 'disable', plugin: p.id, scope: p.scope }, `${enabled ? 'Enabled' : 'Disabled'} ${p.id}`)
            }
            onUpdate={(p) => run({ op: 'update', plugin: p.id }, `Checked ${p.id} for updates`)}
            onRemove={setRemoving}
          />
        )}
        {tab === 'browse' && <BrowseTab cwd={cwd} busy={busy} onInstall={setInstalling} hasMarketplaces={marketplaces.length > 0} />}
        {tab === 'marketplaces' && list.data && (
          <MarketplaceList
            items={marketplaces}
            busy={busy}
            onAdd={() => setAddingMarketplace(true)}
            onUpdate={(m) => run({ op: 'marketplaceUpdate', name: m.name }, `Updated ${m.name}`)}
            onUpdateAll={() => run({ op: 'marketplaceUpdate' }, 'Updated all marketplaces')}
            onRemove={(m) => run({ op: 'marketplaceRemove', name: m.name }, `Removed ${m.name}`)}
          />
        )}
      </div>

      {installing && (
        <InstallDialog
          plugin={installing}
          hasProject={Boolean(cwd)}
          busy={busy}
          onCancel={() => setInstalling(undefined)}
          onConfirm={(scope) => {
            run({ op: 'install', plugin: installing.pluginId, scope }, `Installed ${installing.pluginId}`)
            setInstalling(undefined)
          }}
        />
      )}
      {addingMarketplace && (
        <AddMarketplaceDialog
          busy={busy}
          onCancel={() => setAddingMarketplace(false)}
          onConfirm={(source) => {
            run({ op: 'marketplaceAdd', source }, 'Marketplace added')
            setAddingMarketplace(false)
          }}
        />
      )}
      <Dialog open={Boolean(removing)} onOpenChange={(o) => !o && setRemoving(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uninstall {removing?.id}?</DialogTitle>
            <DialogDescription>Removes the plugin from {removing?.scope} scope. Its data directory is deleted too.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRemoving(undefined)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (removing) run({ op: 'uninstall', plugin: removing.id, scope: removing.scope }, `Uninstalled ${removing.id}`)
                setRemoving(undefined)
              }}
            >
              Uninstall
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function InstalledList(props: {
  plugins: InstalledPlugin[]
  busy: boolean
  onToggle: (p: InstalledPlugin, enabled: boolean) => void
  onUpdate: (p: InstalledPlugin) => void
  onRemove: (p: InstalledPlugin) => void
}): React.JSX.Element {
  if (props.plugins.length === 0) return <p className="text-sm text-fg-muted">No plugins installed. Use Browse to find some.</p>
  return (
    <ul className="flex flex-col gap-1.5">
      {props.plugins.map((p) => (
        <li
          key={`${p.scope}:${p.id}`}
          data-testid="plugin-row"
          className="flex items-center gap-3 rounded-md border border-border bg-bg-1 px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <span className="font-mono text-base text-fg">{p.id}</span>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-3">
              <Chip>{p.scope}</Chip>
              <span className="font-mono">{p.version.slice(0, 12)}</span>
            </div>
          </div>
          <Toggle
            checked={p.enabled}
            disabled={props.busy}
            aria-label={`${p.enabled ? 'Disable' : 'Enable'} ${p.id}`}
            onCheckedChange={(v) => props.onToggle(p, v)}
          />
          <Button variant="secondary" disabled={props.busy} onClick={() => props.onUpdate(p)}>
            Update
          </Button>
          <Button variant="ghost" size="icon-md" aria-label={`Uninstall ${p.id}`} disabled={props.busy} onClick={() => props.onRemove(p)}>
            <Trash2 size={14} />
          </Button>
        </li>
      ))}
    </ul>
  )
}

function BrowseTab(props: {
  cwd: string | undefined
  busy: boolean
  hasMarketplaces: boolean
  onInstall: (p: AvailablePlugin) => void
}): React.JSX.Element {
  const [query, setQuery] = React.useState('')
  const q = useDebounced(query, 250)
  const res = useQuery({
    queryKey: ['plugins', 'browse', q, props.cwd ?? ''],
    queryFn: () => window.ccwrap.plugins.browse({ query: q, limit: 30, ...(props.cwd ? { cwd: props.cwd } : {}) }),
    placeholderData: (prev) => prev
  })
  return (
    <div>
      <div className="relative mb-3">
        <Search size={13} aria-hidden className="pointer-events-none absolute left-2.5 top-2 text-fg-3" />
        <Input
          aria-label="Search plugins"
          placeholder="Search plugins by name or description"
          className="pl-8"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {res.isPending && <p className="text-base text-fg-3">Loading catalog...</p>}
      {res.data?.error && (
        <div role="alert" className="mb-3 rounded-sm border border-danger-border bg-danger-bg p-2 text-sm text-danger">
          {res.data.error}
        </div>
      )}
      {res.data && !res.data.error && (
        <>
          <p className="mb-1.5 text-xs text-fg-3" data-testid="browse-count">
            {res.data.total > res.data.items.length ? `Showing ${res.data.items.length} of ${res.data.total}` : `${res.data.total} plugins`}
          </p>
          {res.data.items.length === 0 && (
            <p className="text-sm text-fg-muted">
              {props.hasMarketplaces ? 'No plugins match.' : 'No marketplaces configured. Add one on the Marketplaces tab.'}
            </p>
          )}
          <ul className="flex flex-col gap-1.5">
            {res.data.items.map((p) => (
              <li key={p.pluginId} data-testid="available-row" className="flex items-start gap-3 rounded-md border border-border bg-bg-1 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-base text-fg">{p.name}</span>
                    <Chip>{p.marketplaceName}</Chip>
                    {p.installCount > 0 && <span className="text-xs text-fg-3">{p.installCount.toLocaleString()} installs</span>}
                  </div>
                  {p.description && <p className="mt-0.5 line-clamp-2 text-sm text-fg-3">{p.description}</p>}
                </div>
                <Button variant="secondary" disabled={p.installed || props.busy} onClick={() => props.onInstall(p)}>
                  <Download size={13} /> {p.installed ? 'Installed' : 'Install'}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function MarketplaceList(props: {
  items: MarketplaceInfo[]
  busy: boolean
  onAdd: () => void
  onUpdate: (m: MarketplaceInfo) => void
  onUpdateAll: () => void
  onRemove: (m: MarketplaceInfo) => void
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-3 flex gap-2">
        <Button variant="primary" disabled={props.busy} onClick={props.onAdd}>
          Add marketplace
        </Button>
        <Button variant="secondary" disabled={props.busy || props.items.length === 0} onClick={props.onUpdateAll}>
          Update all
        </Button>
      </div>
      {props.items.length === 0 ? (
        <p className="text-sm text-fg-muted">No marketplaces configured.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {props.items.map((m) => (
            <li key={m.name} data-testid="marketplace-row" className="flex items-center gap-3 rounded-md border border-border bg-bg-1 px-3 py-2">
              <div className="min-w-0 flex-1">
                <span className="font-mono text-base text-fg">{m.name}</span>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-3">
                  <Chip>{m.source}</Chip>
                  <span className="truncate font-mono">{m.origin}</span>
                </div>
              </div>
              <Button variant="secondary" disabled={props.busy} onClick={() => props.onUpdate(m)}>
                Update
              </Button>
              <Button variant="ghost" size="icon-md" aria-label={`Remove marketplace ${m.name}`} disabled={props.busy} onClick={() => props.onRemove(m)}>
                <Trash2 size={14} />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function InstallDialog(props: {
  plugin: AvailablePlugin
  hasProject: boolean
  busy: boolean
  onCancel: () => void
  onConfirm: (scope: PluginScope) => void
}): React.JSX.Element {
  const [scope, setScope] = React.useState<PluginScope>('user')
  return (
    <Dialog open onOpenChange={(o) => !o && props.onCancel()}>
      <DialogContent data-testid="install-dialog">
        <DialogHeader>
          <DialogTitle>Install {props.plugin.name}?</DialogTitle>
          <DialogDescription>{TRUST_NOTE}</DialogDescription>
        </DialogHeader>
        <p className="font-mono text-sm text-fg-2">{props.plugin.pluginId}</p>
        {props.plugin.description && <p className="text-sm text-fg-3">{props.plugin.description}</p>}
        <label className="flex items-center gap-2 text-sm text-fg-2">
          Scope
          <select
            aria-label="Install scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as PluginScope)}
            className="h-[30px] rounded-sm border border-border-strong bg-bg-2 px-2 text-base text-fg"
          >
            <option value="user">User (all projects)</option>
            <option value="project" disabled={!props.hasProject}>
              Project (shared, .claude/settings.json)
            </option>
            <option value="local" disabled={!props.hasProject}>
              Local (this machine, this project)
            </option>
          </select>
        </label>
        <DialogFooter>
          <Button variant="secondary" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={props.busy} onClick={() => props.onConfirm(scope)}>
            Install
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddMarketplaceDialog(props: { busy: boolean; onCancel: () => void; onConfirm: (source: string) => void }): React.JSX.Element {
  const [source, setSource] = React.useState('')
  const s = source.trim()
  const valid = s.length > 0 && s.length <= 500 && !s.startsWith('-') && !/[\r\n]/.test(s)
  return (
    <Dialog open onOpenChange={(o) => !o && props.onCancel()}>
      <DialogContent data-testid="marketplace-dialog">
        <DialogHeader>
          <DialogTitle>Add marketplace</DialogTitle>
          <DialogDescription>A GitHub repo (owner/repo), a git URL, or a local folder. {TRUST_NOTE}</DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Marketplace source"
          mono
          placeholder="owner/repo or https://example.com/market.git"
          value={source}
          error={s.length > 0 && !valid}
          onChange={(e) => setSource(e.target.value)}
        />
        <DialogFooter>
          <Button variant="secondary" onClick={props.onCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid || props.busy} onClick={() => props.onConfirm(s)}>
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
