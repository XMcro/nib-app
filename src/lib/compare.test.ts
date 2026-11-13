import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { bringBack, compare, type Paragraph, type Part, type Run } from './compare'

const text = (value: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
const para = (value: string) => p(text(value))
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const heading = (level: number, value: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [text(value)] })
const list = (...items: string[]): JSONContent => ({ type: 'bulletList', content: items.map((item) => ({ type: 'listItem', content: [para(item)] })) })
const tasks = (...items: [boolean, string][]): JSONContent => ({
  type: 'taskList',
  content: items.map(([checked, item]) => ({ type: 'taskItem', attrs: { checked }, content: [para(item)] })),
})
const quote = (...items: string[]): JSONContent => ({ type: 'blockquote', content: items.map(para) })
const table = (...rows: string[][]): JSONContent => ({
  type: 'table',
  content: rows.map((cells) => ({ type: 'tableRow', content: cells.map((cell) => ({ type: 'tableCell', attrs: { colwidth: null }, content: [para(cell)] })) })),
})
const image = (src: string): JSONContent => ({ type: 'image', attrs: { src } })
const footnote = (note: string): JSONContent => ({ type: 'footnote', attrs: { text: note } })
const bold = [{ type: 'bold' }]

/** A run as a diff would print it: [-taken out-], {+put in+}. */
const runs = (all: Run[]) => all.map((run) => (run.change === 'removed' ? `[-${run.text}-]` : run.change === 'added' ? `{+${run.text}+}` : run.text)).join('')

/** The comparison in a line a part. */
function shape(parts: Part[]) {
  return parts.map((part) => {
    if (part.kind === 'same') return `same ${part.paragraphs.length}`
    if (part.kind === 'changed') return `changed ${runs(part.runs)}${part.formatOnly ? ' (formatting only)' : ''}`
    return part.kind === 'removed' ? `removed ${part.then.text}` : `added ${part.now.text}`
  })
}

const at = (body: JSONContent, path: number[]) => path.reduce((node, index) => node.content![index], body)

const HARBOUR = [
  para('The Harbour'),
  para('It was the last week of the season.'),
  para('The boats came in late that evening, low in the water.'),
  para('Nobody on the quay looked up.'),
  para('Mara counted them twice.'),
]

