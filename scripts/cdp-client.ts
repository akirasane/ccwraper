// Minimal Chrome DevTools Protocol client + launcher for the built Electron app.
// Used by scripts/cdp-smoke.ts and for ad-hoc live checks. Node >= 22 (global WebSocket / fetch).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

// tsx runs these scripts as CommonJS (package.json has no "type"), so __dirname is available.
export const repoRoot = resolve(__dirname, '..')

export interface LaunchOptions {
  port: number
  userDataDir: string
  /** Extra env for the Electron process. Never redirect USERPROFILE/HOME here: Electron crashes. */
  env?: Record<string, string>
  /** Extra Electron command-line args (e.g. --inspect=9230 to reach the main process). */
  extraArgs?: string[]
  /** Launch a packaged exe instead of electron + the repo (also CCWRAP_SMOKE_EXE). */
  exe?: string
}

export interface Launched {
  child: ChildProcess
  pid: number
  port: number
  /** Kill only the process tree this launcher started. */
  stop: () => void
}

export function launchApp(opts: LaunchOptions): Launched {
  const exe = opts.exe ?? process.env['CCWRAP_SMOKE_EXE'] ?? join(repoRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
  const packaged = !!(opts.exe ?? process.env['CCWRAP_SMOKE_EXE'])
  const env: NodeJS.ProcessEnv = { ...process.env, ...opts.env }
  delete env['ELECTRON_RUN_AS_NODE']
  const child = spawn(exe, [...(packaged ? [] : [repoRoot]), `--remote-debugging-port=${opts.port}`, `--user-data-dir=${opts.userDataDir}`, ...(opts.extraArgs ?? [])], {
    env,
    stdio: 'ignore',
    windowsHide: false
  })
  const pid = child.pid
  if (!pid) throw new Error('electron failed to start')
  return {
    child,
    pid,
    port: opts.port,
    stop: () => {
      // /T kills the tree of the PID we started (renderer, GPU, ptys); nothing else.
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    }
  }
}

export class Cdp {
  private id = 0
  private pending = new Map<number, (m: { result?: unknown; error?: { message: string } }) => void>()
  private constructor(private ws: WebSocket) {
    ws.onmessage = (ev): void => {
      const d = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string } }
      if (d.id !== undefined) this.pending.get(d.id)?.(d)
    }
  }

  static async connect(port: number, timeoutMs = 30_000): Promise<Cdp> {
    const end = Date.now() + timeoutMs
    for (;;) {
      try {
        const list = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Array<{
          type: string
          url: string
          webSocketDebuggerUrl: string
        }>
        const page = list.find((p) => p.type === 'page' && !p.url.startsWith('devtools://'))
        if (page) {
          const ws = new WebSocket(page.webSocketDebuggerUrl)
          await new Promise<void>((res, rej) => {
            ws.onopen = (): void => res()
            ws.onerror = (): void => rej(new Error('ws error'))
          })
          return new Cdp(ws)
        }
      } catch {
        /* app not up yet */
      }
      if (Date.now() > end) throw new Error('CDP page not available')
      await sleep(300)
    }
  }

  send<T = unknown>(method: string, params: object = {}): Promise<T> {
    const id = ++this.id
    return new Promise<T>((res, rej) => {
      this.pending.set(id, (m) => {
        this.pending.delete(id)
        if (m.error) rej(new Error(`${method}: ${m.error.message}`))
        else res(m.result as T)
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  /** Evaluate an expression in the page and return its JSON value. Awaits promises. */
  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await this.send<{ result: { value?: T }; exceptionDetails?: { text: string; exception?: { description?: string } } }>(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true }
    )
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value as T
  }

  async screenshot(file: string): Promise<void> {
    const r = await this.send<{ data: string }>('Page.captureScreenshot', { format: 'png' })
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, Buffer.from(r.data, 'base64'))
  }

  async click(x: number, y: number): Promise<void> {
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 })
    }
  }

  /** Click the first visible element matching a selector (optionally filtered by exact text). */
  async clickSel(selector: string, text?: string): Promise<boolean> {
    const pt = await this.eval<{ x: number; y: number } | null>(`(() => {
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})]
      const el = els.find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (${JSON.stringify(text ?? null)} === null || e.textContent.trim() === ${JSON.stringify(text ?? null)}) })
      if (!el) return null
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`)
    if (!pt) return false
    await this.click(pt.x, pt.y)
    return true
  }

  async insertText(text: string): Promise<void> {
    await this.send('Input.insertText', { text })
  }

  async key(key: string, opts: { code?: string; ctrl?: boolean; shift?: boolean; vk?: number } = {}): Promise<void> {
    const modifiers = (opts.ctrl ? 2 : 0) | (opts.shift ? 8 : 0)
    const base = { key, code: opts.code ?? key, modifiers, windowsVirtualKeyCode: opts.vk ?? 0, text: key.length === 1 && !opts.ctrl ? key : undefined }
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }

  close(): void {
    this.ws.close()
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function waitFor(cdp: Cdp, expression: string, timeoutMs = 15_000, label = expression): Promise<void> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (await cdp.eval<boolean>(`!!(${expression})`).catch(() => false)) return
    await sleep(150)
  }
  throw new Error(`timeout waiting for: ${label}`)
}
