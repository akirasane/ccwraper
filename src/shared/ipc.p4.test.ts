import { describe, expect, it } from 'vitest'
import { DEFAULT_PREFS } from './app'
import {
  AppPrefsPatchSchema,
  AuthStatusArgsSchema,
  GitDiffSchema,
  GitLogSchema,
  GitStatusSchema,
  IpcChannels,
  SetActiveSessionSchema,
  UsageQuerySchema
} from './ipc'
import { assumedContextWindow } from './models'

const CWD = 'C:\\proj\\repo'

describe('git schemas', () => {
  const ok = (path: string): boolean => GitDiffSchema.safeParse({ cwd: CWD, path, staged: false }).success

  it('accepts repo-relative paths', () => {
    expect(ok('src/a.ts')).toBe(true)
    expect(ok('dir with space/ü.txt')).toBe(true)
    expect(ok('a..b/c')).toBe(true)
  })
  it('rejects absolute, parent-escaping and NUL paths', () => {
    expect(ok('C:\\x')).toBe(false)
    expect(ok('C:x')).toBe(false)
    expect(ok('/etc/passwd')).toBe(false)
    expect(ok('\\\\server\\share')).toBe(false)
    expect(ok('../x')).toBe(false)
    expect(ok('a/../../x')).toBe(false)
    expect(ok('a\\..\\x')).toBe(false)
    expect(ok('a\u0000b')).toBe(false)
    expect(ok('')).toBe(false)
    expect(ok('x'.repeat(4097))).toBe(false)
  })
  it('requires an absolute cwd', () => {
    expect(GitStatusSchema.safeParse({ cwd: 'rel/dir' }).success).toBe(false)
    expect(GitStatusSchema.safeParse({ cwd: CWD }).success).toBe(true)
  })
  it('bounds the log limit', () => {
    expect(GitLogSchema.safeParse({ cwd: CWD, limit: 50 }).success).toBe(true)
    expect(GitLogSchema.safeParse({ cwd: CWD, limit: 0 }).success).toBe(false)
    expect(GitLogSchema.safeParse({ cwd: CWD, limit: 201 }).success).toBe(false)
    expect(GitLogSchema.safeParse({ cwd: CWD, limit: 1.5 }).success).toBe(false)
  })
})

describe('prefs patch schema', () => {
  it('accepts partial patches', () => {
    expect(AppPrefsPatchSchema.safeParse({}).success).toBe(true)
    expect(AppPrefsPatchSchema.safeParse({ notifications: { turnDoneMinSeconds: 0 } }).success).toBe(true)
    expect(AppPrefsPatchSchema.safeParse({ hotkey: { accelerator: 'Control+Alt+K' }, confirmQuitWhileRunning: false }).success).toBe(true)
  })
  it('enforces bounds and strictness', () => {
    expect(AppPrefsPatchSchema.safeParse({ notifications: { turnDoneMinSeconds: -1 } }).success).toBe(false)
    expect(AppPrefsPatchSchema.safeParse({ notifications: { turnDoneMinSeconds: 3601 } }).success).toBe(false)
    expect(AppPrefsPatchSchema.safeParse({ notifications: { turnDoneMinSeconds: 1.5 } }).success).toBe(false)
    expect(AppPrefsPatchSchema.safeParse({ hotkey: { accelerator: '' } }).success).toBe(false)
    expect(AppPrefsPatchSchema.safeParse({ hotkey: { accelerator: 'x'.repeat(65) } }).success).toBe(false)
    expect(AppPrefsPatchSchema.safeParse({ extra: 1 }).success).toBe(false)
    expect(AppPrefsPatchSchema.safeParse({ notifications: { bogus: true } }).success).toBe(false)
    expect(AppPrefsPatchSchema.safeParse({ version: 2 }).success).toBe(false)
  })
})

describe('usage / auth / active-session schemas', () => {
  it('days is a literal union', () => {
    for (const days of [7, 30, 90, 365]) expect(UsageQuerySchema.safeParse({ days }).success).toBe(true)
    for (const days of [1, 14, 366, '30']) expect(UsageQuerySchema.safeParse({ days }).success).toBe(false)
  })
  it('usage cwd must be absolute', () => {
    expect(UsageQuerySchema.safeParse({ days: 7, cwd: CWD, force: true }).success).toBe(true)
    expect(UsageQuerySchema.safeParse({ days: 7, cwd: 'rel' }).success).toBe(false)
  })
  it('auth args and active session', () => {
    expect(AuthStatusArgsSchema.safeParse({}).success).toBe(true)
    expect(AuthStatusArgsSchema.safeParse({ refresh: true }).success).toBe(true)
    expect(AuthStatusArgsSchema.safeParse({ refresh: 'yes' }).success).toBe(false)
    expect(SetActiveSessionSchema.safeParse({ localId: null }).success).toBe(true)
    expect(SetActiveSessionSchema.safeParse({ localId: 'abc' }).success).toBe(true)
    expect(SetActiveSessionSchema.safeParse({ localId: 3 }).success).toBe(false)
  })
})

describe('P4 channels and defaults', () => {
  it('channel names are frozen', () => {
    expect(IpcChannels.appAuthStatus).toBe('app:authStatus')
    expect(IpcChannels.appSetActiveSession).toBe('app:setActiveSession')
    expect(IpcChannels.appFocusSession).toBe('app:focusSession')
    expect(IpcChannels.prefsGet).toBe('prefs:get')
    expect(IpcChannels.prefsSet).toBe('prefs:set')
    expect(IpcChannels.prefsChanged).toBe('prefs:changed')
    expect(IpcChannels.usageSummary).toBe('usage:summary')
    expect(IpcChannels.gitStatus).toBe('git:status')
    expect(IpcChannels.gitDiff).toBe('git:diff')
    expect(IpcChannels.gitLog).toBe('git:log')
  })
  it('default prefs: hotkey off, notifications on', () => {
    expect(DEFAULT_PREFS.hotkey.enabled).toBe(false)
    expect(DEFAULT_PREFS.notifications.enabled).toBe(true)
    expect(DEFAULT_PREFS.notifications.turnDoneMinSeconds).toBe(15)
  })
  it('assumedContextWindow', () => {
    expect(assumedContextWindow('claude-opus-4[1m]')).toBe(1_000_000)
    expect(assumedContextWindow('claude-haiku-4-5')).toBe(200_000)
    expect(assumedContextWindow(undefined)).toBe(200_000)
  })
})
