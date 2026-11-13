// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { docOf, matchesIn, queryOf, replacedIn, replacingOf } from './bookFind'

const para = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] })
const chapter = (...lines: string[]) => docOf({ type: 'doc', content: lines.map(para) })
const find = (doc: ReturnType<typeof docOf>, words: string, switches: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean } = {}) =>
  matchesIn(doc, queryOf({ words, caseSensitive: false, wholeWord: false, regex: false, ...switches }))

describe('finding in a chapter of a book', () => {
  const names = chapter('Ann met Anne.', 'ann said annual things.', 'Ann left.')

  it('finds as the find bar does: capitals and parts of words, unless asked', () => {
    expect(find(names, 'Ann')).toHaveLength(5)
    expect(find(names, 'Ann', { caseSensitive: true })).toHaveLength(3)
    expect(find(names, 'Ann', { wholeWord: true })).toHaveLength(3)
    expect(find(names, 'Ann', { caseSensitive: true, wholeWord: true }).map((match) => match.after)).toEqual([' met Anne.', ' left.'])
    expect(find(names, 'a[n]+ual', { regex: true }).map((match) => match.text)).toEqual(['annual'])
    expect(find(names, 'a[n]+ual')).toEqual([])
  })

  it('gives each with the words either side of it in its paragraph, a long way cut at a word', () => {
    expect(find(names, 'said')).toEqual([{ before: 'ann ', text: 'said', after: ' annual things.' }])
    const long = chapter('The boats came in late that year, low in the water and quiet, and Mara counted them from the harbour wall the way her mother had taught her.')
    const [match] = find(long, 'Mara')
    expect(match.before).toBe('…year, low in the water and quiet, and ')
    expect(match.after).toBe(' counted them from the harbour wall the…')
  })

  it('finds in what a chapter holds besides paragraphs, in its order', () => {
    const doc = docOf({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Mara' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [para('Mara again')] }] }, para('and Mara')] })
    expect(find(doc, 'mara').map((match) => match.before + match.text + match.after)).toEqual(['Mara', 'Mara again', 'and Mara'])
  })
})

describe('replacing in a chapter of a book', () => {
  const query = (words: string, replace: string, switches: { caseSensitive?: boolean; wholeWord?: boolean; regex?: boolean } = {}) =>
    replacingOf({ words, caseSensitive: false, wholeWord: false, regex: false, ...switches }, replace)
  const text = (body: JSONContent) => docOf(body).textBetween(0, docOf(body).content.size, '\n')

  it('replaces what the switches match, and says how many', () => {
    const body: JSONContent = { type: 'doc', content: [para('Ann met Anne.'), para('ann said annual things.'), para('Ann left.')] }
    const done = replacedIn(body, query('Ann', 'Anna', { caseSensitive: true, wholeWord: true }))!
    expect(done.count).toBe(2)
    expect(text(done.body)).toBe('Anna met Anne.\nann said annual things.\nAnna left.')
    expect(replacedIn(body, query('Zoe', 'Zara'))).toBeNull()
  })

  it('keeps the style on what it replaces, and reads $1 only in a pattern', () => {
    const body: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Mara', marks: [{ type: 'italic' }] }, { type: 'text', text: ' left.' }] }] }
    const styled = replacedIn(body, query('Mara', 'Maren'))!.body
    expect(styled.content![0].content![0]).toEqual({ type: 'text', text: 'Maren', marks: [{ type: 'italic' }] })
    expect(text(replacedIn(body, query('(M)ara', '$1aren', { regex: true }))!.body)).toBe('Maren left.')
    expect(text(replacedIn(body, query('Mara', '$1'))!.body)).toBe('$1 left.')
  })
})
