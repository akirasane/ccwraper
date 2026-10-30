// Packaged-app smoke: launches dist\win-unpacked\ccwraper.exe (build it first with `npm run dist:dir`) and checks
// what only differs when packaged: asar-unpacked node-pty/claude.exe, CSP from file://, single instance, no DevTools/reload.
// Run: npx tsx scripts/pkg-smoke.ts
// Env:
//   CCWRAP_PKG_LIVE=1   instead of the checks, run ONE haiku "Reply with just the word hi" turn with the bundled claude.exe
//                       against the REAL config (needs the login; about $0.01). Without it a sandbox CLAUDE_CONFIG_DIR is used
//                       and no model call is ever made.
//   CCWRAP_PKG_UD / CCWRAP_PKG_CFG / CCWRAP_PKG_CWD / CCWRAP_PKG_PORT   paths and port (defaults under D:\claude-tmp)
// Never redirects USERPROFILE/HOME. Kills only the process tree it started (by PID). Never runs the installer.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Cdp, repoRoot, sleep, waitFor } from './cdp-client'

const exe = join(repoRoot, 'dist', 'win-unpacked', 'ccwraper.exe')
const userData = process.env['CCWRAP_PKG_UD'] ?? 'D:\\claude-tmp\\p4-pkg-ud'
const cfgDir = process.env['CCWRAP_PKG_CFG'] ?? 'D:\\claude-tmp\\p4-pkg-cfg'
const cwd = process.env['CCWRAP_PKG_CWD'] ?? 'D:\\claude-tmp\\p4-live'
const port = Number(process.env['CCWRAP_PKG_PORT'] ?? 9555)
const live = process.env['CCWRAP_PKG_LIVE'] === '1'
const shots = 'D:\\claude-tmp\\p4-pkg-shots'

interface Proc {
  ProcessId: number
  ParentProcessId: number
  Name: string
  ExecutablePath: string | null
}

function processes(): Proc[] {
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath | ConvertTo-Json -Compress'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true }
  )
  const v = JSON.parse(r.stdout || '[]') as Proc | Proc[]
  return Array.isArray(v) ? v : [v]
}

function descendants(root: number, all: Proc[]): Proc[] {
  const out: Proc[] = []
  const seen = new Set<number>([root])
  for (let grew = true; grew; ) {
    grew = false
    for (const p of all) {
      if (!seen.has(p.ProcessId) && seen.has(p.ParentProcessId)) {
        seen.add(p.ProcessId)
        out.push(p)
        grew = true
      }
    }
  }
  return out
}

