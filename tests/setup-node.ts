// Node-project test setup (D10): point every config-related env var at a throwaway dir BEFORE any
// test module loads, so no test can read or write the user's real ~/.claude or ~/.claude.json.
import { mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll } from 'vitest'

// Remember the real home once per process so the guard test can assert we moved away from it.
const realHome = process.env['CCWRAP_TEST_REAL_HOME'] ?? homedir()
process.env['CCWRAP_TEST_REAL_HOME'] = realHome

const sandbox = mkdtempSync(join(tmpdir(), 'ccwrap-test-home-'))
process.env['CCWRAP_TEST_HOME'] = sandbox
process.env['USERPROFILE'] = sandbox
process.env['HOME'] = sandbox
process.env['CLAUDE_CONFIG_DIR'] = join(sandbox, '.claude')
// Never let a test pick up the developer's own CLI override.
delete process.env['CCWRAP_CLAUDE_PATH']

afterAll(() => {
  try {
    rmSync(sandbox, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})
