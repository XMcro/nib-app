import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FORMATS, formatsFor } from './formats'

describe('formats', () => {
  it('gives pages every style and notes all but the headings and tables', () => {
    const pagesOnly = ['format-title', 'format-heading', 'format-subheading', 'format-heading-four', 'format-heading-five', 'format-heading-six']
    expect(formatsFor(true).map((format) => format.id)).toEqual(FORMATS.map((format) => format.id))
    expect(formatsFor(false).map((format) => format.id)).toEqual(
      FORMATS.map((format) => format.id).filter((id) => !pagesOnly.includes(id) && !id.startsWith('table-')),
    )
  })

  it('has no two with the same id', () => {
    expect(new Set(FORMATS.map((format) => format.id)).size).toBe(FORMATS.length)
  })

  // The Mac's Format menu sends these ids to the page (src/App.tsx `menu`). An
  // id in one list and not the other is a menu item that silently does nothing.
  it('matches the Mac Format menu id for id', () => {
    const swift = readFileSync(new URL('../../ios/App/App/AppDelegate.swift', import.meta.url), 'utf8')
    const menu = [...swift.matchAll(/"((?:format|table)-[a-z-]+)"/g)].map((match) => match[1])
    expect(menu.sort()).toEqual(FORMATS.map((format) => format.id).sort())
  })
})
