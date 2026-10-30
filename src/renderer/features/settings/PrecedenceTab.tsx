import { useQuery } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import type { ResolvedSettingsView, ResolvedSource } from '@shared/config'
import { Chip, Spinner } from '@/components/ui'
import { configKeys } from '@/lib/config-queries'
import { cn } from '@/lib/cn'
import { MaskedValue } from './Masked'

const SOURCE_LABEL: Record<ResolvedSource, string> = {
  user: 'User',
  project: 'Project',
  local: 'Local',
  flag: 'Flag',
  managed: 'Managed'
}
const READ_ONLY: ReadonlySet<ResolvedSource> = new Set(['flag', 'managed'])
const LIST_KEYS = ['deny', 'ask', 'allow', 'additionalDirectories'] as const

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function summarize(v: unknown): string {
  const s = JSON.stringify(v)
  return s === undefined ? String(v) : s.length > 90 ? `${s.slice(0, 89)}…` : s
}

function SourceChip({ source, variant }: { source: ResolvedSource; variant?: 'ok' | 'neutral' | 'warn' }) {
  return (
    <Chip variant={variant ?? 'neutral'} className="h-5 px-1.5 text-xs">
      {SOURCE_LABEL[source]}
    </Chip>
  )
}

function ValueCell({ keyName, value }: { keyName: string; value: unknown }) {
  if (keyName === 'env' && isObj(value)) {
    return (
      <ul className="flex flex-col gap-0.5">
        {Object.entries(value).map(([k, v]) => (
          <li key={k} className="flex items-center gap-1">
            <code className="font-mono text-sm text-fg">{k}=</code>
            <MaskedValue value={typeof v === 'string' ? v : summarize(v)} label={k} />
          </li>
        ))}
      </ul>
    )
  }
  return (
    <code className="break-all font-mono text-sm" title={JSON.stringify(value)}>
      {summarize(value)}
    </code>
  )
}

