// CDP smoke test of the built app: visits every view, opens the terminal, saves screenshots.
// Run: npm run build && npm run smoke
// Env (all optional):
//   CCWRAP_SMOKE_SHOTS   screenshot dir            (default D:\claude-tmp\p2-shots)
//   CCWRAP_SMOKE_CWD     project to select         (default D:\claude-tmp\p2-live)
//   CCWRAP_SMOKE_PORT    debugging port            (default 9333)
//   CCWRAP_SMOKE_DATA    --user-data-dir           (default D:\claude-tmp\p2-smoke-ud)
//   CLAUDE_CONFIG_DIR    point the app at a sandboxed Claude config (recommended; do NOT redirect USERPROFILE/HOME)
// The script never sends a chat message and never clicks save/add/remove, so it is safe on a real config too.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Cdp, launchApp, sleep, waitFor } from './cdp-client'

const shots = process.env['CCWRAP_SMOKE_SHOTS'] ?? 'D:\\claude-tmp\\p2-shots'
const cwd = process.env['CCWRAP_SMOKE_CWD'] ?? 'D:\\claude-tmp\\p2-live'
const port = Number(process.env['CCWRAP_SMOKE_PORT'] ?? 9333)
const userData = process.env['CCWRAP_SMOKE_DATA'] ?? 'D:\\claude-tmp\\p2-smoke-ud'

async function main(): Promise<void> {
  mkdirSync(shots, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  const app = launchApp({ port, userDataDir: userData })
  let failed = 0
  const step = async (name: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
      console.log(`ok    ${name}`)
    } catch (e) {
      failed++
      console.log(`FAIL  ${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  try {
    const cdp = await Cdp.connect(port)
    await waitFor(cdp, `document.getElementById('root')?.children.length > 0`, 20_000, 'root rendered')
    await cdp.eval(`localStorage.setItem('ccwrap.lastCwd', ${JSON.stringify(cwd)})`)
    await cdp.send('Page.reload')
    await sleep(1500)
    await waitFor(cdp, `document.querySelector('[data-testid=app-shell]')`, 20_000, 'app shell')

    await step('fonts applied', async () => {
      const r = await cdp.eval<{ sans: boolean; mono: boolean; body: string }>(`(async () => {
        await document.fonts.load('13px "Geist Variable"'); await document.fonts.load('13px "Geist Mono Variable"')
        return { sans: document.fonts.check('13px "Geist Variable"'), mono: document.fonts.check('13px "Geist Mono Variable"'), body: getComputedStyle(document.body).fontFamily }
      })()`)
      if (!r.sans || !r.mono || !/Geist/.test(r.body)) throw new Error(JSON.stringify(r))
    })
    await cdp.screenshot(join(shots, 'smoke-chat.png'))

    for (const [label, testId, file] of [
      ['Settings', 'settings-page', 'smoke-settings.png'],
      ['MCP', 'mcp-page', 'smoke-mcp.png'],
      ['Memory', 'memory-page', 'smoke-memory.png']
    ] as const) {
      await step(`view ${label}`, async () => {
        if (!(await cdp.clickSel('nav button, aside button', label))) throw new Error('nav button not found')
        await waitFor(cdp, `document.querySelector('[data-testid=${testId}]')`, 15_000, testId)
        await sleep(800)
        await cdp.screenshot(join(shots, file))
      })
    }
    await cdp.clickSel('nav button', 'Sessions')

    await step('terminal toggle (Ctrl+Backquote)', async () => {
      await cdp.key('`', { code: 'Backquote', ctrl: true, vk: 192 })
      await waitFor(cdp, `document.querySelector('[data-testid=terminal-panel]')`, 15_000, 'terminal panel')
      await sleep(2500)
      await cdp.screenshot(join(shots, 'smoke-terminal.png'))
      await cdp.key('`', { code: 'Backquote', ctrl: true, vk: 192 })
    })
    cdp.close()
  } finally {
    app.stop()
  }
  if (failed > 0) {
    console.log(`${failed} step(s) failed`)
    process.exitCode = 1
  } else console.log('smoke passed; screenshots in ' + shots)
}

void main()
