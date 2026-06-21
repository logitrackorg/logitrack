import { describe, it, expect } from 'vitest'
import { getGoogleFontsUrl } from './fonts'

describe('getGoogleFontsUrl', () => {
  it('returns full URL for Inter', () => {
    expect(getGoogleFontsUrl('Inter')).toBe(
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap',
    )
  })

  it('returns null for System UI', () => {
    expect(getGoogleFontsUrl('System UI')).toBeNull()
  })

  it('includes wght parameter for Roboto', () => {
    const url = getGoogleFontsUrl('Roboto')!
    expect(url).toContain('wght@400;600;700')
  })

  it('includes display=swap for Source Sans 3', () => {
    const url = getGoogleFontsUrl('Source Sans 3')!
    expect(url).toContain('display=swap')
  })
})
