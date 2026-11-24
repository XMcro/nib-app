// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import type { Item } from '../db/db'
import { partPage } from './manuscript'
import { MARGINS, printOptions, type PrintBook } from './printBook'

const text = (value: string): JSONContent => ({ type: 'text', text: value })
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
const note = (value: string): JSONContent => ({ type: 'footnote', attrs: { text: value } })
const page = (id: string, ...content: JSONContent[]): Item => ({ id, kind: 'page', version: 1, createdAt: 1, updatedAt: 1, body: { type: 'doc', content } })
const heading = (value: string): JSONContent => ({ type: 'heading', attrs: { level: 1 }, content: [text(value)] })

const book = (more: Partial<PrintBook> = {}): PrintBook => ({
  title: 'The Lighthouse',
  author: 'Mara Wells',
  chapters: [page('one', heading('The keeper’s daughter'), p(text('Mara climbed the steps.'))), page('two', heading('The logbook'), p(text('It stopped.')))],
  trim: '6x9',
  dropCaps: false,
  year: 2026,
  lang: 'en-GB',
  ...more,
})

const parsed = (markup: string) => new DOMParser().parseFromString(markup, 'text/html').body

describe('a book’s inside for print on demand', () => {
  it('is the trim’s size, with the wider margin at the spine', () => {
    expect(printOptions(book(), '')).toMatchObject({ width: 432, height: 648, ...MARGINS })
    expect(printOptions(book({ trim: '5x8' }), '')).toMatchObject({ width: 360, height: 576 })
    expect(printOptions(book({ trim: '5.5x8.5' }), '')).toMatchObject({ width: 396, height: 612 })
    expect(MARGINS.inside).toBeGreaterThan(MARGINS.outside)
  })

  it('sets a smaller trim’s text smaller', () => {
    expect(printOptions(book({ trim: '5x8' }), '').style).toContain('font: 13.125px/1.4 Literata')
    expect(printOptions(book(), '').style).toContain('font: 14.375px/1.4 Literata')
  })

  it('opens with the title page on the right and the copyright on its back, then each chapter on the right', () => {
    const { sections } = printOptions(book(), '')
    expect(sections.map(({ side, front }) => [side, front ?? false])).toEqual([
      ['right', true],
      ['left', true],
      ['right', false],
      ['right', false],
    ])
    expect(parsed(sections[0].markup).textContent).toBe('The LighthouseMara Wells')
    expect(parsed(sections[1].markup).textContent).toBe('Copyright © 2026 Mara Wells. All rights reserved.')
    expect(parsed(sections[2].markup).querySelector('h1')?.textContent).toBe('The keeper’s daughter')
    expect(parsed(sections[3].markup).querySelector('main')?.getAttribute('lang')).toBe('en-GB')
  })

  it('heads the left-hand pages with the author and the right with the title, or the title on both with no author', () => {
    expect(printOptions(book(), '')).toMatchObject({ left: 'Mara Wells', right: 'The Lighthouse' })
    const none = printOptions(book({ author: ' ' }), '')
    expect(none).toMatchObject({ left: 'The Lighthouse', right: 'The Lighthouse' })
    expect(parsed(none.sections[0].markup).querySelector('.by')).toBeNull()
    // The title page's back is blank.
    expect(parsed(none.sections[1].markup).textContent).toBe('')
  })

  it('writes what it’s given as text', () => {
    const { sections } = printOptions(book({ title: 'Salt <b>& weed</b>', author: '<i>M</i>' }), '')
    const title = parsed(sections[0].markup)
    expect(title.querySelector('b, i')).toBeNull()
    expect(title.textContent).toBe('Salt <b>& weed</b><i>M</i>')
  })

  it('numbers the notes through the book, each chapter’s after it, with no link back', () => {
    const chapters = [page('one', p(text('One'), note('First.'), text(' two'), note('Second.'))), page('two', p(text('Three'), note('Third.')))]
    const [, , one, two] = printOptions(book({ chapters }), '').sections.map(({ markup }) => parsed(markup))
    expect([...one.querySelectorAll('.notes li')].map((li) => li.textContent?.trim())).toEqual(['First.', 'Second.'])
    expect(two.querySelector('.notes')?.getAttribute('start')).toBe('3')
    expect(two.querySelector('sup a')?.textContent).toBe('3')
    expect(two.querySelector('.notes a')).toBeNull()
    // The rule before them stays a rule.
    expect(two.querySelector('hr')).not.toBeNull()
  })

  it('puts three stars between scenes, whatever marks the writer typed', () => {
    const chapters = [page('one', p(text('Before.')), p(text('* * *')), p(text('After.')), p(text('#')), p(text('Last, #1.')))]
    const chapter = parsed(printOptions(book({ chapters }), '').sections[2].markup)
    const stars = '* * *'
    expect([...chapter.querySelectorAll('p')].map((one) => [one.className, one.textContent])).toEqual([
      ['', 'Before.'],
      ['break', stars],
      ['', 'After.'],
      ['break', stars],
      ['', 'Last, #1.'],
    ])
  })

  it('opens a part like a chapter, on a page of its own', () => {
    const { sections } = printOptions(book({ chapters: [partPage('Part Two'), page('one', p(text('Words.')))] }), '')
    expect(parsed(sections[2].markup).querySelector('main')?.className).toBe('part')
    expect(parsed(sections[3].markup).querySelector('main')?.className).toBe('chapter')
  })

  it('drops a chapter’s first letter only when asked, and carries the letters and the heads’ font it’s given', () => {
    expect(printOptions(book(), '').style).not.toContain('initial-letter')
    expect(printOptions(book({ dropCaps: true }), '').style).toContain('initial-letter: 3')
    const given = printOptions(book(), '@font-face { font-family: Literata; }', 'AAAA')
    expect(given.style).toContain('@font-face { font-family: Literata; }')
    expect(given.font).toBe('AAAA')
    expect(printOptions(book(), '')).not.toHaveProperty('font')
  })
})
