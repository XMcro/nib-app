import { afterEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import type { Item } from '../db/db'
import { choices, matches } from '../editor/linkPicker'
import { snapshot } from '../share'
import { asBlock, linkable, linked, linksIn, linksTo, linkWikiLinks, newBlock, partsIn, setLinkable, shownLink, wikiTarget } from './links'
import { toMarkdown } from './markdown'
import { previewOf, searchText, titleOf } from './text'

const text = (value: string): JSONContent => ({ type: 'text', text: value })
const link = (id: string, title: string): JSONContent => ({ type: 'noteLink', attrs: { id, title } })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content }] })
const item = (id: string, body: JSONContent, updatedAt = 1, kind: Item['kind'] = 'note'): Item => ({ id, kind, body, version: 1, createdAt: 1, updatedAt })

afterEach(() => setLinkable([]))

describe('links between notes', () => {
  // Locking empties the note's body, but a link keeps the title it had when
  // it was made, and showed it, on screen and in every export.
  it('show nothing of a note locked into the vault, on screen or exported', () => {
    const locked: Item = { ...item('ferry', doc(text(''))), vault: { salt: 'A'.repeat(22), sealed: 'B'.repeat(40) } }
    setLinkable([locked, item('trip', doc(link('ferry', 'Ferry at 07:40')))])
    expect(toMarkdown(doc(link('ferry', 'Ferry at 07:40')))).toBe('[[A locked note]]')
    expect(JSON.stringify(snapshot({ kind: 'note', body: doc(link('ferry', 'Ferry at 07:40')) }))).not.toContain('Ferry')
    // And `[[` doesn't offer it, as before.
    expect(linked('ferry')?.title).toBe('')
  })

  // Security finding 6 of the 8 November audit.
  describe('to a note in the vault', () => {
    const SEALED = { vault: { salt: 'A'.repeat(22), sealed: 'B'.repeat(40) } }
    const locked = (id: string): Item => ({ ...item(id, doc(text(''))), ...SEALED })

    it('read as locked in the card, the search and the file name', () => {
      const body: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [text('see '), link('ferry', 'Ferry at 07:40')] }, { type: 'paragraph', content: [link('ferry', 'Ferry at 07:40')] }] }
      setLinkable([locked('ferry'), item('trip', body)])
      expect(titleOf(body)).toBe('see A locked note')
      expect(previewOf(body)).toBe('A locked note')
      expect(searchText(body)).not.toContain('Ferry')
    })

    it('read again once it’s locked, or its lock comes off, whatever had been read before', () => {
      const body = doc(link('ferry', 'Ferry at 07:40'))
      const open = item('ferry', doc(text('Ferry at 07:40')))
      setLinkable([open, item('trip', body)])
      expect(titleOf(body)).toBe('Ferry at 07:40')
      setLinkable([locked('ferry'), item('trip', body)])
      expect(titleOf(body)).toBe('A locked note')
      setLinkable([open, item('trip', body)])
      expect(titleOf(body)).toBe('Ferry at 07:40')
    })

    it('give nothing away from the trash either, and the trash stays out of the list to link to', () => {
      setLinkable([item('trip', doc(link('ferry', 'Ferry at 07:40')))], [locked('ferry')])
      expect(toMarkdown(doc(link('ferry', 'Ferry at 07:40')))).toBe('[[A locked note]]')
      expect(JSON.stringify(snapshot({ kind: 'note', body: doc(link('ferry', 'Ferry at 07:40')) }))).not.toContain('Ferry')
      expect(linked('ferry')).toBeUndefined()
      expect(linkable().map(({ id }) => id)).toEqual(['trip'])
    })

    it('keep a note out of the title of what links to it, the first time a list is read', () => {
      setLinkable([item('trip', doc(link('ferry', 'Ferry at 07:40'))), locked('ferry')])
      expect(linked('trip')?.title).toBe('A locked note')
    })

    it('leave an unlocked note in the trash reading as it did', () => {
      setLinkable([], [item('ferry', doc(text('Ferry at 07:40')))])
      expect(titleOf(doc(link('ferry', 'Ferry')))).toBe('Ferry')
    })
  })

  it('finds what a document links to, however deep', () => {
    const body: JSONContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [text('see '), link('a', 'Ferry')] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [link('b', 'Tickets')] }] }] },
      ],
    }
    expect([...linksIn(body)]).toEqual(['a', 'b'])
  })

  it('works out a document’s links once', () => {
    const body = doc(link('a', 'A'))
    expect(linksIn(body)).toBe(linksIn(body))
  })

  it('lists what links to a note, most recently edited first, never the note itself', () => {
    const all = [
      item('ferry', doc(text('Ferry'), link('ferry', 'Ferry'))),
      item('old', doc(text('Old trip '), link('ferry', 'Ferry')), 5),
      item('new', doc(text('New trip '), link('ferry', 'Ferry')), 9),
      item('other', doc(text('Unrelated'))),
    ]
    expect(linksTo('ferry', all).map((one) => one.id)).toEqual(['new', 'old'])
  })

  it('names a link by its note’s title now, falling back to the one it had', () => {
    setLinkable([item('ferry', doc(text('Ferry at 07:40')))])
    expect(linked('ferry')?.title).toBe('Ferry at 07:40')
    expect(toMarkdown(doc(text('See '), link('ferry', 'Ferry')))).toBe('See [[Ferry at 07:40]]')
    expect(toMarkdown(doc(link('gone', 'Old [draft]')))).toBe('[[Old \\[draft\\]]]')
  })

  it('reads as its title in a document’s own title and text', () => {
    expect(titleOf(doc(link('ferry', 'Ferry'), text(' plan')))).toBe('Ferry plan')
  })

  it('becomes plain text in a shared draft, with no id for the reader', () => {
    setLinkable([item('ferry', doc(text('Ferry')))])
    const shared = snapshot({ kind: 'note', body: doc(text('See '), link('ferry', 'Old name')) })
    expect(JSON.stringify(shared)).not.toContain('noteLink')
    expect(JSON.stringify(shared)).not.toContain('"ferry"')
    expect(shared.body.content?.[0].content).toEqual([text('See '), text('Ferry')])
  })
})

