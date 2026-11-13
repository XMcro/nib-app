// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Item } from '../db/db'
import { aboutWords, asPosition, bookOf, bookTitle, chaptersOf, moveChapter, partPage, partsOf, rememberedAuthor, runningHead, titlePage, withSceneBreaks } from './manuscript'

let made = 0
function page(fields: Partial<Item> & { id: string }): Item {
  made += 1
  return {
    kind: 'page',
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: fields.id }] }] },
    version: 1,
    createdAt: made,
    updatedAt: made,
    folder: 'Novel',
    ...fields,
  }
}

const ids = (list: Item[]) => list.map((item) => item.id)

describe('asPosition', () => {
  it('takes a number or null, and says nothing about anything else', () => {
    expect(asPosition(2.5)).toBe(2.5)
    expect(asPosition(-1)).toBe(-1)
    expect(asPosition(null)).toBeNull()
    for (const odd of ['3', NaN, Infinity, {}, undefined]) expect(asPosition(odd)).toBeUndefined()
  })
})

describe('chaptersOf', () => {
  it('is the folder’s pages, in their places, then the ones without a place, oldest first', () => {
    const documents = [
      page({ id: 'unplaced-old' }),
      page({ id: 'second', position: 2 }),
      page({ id: 'note', kind: 'note', position: 0 }),
      page({ id: 'first', position: 1 }),
      page({ id: 'elsewhere', folder: 'Poems', position: 0 }),
      page({ id: 'unfiled', folder: undefined }),
      page({ id: 'trashed', position: 0, deletedAt: 5 }),
      page({ id: 'unplaced-new', position: null }),
    ]
    expect(ids(chaptersOf(documents, 'novel'))).toEqual(['first', 'second', 'unplaced-old', 'unplaced-new'])
  })
})

describe('moveChapter', () => {
  const placed = () => [page({ id: 'a', position: 1 }), page({ id: 'b', position: 2 }), page({ id: 'c', position: 3 })]

  it('moves one chapter by giving it a place between its new neighbours, and nothing else', () => {
    expect(moveChapter(placed(), 0, 1)).toEqual([{ id: 'a', position: 2.5 }])
    expect(moveChapter(placed(), 2, 0)).toEqual([{ id: 'c', position: 0 }])
    expect(moveChapter(placed(), 0, 2)).toEqual([{ id: 'a', position: 4 }])
  })

  it('does nothing when the chapter stays where it is', () => {
    expect(moveChapter(placed(), 1, 1)).toEqual([])
  })

  it('gives every chapter a place, in the new order, while some have none', () => {
    const chapters = [page({ id: 'a', position: 1 }), page({ id: 'b' }), page({ id: 'c' })]
    expect(moveChapter(chapters, 2, 0)).toEqual([
      { id: 'c', position: 1 },
      { id: 'a', position: 2 },
      { id: 'b', position: 3 },
    ])
  })

  it('numbers them all again once there is no room left between two', () => {
    const chapters = [page({ id: 'a', position: 1 }), page({ id: 'b', position: 1 + Number.EPSILON }), page({ id: 'c', position: 3 })]
    expect(moveChapter(chapters, 2, 1)).toEqual([
      { id: 'a', position: 1 },
      { id: 'c', position: 2 },
      { id: 'b', position: 3 },
    ])
  })
})

