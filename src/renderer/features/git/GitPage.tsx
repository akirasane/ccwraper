import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, GitBranch, RefreshCw } from 'lucide-react'
import * as React from 'react'
import type { GitDiff, GitErrorCode, GitStatus } from '@shared/git'
import { Button, Spinner } from '@/components/ui'
import { computeDiff } from '@/features/chat/diff/compute-diff'
import { DiffView } from '@/features/chat/diff/DiffView'
import { cn } from '@/lib/cn'
import { ChangeList, groupChanges, type ChangeSelection } from './ChangeList'
import { CommitList } from './CommitList'
import { patchToRows } from './patch-rows'
import { gitKeys, useGitDiff, useGitLog, useGitStatus, useRefreshOnResult } from './queries'

type Tab = 'changes' | 'history'

const ERROR_TITLE: Record<GitErrorCode, string> = {
  not_repo: 'Not a git repository',
  git_missing: 'Git was not found',
  unsafe_repo: 'Git does not trust this repository',
  timeout: 'Git took too long to answer',
  bad_path: 'Invalid path',
  error: 'Git failed'
}
const ERROR_HINT: Partial<Record<GitErrorCode, string>> = {
  not_repo: 'Open a project that is inside a git repository to see its changes.',
  git_missing: 'Install Git for Windows, or add git to PATH, then refresh.',
  unsafe_repo: 'ccwraper never edits git config. Mark the folder safe yourself in a terminal, then refresh.',
  timeout: 'The repository may be very large or busy. Try Refresh.'
}

function ErrorState({ code, message }: { code: GitErrorCode; message: string }): React.JSX.Element {
  return (
    <div role="alert" data-testid={`git-error-${code}`} className="m-auto max-w-md px-6 text-center">
      <h2 className="text-lg font-medium text-fg">{ERROR_TITLE[code]}</h2>
      {ERROR_HINT[code] && <p className="mt-1 text-base text-fg-3">{ERROR_HINT[code]}</p>}
      {message && code !== 'not_repo' && (
        <pre className="mt-3 whitespace-pre-wrap rounded-sm border border-border bg-bg-2 p-2 text-left font-mono text-xs text-fg-2">
          {message}
        </pre>
      )}
    </div>
  )
}

function Note({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="px-4 py-3 text-base text-fg-3">{children}</p>
}

function DiffPane({
  cwd,
  selection,
  status
}: {
  cwd: string
  selection: ChangeSelection | undefined
  status: Extract<GitStatus, { ok: true }>
}): React.JSX.Element {
  const file = selection ? status.files.find((f) => f.path === selection.path) : undefined
  const isDir = !!file?.isDir || !!selection?.path.endsWith('/')
  const staged = selection?.group === 'staged'
  const q = useGitDiff(cwd, selection?.path, staged, !!selection && !isDir)

  if (!selection) return <Note>Select a file to see its diff.</Note>
  if (isDir) return <Note>This is an untracked directory. Its files are not listed individually.</Note>
  if (q.isPending) {
    return (
      <div className="flex items-center gap-2 p-4 text-base text-fg-3" role="status">
        <Spinner /> Loading diff...
      </div>
    )
  }
  if (q.isError) return <Note>Could not load the diff.</Note>
  return <DiffBody diff={q.data} />
}

function DiffBody({ diff }: { diff: GitDiff }): React.JSX.Element {
  const view = React.useMemo(() => {
    if (!diff.ok) return undefined
    if (diff.untrackedText !== undefined) return { ...computeDiff('', diff.untrackedText), notes: [] as string[] }
    if (diff.patch) return patchToRows(diff.patch)
    return undefined
  }, [diff])

  if (!diff.ok) return <ErrorState code={diff.code} message={diff.message} />
  if (diff.binary) return <Note>Binary file: no text diff to show.</Note>
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="git-diff">
      {diff.truncated && (
        <p role="status" className="border-b border-warn-border bg-warn-bg px-4 py-2 text-sm text-warn">
          This diff is too large and was cut off. Open the file in an editor or use git in a terminal for the rest.
        </p>
      )}
      {view?.notes.map((n) => (
        <p key={n} className="px-4 pt-2 text-sm text-fg-3">
          {n}
        </p>
      ))}
      {view && view.rows.length > 0 ? (
        <DiffView diff={view} className="py-2" />
      ) : (
        !diff.truncated && <Note>No textual changes (the file mode or the name may have changed).</Note>
      )}
    </div>
  )
}