describe('what [[ offers', () => {
  it('starts with the most recently edited, and never the document being written', () => {
    setLinkable([item('a', doc(text('Apples')), 1), item('b', doc(text('Bananas')), 3), item('c', doc(text('Cherries')), 2)])
    expect(linkable().map((one) => one.id)).toEqual(['b', 'c', 'a'])
    expect(matches('', 'b').map((one) => one.title)).toEqual(['Cherries', 'Apples'])
  })

  it('puts titles that start with what was typed before those that only contain it', () => {
    setLinkable([item('a', doc(text('Ferry times')), 1), item('b', doc(text('The ferry')), 2), item('c', doc(text('Tickets')), 3)])
    expect(matches('fer', null).map((one) => one.title)).toEqual(['Ferry times', 'The ferry'])
    expect(matches('zzz', null)).toEqual([])
  })

  it('leaves out untitled documents, which could not be told apart', () => {
    setLinkable([item('a', { type: 'doc', content: [{ type: 'paragraph' }] }), item('b', doc(text('Named')))])
    expect(matches('', null).map((one) => one.id)).toEqual(['b'])
  })
})

describe('a link to one line of a note', () => {
  const para = (words: string, blockId?: unknown): JSONContent => ({ type: 'paragraph', ...(blockId !== undefined && { attrs: { blockId } }), content: [text(words)] })
  const heading = (words: string, blockId?: string): JSONContent => ({ type: 'heading', attrs: { level: 2, ...(blockId && { blockId }) }, content: [text(words)] })
  const tides: JSONContent = {
    type: 'doc',
    content: [
      heading('Tides'),
      para('High water is at six.', 'abcd1234'),
      { type: 'paragraph' },
      { type: 'bulletList', content: [{ type: 'listItem', content: [para('Bring  the\nrope'), { type: 'bulletList', content: [{ type: 'listItem', content: [para('And a lamp', 'not a marker!')] }] }] }] },
      heading('Harbour', 'h4rb0ur1'),
    ],
  }

  it('can go to any heading or paragraph with words, wherever it is, in the order they’re read', () => {
    expect(partsIn(tides)).toEqual([
      { index: 0, text: 'Tides', heading: true, block: null },
      { index: 1, text: 'High water is at six.', heading: false, block: 'abcd1234' },
      { index: 2, text: 'Bring the rope', heading: false, block: null },
      // A marker that isn't one of Nib's is none.
      { index: 3, text: 'And a lamp', heading: false, block: null },
      { index: 4, text: 'Harbour', heading: true, block: 'h4rb0ur1' },
    ])
    expect(partsIn(tides)).toBe(partsIn(tides))
  })

  it('makes markers that are markers, and takes no other for one', () => {
    for (let i = 0; i < 200; i++) expect(asBlock(newBlock())).not.toBeNull()
    for (const not of ['', 'abc', 'ABCD1234', 'abcd-1234', 'a'.repeat(17), 'x" onclick="y', 7, null, undefined]) expect(asBlock(not)).toBeNull()
  })

  it('shows its note’s title and the line’s words as they are now, shortened; else as they were when linked', () => {
    setLinkable([item('tides', tides)])
    expect(shownLink({ id: 'tides', title: 'Old title', block: 'abcd1234', part: 'High water was at five.' })).toBe('Tides › High water is at six.')
    // Its marker not written yet, or its line since deleted.
    expect(shownLink({ id: 'tides', title: 'Tides', block: 'zzzz9999', part: 'A line that went' })).toBe('Tides › A line that went')
    expect(shownLink({ id: 'tides', title: 'Tides', block: 'zzzz9999' })).toBe('Tides')
    expect(shownLink({ id: 'tides', title: 'Tides' })).toBe('Tides')
    setLinkable([item('long', { type: 'doc', content: [para('Title'), para('The last boat of the day leaves the harbour at a quarter to nine.', 'l0ngl1ne')] })])
    expect(shownLink({ id: 'long', title: 'Title', block: 'l0ngl1ne' })).toBe('Title › The last boat of the day leaves the harb…')
  })

  it('shows nothing of a line in a note locked into the vault', () => {
    const locked: Item = { ...item('tides', doc(text(''))), vault: { salt: 'A'.repeat(22), sealed: 'B'.repeat(40) } }
    setLinkable([locked])
    expect(shownLink({ id: 'tides', title: 'Tides', block: 'abcd1234', part: 'High water is at six.' })).toBe('A locked note')
  })

  describe('in what [[ offers', () => {
    const titled = (id: string, title: string, ...rest: JSONContent[]) => item(id, { type: 'doc', content: [para(title), ...rest] })

    it('lists a document’s lines after its name and a #, narrowed by the words typed next', () => {
      setLinkable([item('tides', tides), titled('other', 'Other')])
      expect(choices('tid#', null).map((choice) => [choice.of.id, choice.part?.text])).toEqual([
        ['tides', 'Tides'],
        ['tides', 'High water is at six.'],
        ['tides', 'Bring the rope'],
        ['tides', 'And a lamp'],
        ['tides', 'Harbour'],
      ])
      expect(choices('tid# WATER', null).map((choice) => choice.part?.text)).toEqual(['High water is at six.'])
      expect(choices('tid#nothing like it', null)).toEqual([])
      // No name before it, or none that is a document's: nothing, not the lines of whatever was edited last.
      expect(choices('#water', null)).toEqual([])
      expect(choices('zzz#water', null)).toEqual([])
      // And still never the document being written.
      expect(choices('tid#', 'tides')).toEqual([])
    })

    it('still finds a note with a # in its name by its name', () => {
      setLinkable([titled('c', 'C'), titled('sharp', 'C# notes', para('Generics'))])
      expect(choices('c#', null).map((choice) => [choice.of.id, choice.part?.text])).toEqual([['sharp', undefined]])
      expect(choices('c# notes#gen', null).map((choice) => [choice.of.id, choice.part?.text])).toEqual([['sharp', 'Generics']])
      // And a line's own # is part of the words looked for.
      setLinkable([titled('list', 'List', para('Item #2 is late'))])
      expect(choices('list#item #2', null).map((choice) => choice.part?.text)).toEqual(['Item #2 is late'])
    })

    it('offers of a read-only note only the lines something links to already', () => {
      setLinkable([{ ...item('tides', tides), readOnly: true }])
      expect(choices('tides#', null).map((choice) => choice.part?.text)).toEqual(['High water is at six.', 'Harbour'])
    })
  })
})