describe('a book’s parts', () => {
  const book = (documents: Item[], folder = 'Novel') => partsOf(documents, folder).map((part) => [part.name, ids(part.chapters)])

  it('are the folder’s own pages, then each folder inside it under its name, numbers as numbers', () => {
    const documents = [
      page({ id: 'ten', folder: 'Novel/Part 10' }),
      page({ id: 'two-b', folder: 'Novel/Part 2', position: 2 }),
      page({ id: 'two-a', folder: 'novel/part 2', position: 1 }),
      page({ id: 'prologue' }),
      page({ id: 'one', folder: 'Novel/Part 1' }),
      page({ id: 'elsewhere', folder: 'Poems/Part 1' }),
    ]
    expect(book(documents)).toEqual([
      [null, ['prologue']],
      ['Part 1', ['one']],
      ['Part 2', ['two-a', 'two-b']],
      ['Part 10', ['ten']],
    ])
  })

  it('leave out a part with no pages: its notes, its trash, and the folder’s own when it has none', () => {
    const documents = [
      page({ id: 'note', folder: 'Novel/Research', kind: 'note' }),
      page({ id: 'gone', folder: 'Novel/Cut', deletedAt: 5 }),
      page({ id: 'one', folder: 'Novel/Part 1' }),
    ]
    expect(book(documents)).toEqual([['Part 1', ['one']]])
    expect(book([])).toEqual([])
  })

  it('are one, with no name, for a folder that is inside another: its own pages are its book', () => {
    const documents = [page({ id: 'prologue' }), page({ id: 'one', folder: 'Novel/Part 1' })]
    expect(book(documents, 'Novel/Part 1')).toEqual([[null, ['one']]])
    expect(partsOf(documents, 'Novel/Part 1')[0].folder).toBe('Novel/Part 1')
  })

  it('give the book its folder’s name, and a part its own page to open on', () => {
    expect(bookTitle('Novel')).toBe('Novel')
    expect(bookTitle('Novel/Part 1')).toBe('Novel: Part 1')
    const opening = partPage('Part 1')
    expect(opening.kind).toBe('page')
    expect(opening.body).toEqual({ type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Part 1' }] }] })
  })
})

describe('a book’s title page', () => {
  it('has its title, and who it’s by when that’s said, in the middle', () => {
    expect(titlePage('The Long Season', 'Ann Writer').body.content).toEqual([
      { type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [{ type: 'text', text: 'The Long Season' }] },
      { type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: 'by Ann Writer' }] },
    ])
    expect(titlePage('Untitled').body.content).toHaveLength(1)
  })

  it('is by the name last given a book, till it’s given its own; its title is the folder’s till then', () => {
    const settings = { novel: { at: 3, author: 'Ann' }, poems: { at: 5, author: 'A. N. Other' }, old: { at: 9, gone: true as const } }
    expect(rememberedAuthor(settings)).toBe('A. N. Other')
    expect(bookOf('Novel', settings)).toEqual({ title: 'Novel', author: 'Ann' })
    expect(bookOf('Novel/Part 1', settings)).toEqual({ title: 'Novel: Part 1', author: 'A. N. Other' })
    expect(bookOf('Letters', {})).toEqual({ title: 'Letters', author: undefined })
  })
})

describe('standard manuscript format', () => {
  it('gives the length to the hundred, or from ten thousand words to the thousand, and a short one as it is', () => {
    expect(aboutWords(1)).toBe('1 word')
    expect(aboutWords(15)).toBe('15 words')
    expect(aboutWords(149)).toBe('about 100 words')
    expect(aboutWords(4_351)).toBe('about 4,400 words')
    expect(aboutWords(9_949)).toBe('about 9,900 words')
    expect(aboutWords(84_612)).toBe('about 85,000 words')
  })

  it('heads each page with the surname and the title in capitals, or the title alone with no name', () => {
    expect(runningHead({ title: 'The Long Season', author: '  Ann  Q. Writer ', words: 0 })).toBe('Writer / THE LONG SEASON / ')
    expect(runningHead({ title: 'The Long Season', words: 0 })).toBe('THE LONG SEASON / ')
  })

  it('puts a # in the middle for a break between scenes, and leaves every other line', () => {
    const line = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
    const body = { type: 'doc', content: [line('She left.'), line('* * *'), line('***'), line('#'), line('⁂'), line(' ~~~ '), line('*Not* a break'), { type: 'paragraph' }, { type: 'heading', content: [{ type: 'text', text: '***' }] }] }
    const broken = { type: 'paragraph', attrs: { textAlign: 'center' }, content: [{ type: 'text', text: '#' }] }
    expect(withSceneBreaks(body).content).toEqual([line('She left.'), broken, broken, broken, broken, broken, line('*Not* a break'), { type: 'paragraph' }, body.content[8]])
  })
})