export function PrecedenceView({ view }: { view: ResolvedSettingsView }): React.JSX.Element {
  const sources = view.sources
  const keys: string[] = []
  for (const k of Object.keys(view.effective)) if (k !== 'permissions') keys.push(k)
  for (const s of sources) for (const k of Object.keys(s.settings)) if (k !== 'permissions' && !keys.includes(k)) keys.push(k)

  const defaultModeSources = sources.filter((s) => isObj(s.settings.permissions) && typeof s.settings.permissions.defaultMode === 'string')
  const defaultModeWinner = defaultModeSources.filter((s) => !(view.ignoredDefaultMode && view.ignoredDefaultMode.source === s.source)).at(-1)

  return (
    <div className="flex flex-col gap-4" data-testid="settings-precedence">
      <p className="text-sm text-fg-3">
        Sources run from lowest to highest precedence, left to right. The highlighted value wins. Managed and flag sources are read-only.
      </p>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse text-left text-base">
          <caption className="sr-only">Settings by key and source</caption>
          <thead>
            <tr className="bg-bg-2">
              <th scope="col" className="px-3 py-2 text-sm font-medium text-fg-2">
                Key
              </th>
              {sources.map((s, i) => (
                <th key={`${s.source}:${i}`} scope="col" className="px-3 py-2 text-sm font-medium text-fg-2" title={s.path ?? s.policyOrigin}>
                  <span className="inline-flex items-center gap-1">
                    {SOURCE_LABEL[s.source]}
                    {READ_ONLY.has(s.source) && (
                      <span className="inline-flex items-center gap-0.5 text-xs text-fg-3">
                        <Lock size={10} aria-hidden /> read-only
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.length === 0 && (
              <tr>
                <td colSpan={sources.length + 1} className="px-3 py-3 text-fg-3">
                  No settings are set in any source.
                </td>
              </tr>
            )}
            {keys.map((k) => {
              const winner = view.provenance[k]?.source
              return (
                <tr key={k} className="border-t border-border align-top" data-testid={`prec-row-${k}`}>
                  <th scope="row" className="px-3 py-2 font-mono text-sm font-medium text-fg">
                    {k}
                  </th>
                  {sources.map((s, i) => {
                    const has = Object.hasOwn(s.settings, k)
                    if (!has) {
                      return (
                        <td key={i} className="px-3 py-2 text-fg-muted" aria-label="not set">
                          &mdash;
                        </td>
                      )
                    }
                    const wins = winner === s.source
                    return (
                      <td
                        key={i}
                        data-state={wins ? 'wins' : 'overridden'}
                        className={cn('px-3 py-2', wins ? 'bg-accent-tint text-fg' : 'text-fg-3 opacity-70')}
                      >
                        <ValueCell keyName={k} value={s.settings[k]} />
                        <div className={cn('mt-1 text-xs', wins ? 'text-accent-text' : 'text-fg-3')}>
                          {wins ? 'effective' : winner ? `overridden by ${SOURCE_LABEL[winner]}` : 'overridden'}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <section className="flex flex-col gap-3 rounded-md border border-border bg-bg-1 p-3" aria-label="Permissions (merged)">
        <h3 className="text-md font-medium text-fg">Permissions</h3>
        <div className="flex flex-wrap items-center gap-2" data-testid="prec-defaultMode">
          <span className="text-sm font-medium text-fg-2">defaultMode</span>
          {defaultModeSources.length === 0 && <span className="text-sm text-fg-3">not set</span>}
          {defaultModeSources.map((s, i) => {
            const mode = String((s.settings.permissions as Record<string, unknown>).defaultMode)
            const ignored = view.ignoredDefaultMode?.source === s.source && view.ignoredDefaultMode.mode === mode
            return (
              <span key={i} className="inline-flex items-center gap-1">
                <SourceChip source={s.source} variant={defaultModeWinner === s ? 'ok' : 'neutral'} />
                <code className={cn('font-mono text-sm', ignored ? 'text-fg-3 line-through' : 'text-fg')}>{mode}</code>
                {ignored && <Chip variant="warn" className="h-5 px-1.5 text-xs">ignored (untrusted project scope)</Chip>}
              </span>
            )
          })}
        </div>
        <p className="text-sm text-fg-3">Rules are merged across all sources, not overridden. Deny beats ask beats allow.</p>
        {LIST_KEYS.map((lk) => {
          const merged = new Map<string, ResolvedSource[]>()
          for (const s of sources) {
            const perms = s.settings.permissions
            const list = isObj(perms) && Array.isArray(perms[lk]) ? (perms[lk] as unknown[]) : []
            for (const r of list) {
              if (typeof r !== 'string') continue
              const cur = merged.get(r) ?? []
              if (!cur.includes(s.source)) cur.push(s.source)
              merged.set(r, cur)
            }
          }
          return (
            <div key={lk} className="flex flex-col gap-1" data-testid={`prec-perm-${lk}`}>
              <span className="text-sm font-medium text-fg-2">{lk}</span>
              {merged.size === 0 ? (
                <span className="text-sm text-fg-3">None</span>
              ) : (
                <ul className="flex flex-col gap-1" aria-label={`${lk} rules (merged)`}>
                  {[...merged].map(([rule, from]) => (
                    <li key={rule} className="flex items-center gap-2 rounded-sm border border-border bg-bg-2 px-2 py-1">
                      <code className="min-w-0 flex-1 break-all font-mono text-sm text-fg">{rule}</code>
                      <span className="flex gap-1">
                        {from.map((src) => (
                          <SourceChip key={src} source={src} />
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}

export function PrecedenceTab({ cwd }: { cwd?: string }): React.JSX.Element {
  const q = useQuery({
    queryKey: configKeys.settingsResolve(cwd),
    queryFn: () => window.ccwrap.settings.resolve({ cwd })
  })
  if (q.isLoading) {
    return (
      <div role="status" className="flex items-center gap-2 text-fg-3">
        <Spinner size={14} /> Resolving settings&hellip;
      </div>
    )
  }
  if (q.error || !q.data) {
    return (
      <p role="alert" className="text-danger">
        Could not resolve settings{q.error instanceof Error ? `: ${q.error.message}` : ''}
      </p>
    )
  }
  return (
    <>
      {q.data.error && (
        <p role="alert" className="mb-2 rounded-md border border-warn-border bg-warn-bg px-3 py-2 text-sm text-warn">
          {q.data.error}
        </p>
      )}
      <PrecedenceView view={q.data} />
    </>
  )
}