describe('comparing two versions', () => {
  it('finds nothing changed in the same text, however each was saved', () => {
    expect(shape(compare(doc(...HARBOUR), structuredClone(doc(...HARBOUR))))).toEqual(['same 5'])
    // Keys in another order, and an attribute one version has empty and the other lacks.
    const then = doc({ type: 'heading', attrs: { level: 1 }, content: [text('The Harbour')] })
    const now = doc({ content: [text('The Harbour')], attrs: { textAlign: null, level: 1 }, type: 'heading' })
    expect(shape(compare(then, now))).toEqual(['same 1'])
  })

  it('marks the words that changed, in the paragraph that changed', () => {
    const now = structuredClone(HARBOUR)
    now[2] = para('The boats came in early that evening, low in the water.')
    expect(shape(compare(doc(...HARBOUR), doc(...now)))).toEqual([
      'same 2',
      'changed The boats came in [-late-]{+early+} that evening, low in the water.',
      'same 2',
    ])
  })

  it('reads changed words with only a space between them as one change', () => {
    expect(shape(compare(doc(para('a quick brown fox')), doc(para('a slow red fox'))))).toEqual(['changed a [-quick brown-]{+slow red+} fox'])
  })

  it('shows a removed paragraph where it was, and an added one where it is', () => {
    const [a, b, c, d] = HARBOUR
    expect(shape(compare(doc(a, b, c, d), doc(a, c, para('A gull on the harbour wall.'), d)))).toEqual([
      'same 1',
      'removed It was the last week of the season.',
      'same 1',
      'added A gull on the harbour wall.',
      'same 1',
    ])
  })

  it('pairs an edited paragraph with its earlier self, beside a new one', () => {
    const [a, , c, d] = HARBOUR
    const now = doc(a, para('Something new, nothing like the rest.'), para('The boats came in early that evening, low in the water.'), d)
    expect(shape(compare(doc(a, c, d), now))).toEqual([
      'same 1',
      'added Something new, nothing like the rest.',
      'changed The boats came in [-late-]{+early+} that evening, low in the water.',
      'same 1',
    ])
  })

  it('pairs a sentence written on with its earlier self, beside a new paragraph', () => {
    const then = doc(para('Mara counted them twice.'))
    const now = doc(para('Mara counted them twice, then a third time, because the number was wrong.'), para('A gull stood on the wall and watched her.'))
    expect(shape(compare(then, now))).toEqual([
      'changed Mara counted them twice{+, then a third time, because the number was wrong+}.',
      'added A gull stood on the wall and watched her.',
    ])
  })

  it('counts a paragraph rewritten in its place as changed, however much', () => {
    const [a, , c] = HARBOUR
    expect(shape(compare(doc(a, para('Rain.'), c), doc(a, para('Fog, all day.'), c)))).toEqual(['same 1', 'changed [-Rain-]{+Fog, all day+}.', 'same 1'])
  })

  it('takes each list item, quoted paragraph and table cell on its own', () => {
    const then = doc(para('Intro'), list('one', 'two', 'three', 'four'), quote('A quoted line.', 'Another.'), table(['a', 'b'], ['c', 'd']))
    const now = doc(para('Intro'), list('one', 'two', 'three and a half', 'four'), quote('A quoted line.', 'Another one.'), table(['a', 'b'], ['c', 'e']))
    const parts = compare(then, now)
    expect(shape(parts)).toEqual([
      'same 3',
      'changed three{+ and a half+}',
      'same 2',
      'changed Another{+ one+}.',
      'same 3',
      'changed [-d-]{+e+}',
    ])
    const changed = parts.filter((part) => part.kind === 'changed')
    expect(changed.map((part) => part.now.within)).toEqual([['bulletList', 'listItem'], ['blockquote'], ['table', 'tableRow', 'tableCell']])
  })

  it('says a code block given a language has changed only in its formatting', () => {
    const code = (language: string | null): JSONContent => ({ type: 'codeBlock', attrs: { language }, content: [text('const a')] })
    expect(shape(compare(doc(code(null)), doc(code('javascript'))))).toEqual(['changed const a (formatting only)'])
  })

  it('says when only the formatting changed', () => {
    const then = doc(para('The boats came in.'), para('Chapter one'), heading(2, 'Part one'), tasks([false, 'Check the tide tables']))
    const now = doc(
      p(text('The '), text('boats', bold), text(' came in.')),
      heading(1, 'Chapter one'),
      heading(3, 'Part one'),
      tasks([true, 'Check the tide tables']),
    )
    const parts = compare(then, now)
    expect(shape(parts)).toEqual([
      'changed The boats came in. (formatting only)',
      'changed Chapter one (formatting only)',
      'changed Part one (formatting only)',
      'changed Check the tide tables (formatting only)',
    ])
    const last = parts.at(-1)!
    expect(last.kind === 'changed' && last.now.within).toEqual(['taskList', 'taskItem:ticked'])
  })

  it('keeps a word half in bold one word', () => {
    expect(shape(compare(doc(para('boats')), doc(p(text('bo'), text('ats', bold)))))).toEqual(['changed boats (formatting only)'])
  })

  it('leaves out empty paragraphs, which are only spacing', () => {
    const [a, b] = HARBOUR
    expect(shape(compare(doc(a, b), doc(a, { type: 'paragraph' }, para('   '), b, p())))).toEqual(['same 2'])
  })

  it('shows pictures and footnotes, and sees when one changes', () => {
    const then = doc(p(text('See'), image('data:image/png;base64,AAAA'), footnote('First note.')))
    const newPicture = doc(p(text('See'), image('data:image/png;base64,BBBB'), footnote('First note.')))
    const newNote = doc(p(text('See'), image('data:image/png;base64,AAAA'), footnote('A better note.')))
    expect(shape(compare(then, structuredClone(then)))).toEqual(['same 1'])
    expect(shape(compare(then, newPicture))).toEqual(['changed See[-[Picture]-]{+[Picture]+}[Note: First note.]'])
    expect(shape(compare(then, newNote))).toEqual(['changed See[Picture][-[Note: First note.]-]{+[Note: A better note.]+}'])
  })

  // How large a picture is shown is how its line looks, as an alignment is: not a picture taken out and another put in.
  it('takes a picture shown at another size for the same picture, its line changed in formatting only', () => {
    const sized = (size: string | null): JSONContent => ({ type: 'image', attrs: { src: 'data:image/png;base64,AAAA', size } })
    expect(shape(compare(doc(p(text('See'), sized(null))), doc(p(text('See'), sized('medium')))))).toEqual(['changed See[Picture] (formatting only)'])
    expect(shape(compare(doc(p(text('See'), sized('medium'))), doc(p(text('See'), sized('medium')))))).toEqual(['same 1'])
  })

  it('says where each paragraph is, in its own version', () => {
    const then = doc(para('Intro'), list('one', 'two'), quote('Gone soon.'), table(['a', 'b']))
    const now = doc(para('Intro, longer'), para('New.'), list('one', 'two!'), table(['a', 'B']))
    const paragraphs: [JSONContent, Paragraph][] = []
    for (const part of compare(then, now)) {
      if (part.kind === 'same') paragraphs.push(...part.paragraphs.map((one): [JSONContent, Paragraph] => [now, one]))
      if (part.kind === 'changed' || part.kind === 'removed') paragraphs.push([then, part.then])
      if (part.kind === 'changed' || part.kind === 'added') paragraphs.push([now, part.now])
    }
    expect(paragraphs.length).toBeGreaterThan(6)
    for (const [body, paragraph] of paragraphs) expect(at(body, paragraph.path)).toBe(paragraph.node)
  })

  it('compares writing with no spaces between its words', () => {
    expect(shape(compare(doc(para('我喜欢猫')), doc(para('我喜欢狗'))))).toEqual(['changed 我喜欢[-猫-]{+狗+}'])
    expect(shape(compare(doc(para('猫が好きです')), doc(para('犬が好きです'))))).toEqual(['changed [-猫-]{+犬+}が好きです'])
  })

  it('finds a few changes in a long document', () => {
    const then = Array.from({ length: 3000 }, (_, n) => para(`Paragraph ${n}, where something happens to someone.`))
    const now = structuredClone(then)
    now[10] = para('Paragraph 10, where nothing happens to anyone.')
    now.splice(1500, 1)
    now.splice(2800, 0, para('A new paragraph near the end.'))
    expect(shape(compare(doc(...then), doc(...now)))).toEqual([
      'same 10',
      'changed Paragraph 10, where [-something-]{+nothing+} happens to [-someone-]{+anyone+}.',
      'same 1489',
      'removed Paragraph 1500, where something happens to someone.',
      'same 1300',
      'added A new paragraph near the end.',
      'same 199',
    ])
  })

  it('gives up on matching two long texts with nothing in common: all of one out, all of the other in', () => {
    const then = Array.from({ length: 1500 }, (_, n) => para(`Then ${n}`))
    const now = Array.from({ length: 1500 }, (_, n) => para(`Now ${n}`))
    const parts = compare(doc(...then), doc(...now))
    expect(parts.filter((part) => part.kind === 'removed')).toHaveLength(1500)
    expect(parts.filter((part) => part.kind === 'added')).toHaveLength(1500)
    expect(parts.slice(0, 1500).every((part) => part.kind === 'removed')).toBe(true)
  })

  it('gives up on matching a long paragraph rewritten from scratch, word by word', () => {
    const then = para(Array.from({ length: 1200 }, (_, n) => `old${n}`).join(' '))
    const now = para(Array.from({ length: 1200 }, (_, n) => `new${n}`).join(' '))
    const [part] = compare(doc(then), doc(now))
    expect(part.kind === 'changed' && part.runs.map((run) => run.change)).toEqual(['removed', 'added'])
  })
})