describe('a link to one line, outside Nib', () => {
  const line = (words: string, blockId: string): JSONContent => ({ type: 'paragraph', attrs: { blockId }, content: [text(words)] })
  const trips: JSONContent = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [text('Trips')] }, { type: 'heading', attrs: { level: 2, blockId: 'head1234' }, content: [text('The last: [boat]')] }, line('Bring a coat.', 'line1234')],
  }
  const to = (block: string): JSONContent => ({ type: 'noteLink', attrs: { id: 'trips', title: 'Trips', block, part: 'As it was linked' } })

  it('is Title#Heading in Markdown for a heading, without what would end the link', () => {
    setLinkable([item('trips', trips)])
    expect(wikiTarget(to('head1234'))).toBe('Trips#The last boat')
    expect(toMarkdown(doc(to('head1234')))).toBe('[[Trips#The last boat]]')
  })

  it('is its note alone in Markdown for a paragraph, and adds nothing to the paragraph', () => {
    setLinkable([item('trips', trips)])
    expect(toMarkdown(doc(to('line1234')))).toBe('[[Trips]]')
    expect(toMarkdown(trips)).toContain('Bring a coat.')
    expect(toMarkdown(trips)).not.toMatch(/\^|line1234|head1234/)
  })

  it('is its note alone for a line that is gone, and says nothing of a note in the vault', () => {
    setLinkable([item('trips', trips)])
    expect(toMarkdown(doc(to('gone1234')))).toBe('[[Trips]]')
    setLinkable([{ ...item('trips', trips), vault: { salt: 'A'.repeat(22), sealed: 'B'.repeat(40) } }])
    expect(toMarkdown(doc(to('head1234')))).toBe('[[A locked note]]')
  })

  it('reaches a shared draft as its note’s title, with no marker on any line', () => {
    setLinkable([item('trips', trips)])
    const sent = JSON.stringify(snapshot({ kind: 'note', body: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'mine1234' }, content: [text('See '), to('line1234')] }] } }))
    expect(sent).toContain('Trips')
    for (const kept of ['Bring a coat', 'As it was linked', 'line1234', 'mine1234', 'blockId']) expect(sent).not.toContain(kept)
  })
})

