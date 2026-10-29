import { QueryClient } from '@tanstack/react-query'

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 5_000, refetchOnWindowFocus: true } }
  })
}

/** Shared client for the app; tests create their own via createQueryClient(). */
export const queryClient = createQueryClient()
