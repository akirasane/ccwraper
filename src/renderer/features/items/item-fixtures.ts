import type { ConfigItemSummary, ItemKind } from '@shared/config'

export function item(kind: ItemKind, scope: 'user' | 'project' | 'plugin', name: string, extra: Partial<ConfigItemSummary> = {}): ConfigItemSummary {
  const ref =
    scope === 'plugin'
      ? ({ kind, scope, plugin: 'pl', name } as const)
      : scope === 'user'
        ? ({ kind, scope, name } as const)
        : ({ kind, scope, cwd: 'C:\\proj', name } as const)
  return { ref, kind, scope, name, path: `C:\\x\\${scope}\\${name}`, readOnly: scope === 'plugin', ...extra }
}
