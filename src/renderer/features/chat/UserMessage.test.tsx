import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UserMessage } from './UserMessage'

describe('UserMessage', () => {
  it('renders attached images and text', () => {
    render(<UserMessage text="what is this" images={[{ mediaType: 'image/png', data: 'AAAA' }]} />)
    const img = screen.getByAltText('Attached image 1') as HTMLImageElement
    expect(img.src).toBe('data:image/png;base64,AAAA')
    expect(screen.getByText('what is this')).toBeTruthy()
  })
  it('renders an image-only message without an empty paragraph', () => {
    const { container } = render(<UserMessage text="" images={[{ mediaType: 'image/png', data: 'AAAA' }]} />)
    expect(container.querySelector('p')).toBeNull()
  })
})
