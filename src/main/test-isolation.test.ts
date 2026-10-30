import { homedir } from 'node:os'
import { join, relative, isAbsolute } from 'node:path'
import { describe, expect, it } from 'vitest'
import { claudeConfigDir, claudeGlobalConfigPath } from './paths'

function isUnder(child: string, parent: string): boolean {
  const rel = relative(parent.toLowerCase(), child.toLowerCase())
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

describe('test isolation guard (tests/setup-node.ts)', () => {
  const realHome = process.env['CCWRAP_TEST_REAL_HOME']

  it('recorded the real home before redirecting', () => {
    expect(realHome).toBeTruthy()
  })

  it('home env vars point at the temp sandbox, not the real home', () => {
    const sandbox = process.env['CCWRAP_TEST_HOME']!
    expect(sandbox).not.toBe(realHome)
    expect(process.env['USERPROFILE']).toBe(sandbox)
    expect(process.env['HOME']).toBe(sandbox)
    expect(homedir()).toBe(sandbox)
    expect(isUnder(sandbox, realHome!)).toBe(false)
  })

  it('claudeConfigDir() and the global config path are not under the real home', () => {
    expect(isUnder(claudeConfigDir(), realHome!)).toBe(false)
    expect(isUnder(claudeGlobalConfigPath(), realHome!)).toBe(false)
    expect(claudeConfigDir()).toBe(join(process.env['CCWRAP_TEST_HOME']!, '.claude'))
  })

  it('even with CLAUDE_CONFIG_DIR unset, the home fallback stays in the sandbox', () => {
    const noEnv = {} as Record<string, string | undefined>
    expect(isUnder(claudeConfigDir(noEnv), realHome!)).toBe(false)
    expect(isUnder(claudeGlobalConfigPath(noEnv), realHome!)).toBe(false)
  })
})
