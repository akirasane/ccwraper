import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { App, parseRoute } from './App'

describe('hash router', () => {
  it('parses routes', () => {
    expect(parseRoute('#/design')).toBe('design')
    expect(parseRoute('#/debug')).toBe('debug')
    expect(parseRoute('')).toBe('app')
  })

  it('renders AppShell by default and DesignPage on #/design', () => {
    window.location.hash = ''
    const { unmount } = render(<App />)
    expect(screen.getByTestId('app-shell')).toBeInTheDocument()
    unmount()
    window.location.hash = '#/design'
    render(<App />)
    expect(screen.getByTestId('design-page')).toBeInTheDocument()
    window.location.hash = ''
  })
})
