// Third SDK boundary file (P2 D5): settings precedence via the SDK's resolveSettings(). SDK types stay in here.
import type { ResolvedSettingsView, ResolvedSource } from '../../shared/config'

interface SdkResolved {
  effective: Record<string, unknown>
  provenance: Record<string, { source: string; path?: string } | undefined>
  sources: Array<{ source: string; settings: Record<string, unknown>; path?: string; policyOrigin?: unknown }>
}

export interface SettingsResolver {
  resolveSettings(opts?: { cwd?: string }): Promise<SdkResolved>
  filterEscalatingDefaultMode(resolved: SdkResolved): Record<string, unknown>
}

async function loadSdk(): Promise<SettingsResolver> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  return {
    resolveSettings: (o) => sdk.resolveSettings(o) as unknown as Promise<SdkResolved>,
    filterEscalatingDefaultMode: (r) => sdk.filterEscalatingDefaultMode(r as never) as unknown as Record<string, unknown>
  }
}

const ESCALATING = new Set(['bypassPermissions', 'auto', 'acceptEdits'])

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function policyOriginString(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  return typeof v === 'string' ? v : JSON.stringify(v)
}

/**
 * Resolve the effective settings for `cwd` with the CLI's own merge engine. Source order is kept exactly
 * as the SDK returns it (low -> high). Never throws: failures become `error`.
 */
export async function resolveSettingsView(cwd?: string, impl?: SettingsResolver): Promise<ResolvedSettingsView> {
  const base: ResolvedSettingsView = { ...(cwd ? { cwd } : {}), effective: {}, provenance: {}, sources: [] }
  try {
    const sdk = impl ?? (await loadSdk())
    const resolved = await sdk.resolveSettings(cwd ? { cwd } : undefined)
    const effective = asRecord(resolved.effective)
    const provenance: ResolvedSettingsView['provenance'] = {}
    for (const [key, p] of Object.entries(resolved.provenance ?? {})) {
      if (!p) continue
      provenance[key] = { source: p.source as ResolvedSource, ...(p.path ? { path: p.path } : {}) }
    }
    const sources = (resolved.sources ?? []).map((s) => {
      const origin = policyOriginString(s.policyOrigin)
      return {
        source: s.source as ResolvedSource,
        ...(s.path ? { path: s.path } : {}),
        ...(origin ? { policyOrigin: origin } : {}),
        settings: asRecord(s.settings)
      }
    })
    const view: ResolvedSettingsView = { ...base, effective, provenance, sources }

    // An escalating defaultMode set by a project-committed file is dropped by the CLI; report it.
    const mode = asRecord(effective['permissions'])['defaultMode']
    if (typeof mode === 'string' && ESCALATING.has(mode)) {
      const filtered = asRecord(asRecord(sdk.filterEscalatingDefaultMode(resolved)).permissions)['defaultMode']
      if (filtered !== mode) {
        const src = provenance['permissions']?.source ?? 'project'
        // provenance is per top-level key, so find the highest tier that actually set this mode
        const setter = [...sources].reverse().find((s) => asRecord(s.settings['permissions'])['defaultMode'] === mode)
        view.ignoredDefaultMode = { source: setter?.source ?? src, mode }
      }
    }
    return view
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) }
  }
}
