import { describe, expect, it } from 'vitest'
import { DEFAULT_OWN } from './ownTheme'
import { readThemeFile, themeFile } from './themeFile'

const NIGHT = { paper: '#14161a', ink: '#e8e4da', accent: '#7fb4d6' }

describe('a theme file', () => {
  it('holds a theme’s colours, under the names Customize gives them, and nothing else', () => {
    expect(JSON.parse(themeFile(NIGHT))).toEqual({ nib: 'theme', page: '#14161a', text: '#e8e4da', accent: '#7fb4d6' })
    expect(JSON.parse(themeFile({ ...NIGHT, shell: '#0b0c0e', highlight: '#3a2f55' }))).toEqual({
      nib: 'theme',
      page: '#14161a',
      text: '#e8e4da',
      accent: '#7fb4d6',
      library: '#0b0c0e',
      highlight: '#3a2f55',
    })
    // One left to be worked out isn't written as nothing.
    expect(themeFile({ ...NIGHT, shell: undefined })).not.toContain('library')
  })

  it('comes back as the theme it was made from', () => {
    for (const colors of [DEFAULT_OWN, NIGHT, { ...NIGHT, shell: '#0b0c0e' }, { ...NIGHT, shell: '#0b0c0e', highlight: '#3a2f55' }]) {
      expect(readThemeFile(themeFile(colors))).toEqual(colors)
    }
  })

  it('is read whatever case its colours are in, and whatever else it holds', () => {
    const file = JSON.stringify({ nib: 'theme', name: 'Night', page: '#14161A', text: '#E8E4DA', accent: '#7FB4D6', css: 'body{display:none}', paper: '#ffffff' })
    expect(readThemeFile(file)).toEqual(NIGHT)
  })

  it('isn’t one unless it says so and has a page, text and accent that are colours', () => {
    const file = { nib: 'theme', page: '#14161a', text: '#e8e4da', accent: '#7fb4d6' }
    for (const not of [
      'not json',
      '[]',
      'null',
      '"theme"',
      JSON.stringify({ ...file, nib: undefined }),
      JSON.stringify({ ...file, nib: 'backup' }),
      JSON.stringify({ ...file, accent: undefined }),
      JSON.stringify({ ...file, page: 'navy' }),
      JSON.stringify({ ...file, text: '#fff' }),
      JSON.stringify({ ...file, page: 'url(https://example.com/x)' }),
      // A library or highlight that's there has to be a colour too: half a theme isn't installed.
      JSON.stringify({ ...file, library: 'transparent' }),
      JSON.stringify({ ...file, highlight: 7 }),
    ]) {
      expect(readThemeFile(not), not).toBe('not-a-theme')
    }
  })

  it('isn’t installed if its text or accent wouldn’t read, on the page, the library or the highlight', () => {
    const file = { nib: 'theme', page: '#14161a', text: '#e8e4da', accent: '#7fb4d6' }
    expect(readThemeFile(JSON.stringify({ ...file, text: '#33312c' }))).toBe('unreadable')
    expect(readThemeFile(JSON.stringify({ ...file, accent: '#1a2a3a' }))).toBe('unreadable')
    expect(readThemeFile(JSON.stringify({ ...file, library: '#d8d4ca' }))).toBe('unreadable')
    expect(readThemeFile(JSON.stringify({ ...file, highlight: '#f5e9a8' }))).toBe('unreadable')
  })
})
