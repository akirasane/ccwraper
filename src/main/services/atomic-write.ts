import { randomBytes } from 'node:crypto'
import { mkdir, open, rename, unlink } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

/** Filesystem operations used by writeFileAtomic; injectable so tests can simulate EPERM. */
export interface AtomicFs {
  mkdir(dir: string): Promise<void>
  /** Create/truncate `file`, write `data`, fsync, close. */
  writeSynced(file: string, data: string | Uint8Array): Promise<void>
  rename(from: string, to: string): Promise<void>
  unlink(file: string): Promise<void>
}

export const nodeAtomicFs: AtomicFs = {
  mkdir: async (dir) => {
    await mkdir(dir, { recursive: true })
  },
  writeSynced: async (file, data) => {
    const fh = await open(file, 'w')
    try {
      await fh.writeFile(data)
      await fh.sync()
    } finally {
      await fh.close()
    }
  },
  rename,
  unlink
}

export interface AtomicWriteOptions {
  /** Retries after the first attempt for transient Windows errors (default 5). */
  retries?: number
  fs?: AtomicFs
  sleep?: (ms: number) => Promise<void>
}

const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES'])

export function isTransientFsError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code
  return typeof code === 'string' && TRANSIENT.has(code)
}

/** 20, 40, 80, 160, 200, 200 ... ms */
export function retryDelayMs(attempt: number): number {
  return Math.min(200, 20 * 2 ** attempt)
}

/**
 * Write `data` to `path` atomically: temp file in the same directory, fsync, rename over the target.
 * Creates missing parent directories. EPERM/EBUSY/EACCES on the rename (antivirus, a CLI holding the
 * file) are retried with backoff. The temp file is removed on failure.
 */
export async function writeFileAtomic(path: string, data: string | Uint8Array, opts: AtomicWriteOptions = {}): Promise<void> {
  const fs = opts.fs ?? nodeAtomicFs
  const retries = opts.retries ?? 5
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const dir = dirname(path)
  const tmp = join(dir, `${basename(path)}.ccwrap-${randomBytes(6).toString('hex')}.tmp`)
  await fs.mkdir(dir)
  try {
    await fs.writeSynced(tmp, data)
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.rename(tmp, path)
        return
      } catch (err) {
        if (!isTransientFsError(err) || attempt >= retries) throw err
        await sleep(retryDelayMs(attempt))
      }
    }
  } catch (err) {
    try {
      await fs.unlink(tmp)
    } catch {
      /* temp may not exist */
    }
    throw err
  }
}
