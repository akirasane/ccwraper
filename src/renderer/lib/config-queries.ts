import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { ConfigFileRef, FsChangedPayload, ItemKind } from '@shared/config'

// Query-key seam shared by the settings / MCP / memory features (frozen in P2 WP0).
// Keys: ['config', refKey], ['settings-resolve', cwd], ['mcp', cwd].

function normCwd(p: string | undefined): string {
  return p ? p.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase() : ''
}

/** Stable string for a ConfigFileRef (slash style / case of cwd ignored). */
export function refKey(ref: ConfigFileRef): string {
  if (ref.scope === 'plugin') return `${ref.kind}:plugin:${ref.plugin}:${ref.name}`
  const where = ref.scope === 'user' ? '' : normCwd(ref.cwd)
  // Items carry a name: `kind:scope:cwd-or-plugin:name`.
  return 'name' in ref ? `${ref.kind}:${ref.scope}:${where}:${ref.name}` : `${ref.kind}:${ref.scope}:${where}`
}

export const configKeys = {
  file: (ref: ConfigFileRef) => ['config', refKey(ref)] as const,
  /** ['items', kind, normCwd]; invalidate ['items', kind] for all cwds. */
  items: (kind: ItemKind, cwd: string | undefined) => ['items', kind, normCwd(cwd)] as const,
  settingsResolve: (cwd: string | undefined) => ['settings-resolve', normCwd(cwd)] as const,
  mcp: (cwd: string | undefined) => ['mcp', normCwd(cwd)] as const
}

/** Query-key prefixes to invalidate for one fs:changed payload. Exported for tests. */
export function keysForChange(p: FsChangedPayload): Array<readonly unknown[]> {
  if (p.kind === 'mcp') return [['mcp']]
  if (p.kind === 'skill' || p.kind === 'command' || p.kind === 'agent') {
    // An item file changed: refresh the list for this kind and every open item buffer of this kind.
    return [['items', p.kind], ['config']]
  }
  const out: Array<readonly unknown[]> = []
  if (p.scope) {
    const scope = p.scope as ConfigFileRef['scope']
    const ref = { kind: p.kind, scope, ...(p.cwd ? { cwd: p.cwd } : {}) } as ConfigFileRef
    out.push(configKeys.file(ref))
  } else {
    out.push(['config'])
  }
  if (p.kind === 'settings') out.push(['settings-resolve'], ['mcp']) // approval flags live in settings
  return out
}

/** Subscribe to `config.onChanged` once and invalidate the matching queries. Mount once (AppShell). */
export function useFsChangedInvalidation(): void {
  const qc = useQueryClient()
  useEffect(() => {
    const cfg = window.ccwrap?.config
    if (!cfg?.onChanged) return
    return cfg.onChanged((p) => {
      for (const queryKey of keysForChange(p)) void qc.invalidateQueries({ queryKey })
    })
  }, [qc])
}
