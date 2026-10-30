import type { GitDiff, GitLog, GitStatus } from '../../shared/git'

// WP4 implements this file (D6). WP0 freezes the signatures; the stubs report 'not implemented'.

/** Injected runner (execFile in production). WP4 defines the real shape. */
export type GitRun = (args: string[], opts: { cwd: string; timeoutMs?: number; maxBuffer?: number }) => Promise<{
  code: number
  stdout: string
  stderr: string
}>

export interface GitServiceDeps {
  run?: GitRun
}

const NOT_IMPLEMENTED = { ok: false, code: 'error', message: 'not implemented' } as const

export class GitService {
  constructor(private deps: GitServiceDeps = {}) {
    void this.deps
  }
  async status(_a: { cwd: string }): Promise<GitStatus> {
    return NOT_IMPLEMENTED
  }
  async diff(_a: { cwd: string; path: string; staged: boolean }): Promise<GitDiff> {
    return NOT_IMPLEMENTED
  }
  async log(_a: { cwd: string; limit: number }): Promise<GitLog> {
    return NOT_IMPLEMENTED
  }
}