describe('a link to one line of a note', () => {
  const to = (block: string) => p(text('See '), { type: 'noteLink', attrs: { id: 'trips', title: 'Trips', block, part: `line ${block}` } })

  it('is the same left where it was, and changed moved to another line of the same note', () => {
    expect(shape(compare(doc(to('aaaa1111')), doc(to('aaaa1111'))))).toEqual(['same 1'])
    const [moved] = shape(compare(doc(to('aaaa1111')), doc(to('bbbb2222'))))
    expect(moved).toMatch(/^changed /)
    expect(moved).toContain('Trips › line aaaa1111')
    expect(moved).toContain('Trips › line bbbb2222')
  })
})

describe('a callout', () => {
  const box = (...items: string[]): JSONContent => ({ type: 'callout', attrs: { kind: 'tip', collapsed: false }, content: items.map(para) })

  it('has its changes found inside it, and earlier words brought back inside it', () => {
    const then = doc(box('Mind the step here.', 'Second line.'))
    const now = doc(box('Mind the ladder here.', 'Second line.'))
    const parts = compare(then, now)
    const index = parts.findIndex((part) => part.kind === 'changed')
    expect(parts[index]).toMatchObject({ kind: 'changed', now: { within: ['callout'] } })
    expect(bringBack(then, now, parts, index)).toEqual(then)
  })
})

