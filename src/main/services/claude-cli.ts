import { execFile } from 'node:child_process'
import { bundledClaudePath, resolveClaudeBinary } from '../paths'

export interface CliResult {
  code: number
  stdout: string
  stderr: string
}
export interface CliOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  timeoutMs: number
}
/** Injectable runner; tests pass a fake. */
export type CliRunner = (args: string[], opts: CliOptions) => Promise<CliResult>

/** `.exe` / bundled binary only: `.cmd` shims are never used (argument quoting). */
export function resolveCliBinary(): string | undefined {
  return resolveClaudeBinary().path ?? bundledClaudePath()
}

/** Run `claude <args>` via execFile (never a shell). Resolves with the exit code, never rejects on non-zero exit. */
export const runClaude: CliRunner = (args, opts) =>
  new Promise<CliResult>((resolve) => {
    const bin = resolveCliBinary()
    if (!bin) {
      resolve({ code: -1, stdout: '', stderr: 'claude binary not found' })
      return
    }
    execFile(
      bin,
      args,
      {
        cwd: opts.cwd,
        env: opts.env ?? process.env,
        timeout: opts.timeoutMs,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
        encoding: 'utf8'
      },
      (err, stdout, stderr) => {
        if (!err) return resolve({ code: 0, stdout, stderr })
        const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: number | string }
        if (typeof e.code === 'number') return resolve({ code: e.code, stdout, stderr })
        const why = e.killed ? `timed out after ${opts.timeoutMs} ms` : e.message
        resolve({ code: -1, stdout: stdout ?? '', stderr: `${stderr ?? ''}${stderr ? '\n' : ''}${why}` })
      }
    )
  })