describe('[[Title#…]] in imported text', () => {
  const para = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
  const heading = (words: string): JSONContent => ({ type: 'heading', attrs: { level: 2 }, content: [text(words)] })
  const of = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
  const find = (title: string) => ({ log: 'log', trips: 'trips', older: 'already-here' })[title.toLowerCase()]
  const linksOf = (body: JSONContent) => body.content![0].content!.filter((node) => node.type === 'noteLink')
  const imported = (from: string, ...lines: JSONContent[]) => linkWikiLinks([{ id: 'log', body: of(para(text(from))) }, { id: 'trips', body: of(...lines) }], find)

  it('goes to a heading in the same import, by its words in any case and without what a link can’t say', () => {
    const [log, trips] = imported('[[Trips#the LAST: boat]]', para(text('Before')), heading('The last: boat'))
    const block = trips.content![1].attrs!.blockId as string
    expect(asBlock(block)).toBe(block)
    expect(linksOf(log)).toEqual([{ type: 'noteLink', attrs: { id: 'trips', title: 'Trips', block, part: 'The last: boat' } }])
  })

  it('takes the last of Obsidian’s #One#Two, keeps to an alias, and gives one line one marker however many links go to it', () => {
    const [log, trips] = imported('[[Trips#Day one#Buses|the bus]] and [[Trips#Buses]]', heading('Day one'), heading('Buses'))
    const [first, second] = linksOf(log)
    expect(first.attrs!.block).toBe(trips.content![1].attrs!.blockId)
    expect(second.attrs!.block).toBe(first.attrs!.block)
    expect(trips.content![0].attrs!.blockId).toBeUndefined()
  })

  it('goes to a line by Obsidian’s ^id, and takes the id off its words', () => {
    const [log, trips] = imported('[[Trips#^last-Train]]', para(text('The last train. ^last-Train')))
    expect(trips.content![0].content).toEqual([text('The last train.')])
    expect(linksOf(log)[0].attrs).toMatchObject({ block: trips.content![0].attrs!.blockId, part: 'The last train.' })
  })

  it('leaves no empty text behind an id that had a run of its own', () => {
    const [, trips] = imported('[[Trips#^abc123]]', para({ ...text('Bold'), marks: [{ type: 'bold' }] }, text(' ^abc123')))
    expect(trips.content![0].content).toEqual([{ ...text('Bold'), marks: [{ type: 'bold' }] }])
  })

  it('takes an id no link goes to off a vault’s lines, and leaves it in any other file, where it may be words', () => {
    const body = of(para(text('Two ^squared')))
    expect(linkWikiLinks([{ id: 'a', body, vault: true }], find)[0].content![0].content).toEqual([text('Two')])
    expect(linkWikiLinks([{ id: 'a', body }], find)[0]).toEqual(body)
  })

  it('leaves code as it was written, in a vault too', () => {
    const body = of(para({ ...text('x ^abc123'), marks: [{ type: 'code' }] }))
    expect(linkWikiLinks([{ id: 'a', body, vault: true }], find)[0]).toEqual(body)
  })

  it('links to all of a note when the line isn’t there, and to all of one already here, which an import doesn’t write to', () => {
    const [log] = imported('[[Trips#Nowhere]] [[Older#Buses]]', heading('Buses'))
    expect(linksOf(log)).toEqual([link('trips', 'Trips'), link('already-here', 'Older')])
  })

  it('doesn’t change what it was given', () => {
    const body = of(para(text('[[Trips#^abc123]] ^abc123')))
    const before = structuredClone(body)
    linkWikiLinks([{ id: 'trips', body, vault: true }], find)
    expect(body).toEqual(before)
  })
})

