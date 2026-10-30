// P4 git panel contracts (D6). Plain data; zod-free.

export type GitCode = '.' | 'M' | 'A' | 'D' | 'R' | 'C' | 'T' | 'U' | '?'

export interface GitFileChange {
  /** repo-relative, '/' separators */
  path: string
  origPath?: string
  index: GitCode
  worktree: GitCode
  untracked?: boolean
  conflicted?: boolean
  isDir?: boolean
  added?: number
  removed?: number
  binary?: boolean
}

export type GitErrorCode = 'not_repo' | 'git_missing' | 'timeout' | 'unsafe_repo' | 'bad_path' | 'error'

export type GitStatus =
  | {
      ok: true
      root: string
      branch?: string
      detached: boolean
      upstream?: string
      ahead: number
      behind: number
      files: GitFileChange[]
      truncated: boolean
      total: number
    }
  | { ok: false; code: GitErrorCode; message: string }

export type GitDiff =
  | { ok: true; patch?: string; untrackedText?: string; binary: boolean; truncated: boolean }
  | { ok: false; code: GitErrorCode; message: string }

export interface GitCommit {
  hash: string
  short: string
  subject: string
  author: string
  date: string
}

export type GitLog = { ok: true; commits: GitCommit[] } | { ok: false; code: GitErrorCode; message: string }
