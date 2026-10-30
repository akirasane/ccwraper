import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveSettingsView } from './sdk-settings'
import type { SettingsResolver } from './sdk-settings'

const fx = (n: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(__dirname, '../../../tests/fixtures/config', n), 'utf8')) as Record<string, unknown>

/** A tiny stand-in for the SDK merge: later sources override scalars, permission arrays concatenate. */
function fakeSdk(sources: Array<{ source: string; settings: Record<string, unknown>; path?: string }>): SettingsResolver {
  return {
    async resolveSettings() {
      const effective: Record<string, unknown> = {}
      const provenance: Record<string, { source: string; path?: string }> = {}
      for (const s of sources) {
        for (const [k, v] of Object.entries(s.settings)) {
          if (k === 'permissions') {
            const prev = (effective[k] ?? {}) as Record<string, unknown>
            const cur = v as Record<string, unknown>
            const allow = [...((prev['allow'] as string[]) ?? []), ...((cur['allow'] as string[]) ?? [])]
            effective[k] = { ...prev, ...cur, allow }
          } else effective[k] = v
          provenance[k] = { source: s.source, ...(s.path ? { path: s.path } : {}) }
        }
      }
      return { effective, provenance, sources }
    },
    filterEscalatingDefaultMode(r) {
      const eff = JSON.parse(JSON.stringify(r.effective)) as Record<string, any>
      const mode = eff['permissions']?.defaultMode
      if (['bypassPermissions', 'auto', 'acceptEdits'].includes(mode) && r.provenance['permissions']?.source === 'project')
        delete eff['permissions'].defaultMode
      return eff
    }
  }
}

describe('resolveSettingsView with the real SDK (sandboxed CLAUDE_CONFIG_DIR + temp project)', () => {
  it('keeps user < project < local order and per-key provenance', async () => {
    const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const cfg = process.env['CLAUDE_CONFIG_DIR']!
    expect(cfg.startsWith(process.env['CCWRAP_TEST_HOME']!)).toBe(true) // sandbox guard
    const proj = await mkdtemp(join(tmpdir(), 'ccwrap-resolve-'))
    try {
      await mkdir(cfg, { recursive: true })
      await mkdir(join(proj, '.claude'), { recursive: true })
      await writeFile(join(cfg, 'settings.json'), JSON.stringify(fx('settings-user.json')))
      await writeFile(join(proj, '.claude', 'settings.json'), JSON.stringify(fx('settings-project.json')))
      await writeFile(join(proj, '.claude', 'settings.local.json'), JSON.stringify({ model: 'haiku' }))
      const v = await resolveSettingsView(proj)
      expect(v.error).toBeUndefined()
      const order = v.sources.map((s) => s.source).filter((s) => ['user', 'project', 'local'].includes(s))
      expect(order).toEqual(['user', 'project', 'local'])
      expect(v.effective['model']).toBe('haiku')
      expect(v.provenance['model']?.source).toBe('local')
      expect(v.provenance['env']?.source).toBe('user')
      const allow = (v.effective['permissions'] as { allow: string[] }).allow
      expect(allow).toEqual(expect.arrayContaining(['Read(*)', 'Bash(git status)']))
      expect(v.ignoredDefaultMode).toEqual({ source: 'project', mode: 'bypassPermissions' })
    } finally {
      await rm(proj, { recursive: true, force: true })
    }
  }, 20000)
})

describe('resolveSettingsView', () => {
  const user = { source: 'user', settings: fx('settings-user.json'), path: 'C:\\fixture\\home\\.claude\\settings.json' }
  const project = { source: 'project', settings: fx('settings-project.json'), path: 'C:\\fixture\\proj\\.claude\\settings.json' }
  const local = { source: 'local', settings: { model: 'haiku' }, path: 'C:\\fixture\\proj\\.claude\\settings.local.json' }

  it('keeps the source order as returned and maps provenance per top-level key', async () => {
    const v = await resolveSettingsView('C:\\fixture\\proj', fakeSdk([user, project, local, { source: 'managed', settings: {} }]))
    expect(v.error).toBeUndefined()
    expect(v.cwd).toBe('C:\\fixture\\proj')
    expect(v.sources.map((s) => s.source)).toEqual(['user', 'project', 'local', 'managed'])
    expect(v.sources[0]?.path).toBe(user.path)
    expect(v.effective['model']).toBe('haiku')
    expect(v.provenance['model']).toEqual({ source: 'local', path: local.path })
    expect(v.provenance['env']).toEqual({ source: 'user', path: user.path })
  })

  it('exposes merged permissions.allow from two sources via per-source settings', async () => {
    const v = await resolveSettingsView('C:\\fixture\\proj', fakeSdk([user, project]))
    expect((v.effective['permissions'] as { allow: string[] }).allow).toEqual(['Read(*)', 'Bash(git status)'])
    const tagged = v.sources.flatMap((s) => ((s.settings['permissions'] as { allow?: string[] })?.allow ?? []).map((r) => [s.source, r]))
    expect(tagged).toEqual([
      ['user', 'Read(*)'],
      ['project', 'Bash(git status)']
    ])
  })

  it('reports an escalating defaultMode from a project file as ignored', async () => {
    const v = await resolveSettingsView('C:\\fixture\\proj', fakeSdk([user, project]))
    expect(v.ignoredDefaultMode).toEqual({ source: 'project', mode: 'bypassPermissions' })
  })

  it('does not flag defaultMode when the filter keeps it', async () => {
    const v = await resolveSettingsView(undefined, fakeSdk([user]))
    expect(v.ignoredDefaultMode).toBeUndefined()
    expect(v.cwd).toBeUndefined()
  })

  it('carries policyOrigin for managed sources', async () => {
    const impl = fakeSdk([user])
    const orig = impl.resolveSettings
    impl.resolveSettings = async (o) => {
      const r = await orig(o)
      r.sources.push({ source: 'managed', settings: {}, policyOrigin: 'remote' } as never)
      return r
    }
    const v = await resolveSettingsView(undefined, impl)
    expect(v.sources.at(-1)).toMatchObject({ source: 'managed', policyOrigin: 'remote' })
  })

  it('turns SDK failures into error instead of throwing', async () => {
    const impl: SettingsResolver = {
      resolveSettings: () => Promise.reject(new Error('boom')),
      filterEscalatingDefaultMode: () => ({})
    }
    const v = await resolveSettingsView('C:\\x', impl)
    expect(v).toMatchObject({ error: 'boom', effective: {}, sources: [], cwd: 'C:\\x' })
  })
})
