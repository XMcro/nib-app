import { describe, expect, it } from 'vitest'
import { DEFAULT_OWN, OWN_MIN, OWN_VARS, contrast, palette, readable } from './ownTheme'

// A seeded random colour, so a failure can be replayed.
function* colours(seed = 7) {
  for (;;) {
    seed = (seed * 16807) % 2147483647
    yield '#' + (seed % 0x1000000).toString(16).padStart(6, '0')
  }
}

describe('a theme of one’s own', () => {
  it('refuses text or an accent that would not read on the page', () => {
    expect(readable(DEFAULT_OWN).ok).toBe(true)
    expect(readable({ paper: '#ffffff', ink: '#cccccc', accent: '#1f64bf' })).toMatchObject({ ok: false })
    expect(readable({ paper: '#ffffff', ink: '#1a1a1a', accent: '#ffcc00' })).toMatchObject({ ok: false })
  })

  // Muted text and the highlight are worked out, so they are held to their
  // contrast for any page, text and accent that read: 2,000 of them here.
  it('works out muted text and a highlight that read, whatever the three', () => {
    const next = colours()
    let tried = 0
    while (tried < 2000) {
      const colors = { paper: next.next().value!, ink: next.next().value!, accent: next.next().value! }
      if (!readable(colors).ok) continue
      tried++
      const { vars } = palette(colors)
      const context = JSON.stringify(colors)
      expect(contrast(vars.muted, vars.paper), context).toBeGreaterThanOrEqual(OWN_MIN)
      expect(contrast(vars.muted, vars.shell), context).toBeGreaterThanOrEqual(OWN_MIN)
      expect(contrast(vars.ink, vars.highlight), context).toBeGreaterThanOrEqual(OWN_MIN)
      for (const name of OWN_VARS) expect(vars[name], `${name} of ${context}`).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  describe('with a library background or a highlight chosen', () => {
    const NIGHT = { paper: '#14161a', ink: '#e8e4da', accent: '#7fb4d6' }

    it('uses each as chosen, and works out whichever was left', () => {
      const three = palette(NIGHT).vars
      expect(palette({ ...NIGHT, shell: '#0b0c0e' }).vars).toMatchObject({ shell: '#0b0c0e', highlight: three.highlight })
      expect(palette({ ...NIGHT, highlight: '#3a2f55' }).vars).toMatchObject({ shell: three.shell, highlight: '#3a2f55' })
      // Left out, everything is as it was before either could be chosen.
      expect(palette({ ...NIGHT, shell: undefined, highlight: undefined })).toEqual(palette(NIGHT))
    })

    it('refuses one the text would not read on, and says what it comes to', () => {
      expect(readable({ ...NIGHT, shell: '#0b0c0e', highlight: '#3a2f55' })).toMatchObject({ ok: true })
      const pale = readable({ ...NIGHT, shell: '#d8d4ca' })
      expect(pale.ok).toBe(false)
      expect(pale.shell).toBeLessThan(OWN_MIN)
      expect(pale.highlight).toBeUndefined()
      const bright = readable({ ...NIGHT, highlight: '#f5e9a8' })
      expect(bright.ok).toBe(false)
      expect(bright.highlight).toBeLessThan(OWN_MIN)
      // Nothing chosen, nothing to say of either.
      expect(readable(NIGHT)).toMatchObject({ ok: true, shell: undefined, highlight: undefined })
    })

    // The muted text is drawn on the library too: 2,000 chosen backgrounds the text reads on.
    it('works out muted text that reads on the chosen library as on the page', () => {
      const next = colours(11)
      let tried = 0
      while (tried < 2000) {
        const colors = { paper: next.next().value!, ink: next.next().value!, accent: next.next().value!, shell: next.next().value!, highlight: next.next().value! }
        if (!readable(colors).ok) continue
        tried++
        const { vars } = palette(colors)
        const context = JSON.stringify(colors)
        expect(vars.shell, context).toBe(colors.shell)
        expect(vars.highlight, context).toBe(colors.highlight)
        expect(contrast(vars.muted, vars.paper), context).toBeGreaterThanOrEqual(OWN_MIN)
        expect(contrast(vars.muted, vars.shell), context).toBeGreaterThanOrEqual(OWN_MIN)
      }
    })
  })

  it('is dark when its page is', () => {
    expect(palette(DEFAULT_OWN).dark).toBe(false)
    expect(palette({ paper: '#14161a', ink: '#e8e4da', accent: '#7fb4d6' }).dark).toBe(true)
  })
})
