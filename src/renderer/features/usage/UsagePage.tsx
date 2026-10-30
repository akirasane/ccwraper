import { useState } from 'react'
import type { UsageRangeDays } from '@shared/usage'
import { Button, Spinner } from '@/components/ui'
import { DailyChart } from './DailyChart'
import { KpiRow } from './KpiRow'
import { ModelsTable } from './ModelsTable'
import { ProjectsChart } from './ProjectsChart'
import { totalTokens, useRescan, useUsageSummary } from './queries'

const RANGES: UsageRangeDays[] = [7, 30, 90, 365]

function Radio({
  checked,
  onClick,
  children
}: {
  checked: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      className="rounded-md border border-border-strong px-2.5 py-1 text-sm text-fg-2 hover:bg-bg-3 aria-checked:bg-bg-3 aria-checked:text-fg"
    >
      {children}
    </button>
  )
}

export function UsagePage({ cwd }: { cwd?: string | undefined }): React.JSX.Element {
  const [days, setDays] = useState<UsageRangeDays>(30)
  const [scope, setScope] = useState<'all' | 'current'>('all')
  const effectiveCwd = scope === 'current' ? cwd : undefined
  const q = useUsageSummary(days, effectiveCwd)
  const rescan = useRescan(days, effectiveCwd)
  const summary = q.data
  const busy = q.isFetching || rescan.isPending
  const empty = summary !== undefined && totalTokens(summary.totals.tokens) === 0

  return (
    <div data-testid="usage-page" data-cwd={cwd} className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 overflow-y-auto px-6 py-5">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 className="text-lg font-medium text-fg">Usage</h2>
        <div role="radiogroup" aria-label="Date range" className="flex gap-1">
          {RANGES.map((d) => (
            <Radio key={d} checked={days === d} onClick={() => setDays(d)}>
              {d} days
            </Radio>
          ))}
        </div>
        <div role="radiogroup" aria-label="Project" className="flex gap-1">
          <Radio checked={scope === 'all'} onClick={() => setScope('all')}>
            All projects
          </Radio>
          {cwd ? (
            <Radio checked={scope === 'current'} onClick={() => setScope('current')}>
              Current project
            </Radio>
          ) : null}
        </div>
        <Button
          size="sm"
          className="ml-auto"
          disabled={busy}
          onClick={() => rescan.mutate()}
          aria-label="Rescan transcripts"
        >
          {busy ? <Spinner size={12} /> : null}
          Rescan
        </Button>
      </header>

      {q.isPending ? (
        <div role="status" className="m-auto flex items-center gap-2 text-base text-fg-3">
          <Spinner /> Scanning Claude Code transcripts. The first scan can take a few seconds.
        </div>
      ) : q.isError || !summary ? (
        <div role="alert" className="m-auto max-w-sm text-center text-base text-danger">
          Could not read usage.
          <div className="mt-2">
            <Button size="sm" onClick={() => void q.refetch()}>
              Retry
            </Button>
          </div>
        </div>
      ) : empty ? (
        <div role="status" className="m-auto max-w-sm text-center">
          <p className="text-base text-fg">No usage in this range</p>
          <p className="mt-1 text-sm text-fg-3">
            Nothing was found in the last {days} days{effectiveCwd ? ' for this project' : ''}. Try a longer range.
          </p>
        </div>
      ) : (
        <>
          <KpiRow summary={summary} />
          <DailyChart summary={summary} />
          <div className="grid gap-4 2xl:grid-cols-2">
            <ProjectsChart summary={summary} />
            <ModelsTable summary={summary} />
          </div>
        </>
      )}

      {summary ? (
        <footer className="mt-auto flex flex-col gap-1 border-t border-border pt-3 text-sm text-fg-3">
          <p>
            Tokens cover all Claude Code sessions on this machine. Dollar figures are an estimated API-equivalent value,
            not a bill, and are exact only for sessions run inside ccwraper
            {summary.cost.since ? ` (since ${summary.cost.since})` : ''}; earlier history is shown in tokens only.
          </p>
          <p data-testid="scan-footer" className="tabular-nums">
            Scanned {summary.scan.files} files ({summary.scan.cachedFiles} cached) in {summary.scan.ms} ms
            {summary.scan.errors > 0 ? `, ${summary.scan.errors} errors` : ''}.
          </p>
        </footer>
      ) : null}
    </div>
  )
}
