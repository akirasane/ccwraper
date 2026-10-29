import { useQuery } from '@tanstack/react-query'

export const queryKeys = {
  projects: ['projects'] as const,
  sessions: (cwd: string) => ['sessions', cwd] as const,
  appInfo: ['app-info'] as const
}

export function useProjects() {
  return useQuery({ queryKey: queryKeys.projects, queryFn: () => window.ccwrap.history.listProjects() })
}

export function useSessions(cwd: string | undefined) {
  return useQuery({
    queryKey: queryKeys.sessions(cwd ?? ''),
    queryFn: () => window.ccwrap.history.list({ cwd: cwd! }),
    enabled: !!cwd
  })
}

export function useAppInfo() {
  return useQuery({ queryKey: queryKeys.appInfo, queryFn: () => window.ccwrap.app.info(), staleTime: Infinity })
}