async function main(): Promise<void> {
  if (!existsSync(exe)) throw new Error(`missing ${exe}; run npm run dist:dir first`)
  mkdirSync(userData, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  mkdirSync(shots, { recursive: true })
  const env: NodeJS.ProcessEnv = { ...process.env, CCWRAP_CLAUDE_SOURCE: 'bundled' }
  delete env['ELECTRON_RUN_AS_NODE']
  if (!live) {
    mkdirSync(cfgDir, { recursive: true })
    env['CLAUDE_CONFIG_DIR'] = cfgDir
  }
  const child = spawn(exe, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`], { env, stdio: 'ignore', cwd: 'D:\\claude-tmp' })
  const pid = child.pid
  if (!pid) throw new Error('failed to start')
  let failed = 0
  const step = async (name: string, fn: () => Promise<string | void>): Promise<void> => {
    try {
      const note = await fn()
      console.log(`ok    ${name}${note ? ' :: ' + note : ''}`)
    } catch (e) {
      failed++
      console.log(`FAIL  ${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  try {
    const cdp = await Cdp.connect(port)
    // Record CSP violations from the very first document load.
    await cdp.send('Page.enable')
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));`
    })
    await cdp.eval(`localStorage.setItem('ccwrap.lastCwd', ${JSON.stringify(cwd)})`)
    await cdp.send('Page.reload')
    await sleep(1500)
    await waitFor(cdp, `document.querySelector('[data-testid=app-shell]')`, 30_000, 'app shell')

    await step('fonts load from file:// and CSP has no violations', async () => {
      const r = await cdp.eval<{ sans: boolean; mono: boolean; csp: string[] }>(`(async () => {
        await document.fonts.load('13px "Geist Variable"'); await document.fonts.load('13px "Geist Mono Variable"')
        return { sans: document.fonts.check('13px "Geist Variable"'), mono: document.fonts.check('13px "Geist Mono Variable"'), csp: window.__csp }
      })()`)
      if (!r.sans || !r.mono) throw new Error('fonts missing ' + JSON.stringify(r))
      if (r.csp.length) throw new Error('CSP violations: ' + r.csp.join('; '))
      await cdp.screenshot(join(shots, 'pkg-chat.png'))
    })

    await step('CSP is enforced (inline script blocked; CDP eval bypasses the eval rule so it is not probed)', async () => {
      const r = await cdp.eval<{ inlineBlocked: boolean }>(`(async () => {
        window.__inline = 0
        const s = document.createElement('script'); s.textContent = 'window.__inline = 1'; document.head.appendChild(s)
        await new Promise((r) => setTimeout(r, 100))
        return { inlineBlocked: window.__inline === 0 }
      })()`)
      if (!r.inlineBlocked) throw new Error(JSON.stringify(r))
    })

    await step('app.info: packaged, bundled, userData', async () => {
      const i = await cdp.eval<Record<string, unknown>>(`window.ccwrap.app.info()`)
      if (i['packaged'] !== true) throw new Error('packaged != true: ' + JSON.stringify(i))
      if (i['claudeSource'] !== 'bundled') throw new Error('claudeSource: ' + String(i['claudeSource']))
      if (String(i['userDataDir']).toLowerCase() !== userData.toLowerCase()) throw new Error('userDataDir: ' + String(i['userDataDir']))
      return JSON.stringify(i)
    })

    if (!live) {
      await step('terminal: pwsh and Git Bash open, echo, exit; OpenConsole from app.asar.unpacked; no leftovers', async () => {
        const shells = await cdp.eval<Array<{ id: string; label: string }>>(`window.ccwrap.pty.listShells()`)
        const ids = shells.map((s) => s.id)
        if (!ids.includes('pwsh') || !ids.includes('gitbash')) throw new Error('shells: ' + JSON.stringify(shells))
        const result = await cdp.eval<Record<string, { out: boolean; exited: boolean }>>(`(async () => {
          const res = {}
          const bufs = {}, ptyOf = {}
          const off1 = window.ccwrap.pty.onData((p) => { bufs[p.ptyId] = (bufs[p.ptyId] || '') + p.data })
          const exited = {}
          const off2 = window.ccwrap.pty.onExit((p) => { exited[p.ptyId] = true })
          const wait = async (f, ms) => { const e = Date.now() + ms; while (Date.now() < e) { if (f()) return true; await new Promise((r) => setTimeout(r, 100)) } return false }
          for (const shellId of ['pwsh', 'gitbash']) {
            const o = await window.ccwrap.pty.open({ shellId, cwd: ${JSON.stringify(cwd)}, cols: 100, rows: 30 })
            const id = o.ptyId ?? o.id ?? o
            ptyOf[shellId] = id
            await new Promise((r) => setTimeout(r, 1500))
            window.ccwrap.pty.write(id, 'echo pkg-' + 'ok-' + shellId + '\\r')
            const gotOut = await wait(() => (bufs[id] || '').includes('pkg-ok-' + shellId), 10000)
            res[shellId] = { out: gotOut, exited: false }
            if (shellId === 'pwsh') window.__procProbe = true
            await new Promise((r) => setTimeout(r, 300))
            res[shellId].open = true
            window.__ptys = ptyOf
          }
          window.__ptyRes = res; window.__exited = exited; window.__off = [off1, off2]
          return res
        })()`)
        for (const [k, v] of Object.entries(result)) if (!v.out) throw new Error(`${k}: no echo output`)
        // Both ptys are still open here: OpenConsole must run from the unpacked prebuilds.
        const procs = processes()
        const kids = descendants(pid, procs)
        const oc = kids.filter((p) => /openconsole/i.test(p.Name))
        if (!oc.length) throw new Error('no OpenConsole descendant; kids=' + kids.map((k) => k.Name).join(','))
        const bad = oc.filter((p) => !/app\.asar\.unpacked[\\/]node_modules[\\/]node-pty/i.test(p.ExecutablePath ?? ''))
        if (bad.length) throw new Error('OpenConsole outside unpacked: ' + bad.map((b) => b.ExecutablePath).join(','))
        const ocPath = oc[0]!.ExecutablePath
        // exit both shells and wait for pty:exit.
        const exited = await cdp.eval<boolean>(`(async () => {
          for (const id of Object.values(window.__ptys)) window.ccwrap.pty.write(id, 'exit\\r')
          const e = Date.now() + 10000
          while (Date.now() < e) { if (Object.values(window.__ptys).every((id) => window.__exited[id])) return true; await new Promise((r) => setTimeout(r, 150)) }
          return false
        })()`)
        if (!exited) throw new Error('shells did not exit after "exit"')
        await sleep(1500)
        const left = descendants(pid, processes()).filter((p) => /openconsole|conhost|pwsh|bash/i.test(p.Name))
        if (left.length) throw new Error('descendants left after exit: ' + left.map((p) => `${p.Name}(${p.ProcessId})`).join(','))
        return 'OpenConsole=' + ocPath
      })

      await step('no DevTools, F5 / Ctrl+R do not reload', async () => {
        await cdp.eval(`window.__marker = 'alive'`)
        await cdp.key('F12', { code: 'F12', vk: 123 })
        await cdp.key('I', { code: 'KeyI', ctrl: true, shift: true, vk: 73 })
        await cdp.key('r', { code: 'KeyR', ctrl: true, vk: 82 })
        await cdp.key('F5', { code: 'F5', vk: 116 })
        await sleep(1500)
        const marker = await cdp.eval<string>(`window.__marker`)
        if (marker !== 'alive') throw new Error('page reloaded')
        const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Array<{ type: string; url: string }>
        if (targets.some((t) => t.url.startsWith('devtools://'))) throw new Error('a DevTools target exists')
      })

      await step('second launch hands over and exits (single instance)', async () => {
        const before = processes().filter((p) => /^ccwraper\.exe$/i.test(p.Name)).length
        const second = spawn(exe, [`--user-data-dir=${userData}`], { env, stdio: 'ignore', cwd: 'D:\\claude-tmp' })
        const code = await new Promise<number | null>((res) => {
          const t = setTimeout(() => res(null), 15_000)
          second.on('exit', (c) => {
            clearTimeout(t)
            res(c)
          })
        })
        if (code === null) {
          if (second.pid) spawnSync('taskkill', ['/PID', String(second.pid), '/T', '/F'], { stdio: 'ignore' })
          throw new Error('second instance did not exit')
        }
        const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Array<{ type: string }>
        const pages = targets.filter((t) => t.type === 'page').length
        if (pages !== 1) throw new Error(`expected 1 page, got ${pages}`)
        const after = processes().filter((p) => /^ccwraper\.exe$/i.test(p.Name)).length
        return `second exit code ${code}; ccwraper.exe procs ${before} -> ${after}; pages ${pages}`
      })
    } else {
      await step('LIVE: one haiku turn spawns claude.exe from app.asar.unpacked', async () => {
        await cdp.clickSel('button', 'New session')
        await sleep(600)
        await cdp.clickSel('button[aria-label^="Model:"]')
        await sleep(400)
        if (!(await cdp.clickSel('[role=menu] *, [role=menuitem] *', 'Haiku 5.5')) && !(await cdp.clickSel('[role=menu] *, [role=menuitem] *', 'Haiku'))) throw new Error('Haiku not in the model menu')
        await cdp.clickSel('textarea[aria-label=Message]')
        await cdp.insertText('Reply with just the word hi')
        await cdp.key('Enter', { code: 'Enter', vk: 13 })
        const seen = new Set<string>()
        const end = Date.now() + 120_000
        let done = false
        while (Date.now() < end && !done) {
          for (const p of descendants(pid, processes())) if (/^claude\.exe$/i.test(p.Name) && p.ExecutablePath) seen.add(p.ExecutablePath)
          done = await cdp.eval<boolean>(`document.querySelector('[data-testid=status-state]')?.innerText === 'Idle' && !!document.querySelector('[data-testid=assistant-message], [data-testid=message-assistant]') || /\\bhi\\b/i.test(document.body.innerText) && document.querySelector('[data-testid=status-state]')?.innerText === 'Idle'`)
          await sleep(500)
        }
        await cdp.screenshot(join(shots, 'pkg-live.png'))
        if (!done) throw new Error('turn did not finish; seen=' + [...seen].join(','))
        if (!seen.size) throw new Error('never saw a claude.exe child')
        const bad = [...seen].filter((s) => !/app\.asar\.unpacked/i.test(s))
        if (bad.length) throw new Error('claude.exe outside unpacked: ' + bad.join(','))
        const cost = await cdp.eval<string | null>(`document.querySelector('[data-testid=status-turn]')?.innerText ?? null`)
        return `claude.exe=${[...seen].join(',')} turn=${cost}`
      })
    }
    cdp.close()
  } finally {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  }
  if (failed > 0) {
    console.log(`${failed} step(s) failed`)
    process.exitCode = 1
  } else console.log('packaged smoke passed')
}

void main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
