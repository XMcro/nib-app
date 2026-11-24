import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { fromFountain } from './fountain'
import { scriptPages, wrap, type ScriptPage } from './scriptPages'

const pages = (script: string) => scriptPages(fromFountain(script))
/** A page's lines as text, each with its column (characters from the left edge) and row (lines from the top margin). */
const laid = (page: ScriptPage) => page.map(({ x, y, runs }) => ({ column: Math.round(x / 7.2), row: Math.round((y - 72) / 12), text: runs.map((run) => run.text).join('') }))
const texts = (page: ScriptPage) => laid(page).map((line) => line.text)

describe('wrap', () => {
  it('breaks at the last space that fits, and through a word with none', () => {
    expect(wrap('aaa bbb ccc', 7)).toEqual([[0, 7], [8, 11]])
    expect(wrap('abcdefghij', 4)).toEqual([[0, 4], [4, 8], [8, 10]])
    expect(wrap('', 10)).toEqual([[0, 0]])
  })
})

describe('scriptPages: where each element goes', () => {
  const [page] = pages('ext. beach - day\n\nThe waves.\n\nMARA (v.o.)\n(quietly)\nThey came back.\n\nCUT TO:\n\n> THE END <')

  it('sets each from its own column, in capitals where it should be, on the next line', () => {
    expect(laid(page)).toEqual([
      { column: 15, row: 0, text: 'EXT. BEACH - DAY' },
      { column: 15, row: 2, text: 'The waves.' },
      { column: 37, row: 4, text: 'MARA (V.O.)' },
      { column: 31, row: 5, text: '(quietly)' },
      { column: 25, row: 6, text: 'They came back.' },
      { column: 75 - 'CUT TO:'.length, row: 8, text: 'CUT TO:' },
      { column: 45 - Math.floor('THE END'.length / 2), row: 10, text: 'THE END' },
    ])
  })

  it('wraps dialogue at 35 characters and action at 60', () => {
    const [one] = pages(`MARA\n${'word '.repeat(20).trim()}\n\n${'word '.repeat(20).trim()}`)
    const rows = laid(one)
    expect(rows.filter((row) => row.column === 25).every((row) => row.text.length <= 35)).toBe(true)
    expect(rows.filter((row) => row.column === 25)).toHaveLength(3)
    expect(rows.filter((row) => row.column === 15).map((row) => row.text.length)).toEqual([59, 39])
  })

  it('keeps bold, italic and underline, and leaves out what isn’t printed', () => {
    const body: JSONContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'The ' }, { type: 'text', text: 'waves', marks: [{ type: 'italic' }] }, { type: 'text', text: ' roar.' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: '[[a note]]' }] },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: '# ACT ONE' }] },
      ],
    }
    const [one] = scriptPages(body)
    expect(one).toEqual([{ x: 15 * 7.2, y: 72, runs: [{ text: 'The ' }, { text: 'waves', italic: true }, { text: ' roar.' }] }])
  })

  it('puts a scene’s number either side of its heading, on its line', () => {
    expect(laid(pages('INT. HOUSE - DAY #12A#')[0])).toEqual([
      { column: 15, row: 0, text: 'INT. HOUSE - DAY' },
      { column: 15 - 6, row: 0, text: '12A' },
      { column: 76, row: 0, text: '12A' },
    ])
  })
})

describe('scriptPages: pages', () => {
  const action = (count: number) => Array.from({ length: count }, (_, i) => `Line ${i + 1}.`).join('\n\n')

  it('has 55 lines a page, numbers the second on at the top right, and not the first', () => {
    // 28 lines of action with a gap between each is 55 lines; one more is a second page.
    expect(pages(action(28))).toHaveLength(1)
    const two = pages(action(29))
    expect(two).toHaveLength(2)
    expect(laid(two[1]).at(-1)).toEqual({ column: 73, row: -3, text: '2.' })
    expect(laid(two[0]).some((line) => line.row < 0)).toBe(false)
    // No gap left at the top of a page.
    expect(laid(two[1])[0]).toEqual({ column: 15, row: 0, text: 'Line 29.' })
  })

  it('starts a new page at ===, and leaves an empty one out', () => {
    expect(pages('One.\n\n===\n\nTwo.').map(texts)).toEqual([['One.'], ['Two.', '2.']])
    expect(pages('===\n\nOne.')).toHaveLength(1)
  })

  it('never leaves a scene heading last on a page, nor with room under it for only one line', () => {
    const [first, second] = pages(`${action(27)}\n\nINT. KITCHEN - NIGHT\n\nThe kettle.`)
    expect(texts(first)).not.toContain('INT. KITCHEN - NIGHT')
    expect(texts(second).slice(0, 2)).toEqual(['INT. KITCHEN - NIGHT', 'The kettle.'])
    // Three lines left: the heading, the gap and one line of two that can't be parted. Seen on the first PDF made.
    const [one, two] = pages(`${action(26)}\n\nINT. KITCHEN - NIGHT\n\n${'word '.repeat(20).trim()}`)
    expect(texts(one)).not.toContain('INT. KITCHEN - NIGHT')
    expect(texts(two)[0]).toBe('INT. KITCHEN - NIGHT')
  })

  it('carries a speech over with (MORE) and (CONT’D), never a character alone', () => {
    const speech = Array.from({ length: 10 }, (_, i) => `Line ${i + 1} of it.`).join('\n')
    // 25 lines of action and their gaps, and a gap, leave five: the name, three lines and (MORE).
    const [first, second] = pages(`${action(25)}\n\nMARA\n${speech}`)
    const end = laid(first).slice(-5)
    expect(end.map((line) => line.text)).toEqual(['MARA', 'Line 1 of it.', 'Line 2 of it.', 'Line 3 of it.', '(MORE)'])
    expect(end[4].column).toBe(37)
    expect(texts(second).slice(0, 2)).toEqual(["MARA (CONT'D)", 'Line 4 of it.'])
    // With room for only the name and a line, the whole speech goes over.
    const [one, two] = pages(`${action(26)}\n\nMARA\n${speech}`)
    expect(texts(one)).not.toContain('MARA')
    expect(texts(two)[0]).toBe('MARA')
  })

  it('carries long action over, two lines at least either side', () => {
    const long = 'word '.repeat(12 * 30).trim()
    const [first, second] = pages(`${action(26)}\n\n${long}`)
    expect(laid(first).filter((line) => line.text.startsWith('word')).length).toBeGreaterThanOrEqual(2)
    expect(laid(second)[0].text.startsWith('word')).toBe(true)
  })
})

describe('scriptPages: the title page', () => {
  it('comes first, unnumbered, the title and authors in the middle, contact bottom left and the date bottom right', () => {
    const [title, first] = pages('Title: The Lighthouse Keeper\nCredit: Written by\nAuthor: Ana Lee\nDraft date: 22 November 2026\nContact:\n    ana@example.com\n\nEXT. LIGHTHOUSE - NIGHT')
    expect(laid(title)).toEqual([
      { column: 45 - 10, row: 18, text: 'The Lighthouse Keeper' },
      { column: 45 - 5, row: 22, text: 'Written by' },
      { column: 45 - 3, row: 24, text: 'Ana Lee' },
      { column: 15, row: 54, text: 'ana@example.com' },
      { column: 75 - 16, row: 54, text: '22 November 2026' },
    ])
    expect(texts(first)).toEqual(['EXT. LIGHTHOUSE - NIGHT'])
  })

  it('isn’t there without title lines', () => {
    expect(pages('INT. HOUSE - DAY')).toHaveLength(1)
  })
})