const inOne = (body: JSONContent, find: (title: string) => string | undefined) => linkWikiLinks([{ id: 'here', body }], find)[0]

describe('[[links]] in imported text', () => {
  const find = (title: string) => ({ ferry: 'f1', 'ferry times': 'f2' })[title.toLowerCase()]

  it('become links where a note has that title, keeping the text around them and its marks', () => {
    const body: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'See [[Ferry]] and [[Ferry times|the times]], not [[Nowhere]].', marks: [{ type: 'italic' }] }] }],
    }
    expect(inOne(body, find).content?.[0].content).toEqual([
      { type: 'text', text: 'See ', marks: [{ type: 'italic' }] },
      link('f1', 'Ferry'),
      { type: 'text', text: ' and ', marks: [{ type: 'italic' }] },
      link('f2', 'Ferry times'),
      { type: 'text', text: ', not [[Nowhere]].', marks: [{ type: 'italic' }] },
    ])
  })

  it('find a note written with its folder before it, as Obsidian writes one of two with a name, and one with a slash of its own', () => {
    const where = (title: string) => ({ ferry: 'f1', 'either/or': 'e1' })[title.toLowerCase()]
    const body: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [text('[[Notes/Travel/Ferry|the boat]] [[Either/Or]] [[Notes/]] [[Notes/Nowhere]]')] }] }
    expect(inOne(body, where).content?.[0].content).toEqual([link('f1', 'Ferry'), text(' '), link('e1', 'Either/Or'), text(' [[Notes/]] [[Notes/Nowhere]]')])
  })

  it('leave code alone', () => {
    const body: JSONContent = {
      type: 'doc',
      content: [
        { type: 'codeBlock', content: [text('[[Ferry]]')] },
        { type: 'paragraph', content: [{ type: 'text', text: '[[Ferry]]', marks: [{ type: 'code' }] }] },
      ],
    }
    expect(inOne(body, find)).toEqual(body)
  })
})

