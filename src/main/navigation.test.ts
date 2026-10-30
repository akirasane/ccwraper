import { describe, expect, it } from 'vitest'
import { isAppNavigation } from './navigation'

const indexHtmlPath = process.platform === 'win32' ? 'C:\\app\\resources\\app.asar\\out\\renderer\\index.html' : '/app/out/renderer/index.html'
const fileUrl = process.platform === 'win32' ? 'file:///C:/app/resources/app.asar/out/renderer/index.html' : 'file:///app/out/renderer/index.html'

describe('isAppNavigation', () => {
  it('allows exactly the packaged index.html (query and hash ignored)', () => {
    expect(isAppNavigation(fileUrl, { indexHtmlPath })).toBe(true)
    expect(isAppNavigation(`${fileUrl}#/x`, { indexHtmlPath })).toBe(true)
    expect(isAppNavigation(`${fileUrl}?a=1`, { indexHtmlPath })).toBe(true)
  })
  it('rejects any other file:// URL', () => {
    expect(isAppNavigation('file:///C:/Windows/System32/drivers/etc/hosts', { indexHtmlPath })).toBe(false)
    expect(isAppNavigation(fileUrl.replace('index.html', 'other.html'), { indexHtmlPath })).toBe(false)
  })
  it('allows only the dev server origin in dev', () => {
    const urls = { indexHtmlPath, devUrl: 'http://localhost:5173/' }
    expect(isAppNavigation('http://localhost:5173/', urls)).toBe(true)
    expect(isAppNavigation('http://localhost:5173/#x', urls)).toBe(true)
    expect(isAppNavigation('http://localhost:5174/', urls)).toBe(false)
    expect(isAppNavigation('https://example.com/', urls)).toBe(false)
  })
  it('rejects remote and malformed URLs when packaged', () => {
    expect(isAppNavigation('https://example.com/', { indexHtmlPath })).toBe(false)
    expect(isAppNavigation('not a url', { indexHtmlPath })).toBe(false)
    expect(isAppNavigation('javascript:alert(1)', { indexHtmlPath })).toBe(false)
  })
})
