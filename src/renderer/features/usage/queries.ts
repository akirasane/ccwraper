import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UsageQuery, UsageRangeDays, UsageSummary, UsageTokens } from '@shared/usage'

export const usageKeys = {
  summary: (days: UsageRangeDays, cwd: string | undefined) => ['usage', days, cwd ?? ''] as const
}

export const totalTokens = (t: UsageTokens): number => t.input + t.output + t.cacheRead + t.cacheCreation

function fetchSummary(q: UsageQuery): Promise<UsageSummary> {
  return window.ccwrap.usage.summary(q)
}

export function useUsageSummary(days: UsageRangeDays, cwd: string | undefined) {
  return useQuery({
    queryKey: usageKeys.summary(days, cwd),
    queryFn: () => fetchSummary({ days, ...(cwd ? { cwd } : {}) }),
    placeholderData: keepPreviousData,
    staleTime: 30_000
  })
}

/** Rescan: asks main to ignore its cache (force) and stores the result under the same key. */
export function useRescan(days: UsageRangeDays, cwd: string | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => fetchSummary({ days, ...(cwd ? { cwd } : {}), force: true }),
    onSuccess: (data) => qc.setQueryData(usageKeys.summary(days, cwd), data)
  })
}
