import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import type { GitDiff, GitLog, GitStatus } from '@shared/git'
import { useChatStore } from '@/stores/chat-store'

/** All git queries start with 'git' so the palette's "Refresh git" can invalidate them. */
export const gitKeys = {
  all: ['git'] as const,
  status: (cwd: string) => ['git', 'status', cwd] as const,
  diff: (cwd: string, path: string, staged: boolean) => ['git', 'diff', cwd, path, staged] as const,
  log: (cwd: string, limit: number) => ['git', 'log', cwd, limit] as const
}

export const LOG_LIMIT = 50
export const RESULT_REFRESH_MS = 500

export function useGitStatus(cwd: string | undefined) {
  return useQuery<GitStatus>({
    queryKey: gitKeys.status(cwd ?? ''),
    queryFn: () => window.ccwrap.git.status({ cwd: cwd as string }),
    enabled: !!cwd,
    refetchOnWindowFocus: true
  })
}

export function useGitDiff(cwd: string | undefined, path: string | undefined, staged: boolean, enabled: boolean) {
  return useQuery<GitDiff>({
    queryKey: gitKeys.diff(cwd ?? '', path ?? '', staged),
    queryFn: () => window.ccwrap.git.diff({ cwd: cwd as string, path: path as string, staged }),
    enabled: !!cwd && !!path && enabled,
    refetchOnWindowFocus: true
  })
}

export function useGitLog(cwd: string | undefined, enabled: boolean) {
  return useQuery<GitLog>({
    queryKey: gitKeys.log(cwd ?? '', LOG_LIMIT),
    queryFn: () => window.ccwrap.git.log({ cwd: cwd as string, limit: LOG_LIMIT }),
    enabled: !!cwd && enabled,
    refetchOnWindowFocus: true
  })
}

const normCwd = (p: string): string => p.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()

/** A finished turn in a conversation of this project: refresh git once, 500 ms later (debounced). */
export function useRefreshOnResult(cwd: string | undefined): void {
  const qc = useQueryClient()
  React.useEffect(() => {
    if (!cwd) return undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = window.ccwrap.session.onEvent(({ localId, event }) => {
      if (event.t !== 'result') return
      const st = useChatStore.getState()
      const convId = st.localToConv[localId]
      const convCwd = convId ? st.convs[convId]?.cwd : undefined
      if (!convCwd || normCwd(convCwd) !== normCwd(cwd)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        void qc.invalidateQueries({ queryKey: gitKeys.all })
      }, RESULT_REFRESH_MS)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [cwd, qc])
}