export function GitPage({ cwd }: { cwd?: string | undefined }): React.JSX.Element {
  const qc = useQueryClient()
  const [tab, setTab] = React.useState<Tab>('changes')
  const [selection, setSelection] = React.useState<ChangeSelection | undefined>()
  const statusQ = useGitStatus(cwd)
  const logQ = useGitLog(cwd, tab === 'history')
  useRefreshOnResult(cwd)

  React.useEffect(() => setSelection(undefined), [cwd])

  const refresh = (): void => {
    void qc.invalidateQueries({ queryKey: gitKeys.all })
  }

  const status = statusQ.data
  const ok = status?.ok ? status : undefined

  // Drop a selection that is no longer in the list after a refresh.
  React.useEffect(() => {
    if (!ok || !selection) return
    const g = groupChanges(ok.files)
    if (!g[selection.group].some((f) => f.path === selection.path)) setSelection(undefined)
  }, [ok, selection])

  const tabBtn = (id: Tab, label: string): React.JSX.Element => (
    <button
      type="button"
      role="tab"
      id={`git-tab-${id}`}
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={cn(
        'h-8 rounded-sm px-3 text-base transition-colors duration-fast',
        tab === id ? 'bg-bg-3 text-fg' : 'text-fg-3 hover:bg-bg-2 hover:text-fg'
      )}
    >
      {label}
    </button>
  )

  let body: React.JSX.Element
  if (!cwd) {
    body = <Note>Select a project to see its git status.</Note>
  } else if (statusQ.isPending) {
    body = (
      <div className="m-auto flex items-center gap-2 text-base text-fg-3" role="status">
        <Spinner /> Reading git status...
      </div>
    )
  } else if (statusQ.isError || !status) {
    body = <ErrorState code="error" message="The git request failed." />
  } else if (!status.ok) {
    body = <ErrorState code={status.code} message={status.message} />
  } else if (tab === 'history') {
    body = logQ.isPending ? (
      <div className="flex items-center gap-2 p-4 text-base text-fg-3" role="status">
        <Spinner /> Loading history...
      </div>
    ) : logQ.isError || !logQ.data ? (
      <ErrorState code="error" message="The git request failed." />
    ) : logQ.data.ok ? (
      <CommitList commits={logQ.data.commits} />
    ) : (
      <ErrorState code={logQ.data.code} message={logQ.data.message} />
    )
  } else {
    body = (
      <div className="flex min-h-0 flex-1">
        <div className="flex w-[340px] min-w-[240px] shrink-0 flex-col border-r border-border">
          {status.truncated && (
            <p role="status" className="border-b border-warn-border bg-warn-bg px-3 py-2 text-sm text-warn">
              Showing first {status.files.length.toLocaleString('en-US')} of {status.total.toLocaleString('en-US')} changes
            </p>
          )}
          {status.files.length === 0 ? (
            <Note>Working tree clean.</Note>
          ) : (
            <ChangeList files={status.files} selected={selection} onSelect={setSelection} />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <DiffPane cwd={cwd} selection={selection} status={status} />
        </div>
      </div>
    )
  }

  return (
    <div data-testid="git-page" data-cwd={cwd} className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2">
        <div className="flex min-w-0 items-center gap-2 text-base text-fg">
          <GitBranch size={15} aria-hidden className="shrink-0 text-fg-3" />
          {ok ? (
            <span className="truncate font-mono" data-testid="git-branch">
              {ok.detached ? 'Detached HEAD' : (ok.branch ?? 'No branch')}
            </span>
          ) : (
            <span className="text-fg-3">Git</span>
          )}
          {ok?.upstream && (
            <span className="flex items-center gap-1.5 text-sm text-fg-3" data-testid="git-upstream">
              <span className="font-mono">{ok.upstream}</span>
              <span className="flex items-center text-ok" aria-label={`${ok.ahead} ahead`}>
                <ArrowUp size={12} aria-hidden />
                {ok.ahead}
              </span>
              <span className="flex items-center text-warn" aria-label={`${ok.behind} behind`}>
                <ArrowDown size={12} aria-hidden />
                {ok.behind}
              </span>
            </span>
          )}
        </div>
        {ok && (
          <span className="min-w-0 truncate font-mono text-xs text-fg-muted" title={ok.root}>
            {ok.root}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-fg-3">Read-only. Use the terminal or Claude to stage and commit.</span>
          <Button variant="secondary" size="sm" onClick={refresh} disabled={!cwd} aria-label="Refresh">
            <RefreshCw size={13} aria-hidden className={statusQ.isFetching ? 'ccw-spin' : undefined} />
            Refresh
          </Button>
        </div>
      </header>
      {ok && (
        <div role="tablist" aria-label="Git views" className="flex gap-1 border-b border-border px-3 py-1.5">
          {tabBtn('changes', `Changes (${ok.total})`)}
          {tabBtn('history', 'History')}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">{body}</div>
    </div>
  )
}
