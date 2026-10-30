// Renders build/icon.png (1024 px) under Electron: `npm run icon` (= electron scripts/make-icon.mjs).
// electron-builder converts the PNG to .ico. No image dependency needed.
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const { app, BrowserWindow } = createRequire(import.meta.url)('electron')
const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png')
const SIZE = 1024

const svg = `<svg style="display:block" xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e8946b"/>
      <stop offset="1" stop-color="#c4562f"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="#1b1a19"/>
  <rect x="64" y="64" width="896" height="896" rx="200" fill="none" stroke="#3a3836" stroke-width="8"/>
  <path d="M300 330 L520 512 L300 694" fill="none" stroke="url(#g)" stroke-width="96" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="580" y="640" width="168" height="96" rx="48" fill="url(#g)"/>
</svg>`

// Hard stop so a stuck capture can never leave an Electron process behind.
setTimeout(() => {
  console.error('make-icon timed out')
  app.exit(1)
}, 30_000).unref()

// No top-level await on app.whenReady(): Electron waits for the entry module to finish before 'ready'.
async function main() {
  await app.whenReady()
  const win = new BrowserWindow({
    show: false,
    width: SIZE,
    height: SIZE,
    useContentSize: true,
    transparent: true,
    frame: false,
    webPreferences: { offscreen: true }
  })
  const html = `<!doctype html><html><body style="margin:0;overflow:hidden;background:transparent">${svg}</body></html>`
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  await new Promise((r) => setTimeout(r, 800))
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE })
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, img.toPNG())
  console.error('wrote', out, JSON.stringify(img.getSize()))
  app.exit(0)
}

main().catch((e) => {
  console.error(e)
  app.exit(1)
})
