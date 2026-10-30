import { useQuery } from '@tanstack/react-query'
import { Lock } from 'lucide-react'
import type { ResolvedSettingsView } from '@shared/config'
import { Chip, Spinner } from '@/components/ui'
import { configKeys } from '@/lib/config-queries'
import { MaskedValue } from '@/features/settings/Masked'
import { entryType, mergeEffective, type EffectiveEntry, type RawObj } from './model/hooks-model'

const SOURCE_LABEL: Record<string, string> = { user: 'User', project: 'Project', local: 'Local', flag: 'Flag', managed: 'Managed' }
const READ_ONLY = new Set(['flag', 'managed'])

function summary(e: RawObj): string {
  switch (entryType(e)) {
    case 'command':
      return String(e.command ?? '')
    case 'http':
      return String(e.url ?? '')
    case 'mcp_tool':
      return `${String(e.server ?? '')} / ${String(e.tool ?? '')}`
    case 'prompt':
    case 'agent':
      return String(e.prompt ?? '').slice(0, 160)
    default:
      return JSON.stringify(e).slice(0, 160)
  }
}

function EntryRow({ item }: { item: EffectiveEntry }) {
  const t = entryType(item.entry)
  const headers =
    t === 'http' && item.entry.headers && typeof item.entry.headers === 'object' ? Object.entries(item.entry.headers as Record<string, unknown>) : []
  return (
    <li className="flex flex-col gap-1 rounded-sm border border-border bg-bg-2 px-2 py-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip className="h-5 px-1.5 text-xs" variant={READ_ONLY.has(item.source) ? 'warn' : 'neutral'}>
          {READ_ONLY.has(item.source) && <Lock size={10} aria-hidden />}
          {SOURCE_LABEL[item.source] ?? item.source}
        </Chip>
        <Chip className="h-5 px-1.5 text-xs">{t || 'no type'}</Chip>
        {item.matcher !== undefined && item.matcher !== '' && <code className="font-mono text-xs text-fg-3">matcher: {item.matcher}</code>}
      </div>
      <code className="break-all font-mono text-sm text-fg">{summary(item.entry)}</code>
      {headers.length > 0 && (
        <ul className="flex flex-col gap-0.5" aria-label="Headers">
          {headers.map(([k, v]) => (
            <li key={k} className="flex items-center gap-1">
              <code className="font-mono text-xs text-fg-2">{k}:</code>
              <MaskedValue value={typeof v === 'string' ? v : JSON.stringify(v)} label={k} />
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

export function EffectiveHooksView({ view }: { view: ResolvedSettingsView }): React.JSX.Element {
  const events = mergeEffective(view.sources)
  return (
    <div className="flex flex-col gap-3" data-testid="hooks-effective">
      <p className="text-sm text-fg-3">
        Hooks from every source are merged, not overridden: all of them run. Sources are listed from lowest to highest precedence. Managed and flag hooks are
        read-only.
      </p>
      {events.length === 0 && <p className="text-base text-fg-3">No hooks are set in any source.</p>}
      {events.map((ev) => (
        <section key={ev.event} className="flex flex-col gap-1.5" aria-label={`Effective ${ev.event}`}>
          <h3 className="flex items-center gap-2 text-md font-medium text-fg">
            {ev.event}
            {!ev.known && <Chip variant="warn" className="h-5 px-1.5 text-xs">unknown event (newer CLI?)</Chip>}
          </h3>
          <ul className="flex flex-col gap-1.5">
            {ev.entries.map((it, i) => (
              <EntryRow key={i} item={it} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function EffectiveHooks({ cwd }: { cwd?: string }): React.JSX.Element {
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
  return <EffectiveHooksView view={q.data} />
}