describe('bringing one paragraph back', () => {
  /** The text with the first change of the given kind brought back. */
  function back(then: JSONContent, now: JSONContent, kind: 'changed' | 'removed' = 'changed') {
    const parts = compare(then, now)
    return bringBack(then, now, parts, parts.findIndex((part) => part.kind === kind))
  }

  it('gives a changed paragraph its earlier wording, and leaves the rest as it is now', () => {
    const now = structuredClone(HARBOUR)
    now[1] = para('It was the first week of the season.')
    now[3] = para('Somebody on the quay looked up.')
    const result = back(doc(...HARBOUR), doc(...now))!
    expect(result.content![1]).toEqual(HARBOUR[1])
    expect(shape(compare(doc(...HARBOUR), result))).toEqual(['same 3', 'changed [-Nobody-]{+Somebody+} on the quay looked up.', 'same 1'])
  })

  it('brings back formatting and a tick with the words', () => {
    const then = doc(heading(2, 'Part one'), tasks([false, 'Check the tide tables']))
    let result = doc(heading(3, 'Part one'), tasks([true, 'Check the tide tables']))
    result = back(then, result)!
    result = back(then, result)!
    expect(result).toEqual(then)
  })

  it('puts a removed paragraph back where it was', () => {
    const [a, b, c, d] = HARBOUR
    expect(back(doc(a, b, c, d), doc(a, c, d), 'removed')).toEqual(doc(a, b, c, d))
    expect(back(doc(a, b, c, d), doc(b, c, d), 'removed')).toEqual(doc(a, b, c, d))
    expect(back(doc(a, b, c, d), doc(a, b, c), 'removed')).toEqual(doc(a, b, c, d))
  })

  it('puts a removed list item back as an item of its list, first, middle or last', () => {
    const then = doc(para('Intro'), list('one', 'two', 'three'), para('Outro'))
    expect(back(then, doc(para('Intro'), list('two', 'three'), para('Outro')), 'removed')).toEqual(then)
    expect(back(then, doc(para('Intro'), list('one', 'three'), para('Outro')), 'removed')).toEqual(then)
    expect(back(then, doc(para('Intro'), list('one', 'two'), para('Outro')), 'removed')).toEqual(then)
  })

  it('puts a removed task back with its tick, and a quoted paragraph back in its quote', () => {
    const then = doc(tasks([false, 'Rope'], [true, 'Lanterns']), quote('A quoted line.', 'Another.'))
    expect(back(then, doc(tasks([false, 'Rope']), quote('A quoted line.', 'Another.')), 'removed')).toEqual(then)
    expect(back(then, doc(tasks([false, 'Rope'], [true, 'Lanterns']), quote('A quoted line.')), 'removed')).toEqual(then)
  })

  it('puts back a list, or a quote, that went with its last paragraph', () => {
    const then = doc(para('Intro'), list('only'), quote('Said once.'), para('Outro'))
    let result = doc(para('Intro'), para('Outro'))
    result = back(then, result, 'removed')!
    result = back(then, result, 'removed')!
    expect(result).toEqual(then)
  })

  it('puts a paragraph back into a document emptied since', () => {
    expect(back(doc(para('Only this.')), { type: 'doc' }, 'removed')).toEqual(doc(para('Only this.')))
  })

  it('leaves a paragraph removed from a table to restoring the whole version', () => {
    expect(back(doc(table(['a', 'b'], ['c', 'd'])), doc(table(['a', 'b'])), 'removed')).toBeNull()
    expect(back(doc(table(['a', 'b'])), doc(table(['a', 'B'])))).toEqual(doc(table(['a', 'b'])))
  })

  it('leaves the text it was given alone', () => {
    const now = doc(para('Intro'), list('two'))
    const before = structuredClone(now)
    back(doc(para('Intro'), list('one', 'two')), now, 'removed')
    expect(now).toEqual(before)
  })

  it('brings everything back, one at a time, but what was added since', () => {
    const then = doc(
      para('Chapter one'),
      para('The boats came in late that evening.'),
      para('Mara counted them twice.'),
      list('Rope', 'Lanterns', 'The good knife'),
      quote('Never trust a quiet sea.'),
      para('Her brother was not among them.'),
      para('She went home by the long road.'),
    )
    let now = doc(
      para('Chapter one'),
      para('The boats came in early that evening.'),
      para('Mara counted them twice, then a third time, because the number was wrong.'),
      para('A gull stood on the harbour wall.'),
      list('Rope', 'Lanterns, two of them'),
      quote('Never trust a quiet sea.'),
      para('She went home by the long road.'),
    )
    // At most once each, or one brought back wrong would go on for ever.
    for (let tries = 0; tries < 10; tries++) {
      const parts = compare(then, now)
      const index = parts.findIndex((part) => part.kind === 'changed' || part.kind === 'removed')
      if (index < 0) break
      now = bringBack(then, now, parts, index)!
    }
    expect(shape(compare(then, now))).toEqual(['same 3', 'added A gull stood on the harbour wall.', 'same 6'])
  })
})
