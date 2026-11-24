import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { asElement, fromFountain, isCue, isScreenplay, isSceneHeading, linesOf, nameOf, nextElement, pageCount, readLines, scriptPreview, scriptTitle, titlePage, toFountain, withoutWritersLines, type Element } from './fountain'

/** What each line of `script` is. */
const elements = (script: string): Element[] => readLines(script.split('\n')).map((line) => line.element)
/** Each line's element and printed words, blanks left out. */
const read = (script: string) =>
  readLines(script.split('\n'))
    .filter((line) => line.element !== 'blank')
    .map(({ element, text, dual, number }) => ({ element, text, ...(dual && { dual }), ...(number && { number }) }))

const para = (...content: JSONContent[]): JSONContent => (content.length ? { type: 'paragraph', content } : { type: 'paragraph' })
const text = (words: string, ...marks: string[]): JSONContent => ({ type: 'text', text: words, ...(marks.length && { marks: marks.map((type) => ({ type })) }) })

describe('isScreenplay', () => {
  it('is a page marked as one, and nothing else', () => {
    expect(isScreenplay({ kind: 'page', screenplay: true })).toBe(true)
    expect(isScreenplay({ kind: 'note', screenplay: true })).toBe(false)
    expect(isScreenplay({ kind: 'page', screenplay: null })).toBe(false)
    expect(isScreenplay({ kind: 'page' })).toBe(false)
  })
})

describe('readLines: scene headings', () => {
  it('begin INT, EXT, EST, INT./EXT, INT/EXT or I/E with a dot or a space, in any case', () => {
    for (const heading of ['INT. KITCHEN - NIGHT', 'EXT. BRICK’S PATIO - DAY', 'EST. THE CITY', 'INT./EXT. CAR - MOVING', 'INT/EXT CAR', 'I/E CAR', 'int. kitchen - night', 'EXT BEACH']) {
      expect(read(`\n${heading}\n`)).toEqual([{ element: 'scene', text: heading }])
    }
  })

  it('aren’t a word that only starts the same, nor ... at the start of a line', () => {
    expect(elements('INTERIOR DECORATING IS HARD.')).toEqual(['action'])
    expect(elements('...and then it stopped.')).toEqual(['action'])
  })

  it('can be forced with one dot, and carry a scene number', () => {
    expect(read('.SNIPER SCOPE POV')).toEqual([{ element: 'scene', text: 'SNIPER SCOPE POV' }])
    expect(read('INT. HOUSE - DAY #1A#')).toEqual([{ element: 'scene', text: 'INT. HOUSE - DAY', number: '1A' }])
  })

  it('need an empty line before them, and read the lines under them on their own', () => {
    expect(elements('The door opens.\nINT. HOUSE - DAY')).toEqual(['action', 'action'])
    expect(read('INT. HOUSE - DAY\nRain on the glass.')).toEqual([
      { element: 'scene', text: 'INT. HOUSE - DAY' },
      { element: 'action', text: 'Rain on the glass.' },
    ])
  })
})

describe('readLines: characters and what they say', () => {
  it('are a line in capitals with a line under it, then dialogue and parentheticals to the next empty line', () => {
    expect(read('STEEL\n(beat)\nDid you hear that?\nI did.')).toEqual([
      { element: 'character', text: 'STEEL' },
      { element: 'parenthetical', text: '(beat)' },
      { element: 'dialogue', text: 'Did you hear that?' },
      { element: 'dialogue', text: 'I did.' },
    ])
  })

  it('take an extension in any case, and numbers, dots and apostrophes in the name', () => {
    expect(read('MOM (V.O.)\nDinner!')[0]).toEqual({ element: 'character', text: 'MOM (V.O.)' })
    expect(read("HANS (on the radio) (cont'd)\nNo.")[0]).toEqual({ element: 'character', text: "HANS (on the radio) (cont'd)" })
    expect(read("R2-D2\nBeep.\n\nO'BRIEN\nYes.").filter((line) => line.element === 'character').map((line) => line.text)).toEqual(['R2-D2', "O'BRIEN"])
  })

  it('can be forced with @, small letters and all', () => {
    expect(read('@McCLANE\nYippee ki-yay.')[0]).toEqual({ element: 'character', text: 'McCLANE' })
  })

  it('mark one speaking at the same time with ^', () => {
    expect(read('BRICK\nScrew retirement.\n\nSTEEL ^\nScrew retirement.')[2]).toEqual({ element: 'character', text: 'STEEL', dual: true })
  })

  it('aren’t a line in capitals alone, nor one forced as action with !', () => {
    expect(elements('BOOM!')).toEqual(['action'])
    expect(elements('!SCANNING THE AISLES...\nWhere is that pit boss?')).toEqual(['action', 'action'])
  })

  it('keep a gap inside a speech with a line of two spaces', () => {
    expect(read('DEALER\nTen.\n  \nFour.').map((line) => line.element)).toEqual(['character', 'dialogue', 'dialogue', 'dialogue'])
  })
})

describe('readLines: transitions and centred lines', () => {
  it('are a line alone in capitals ending TO:, or forced with >', () => {
    expect(read('\nCUT TO:\n')).toEqual([{ element: 'transition', text: 'CUT TO:' }])
    expect(read('> Burn to White.')).toEqual([{ element: 'transition', text: 'Burn to White.' }])
  })

  it('aren’t when another line follows, or when it’s small letters', () => {
    expect(elements('Cut to:')).toEqual(['action'])
    expect(elements('SMASH CUT TO:\nThe beach.')).toEqual(['character', 'dialogue'])
  })

  it('centre a line between > and <', () => {
    expect(read('>THE END<')).toEqual([{ element: 'centered', text: 'THE END' }])
    expect(read('> INTERMISSION <')).toEqual([{ element: 'centered', text: 'INTERMISSION' }])
  })
})

describe('readLines: what isn’t printed, and the rest', () => {
  it('reads page breaks, sections, synopses, notes and lyrics', () => {
    expect(read('===\n\n# ACT ONE\n\n= Brick learns the truth.\n\n[[Check this with legal.]]\n\n~Willy Wonka! Willy Wonka!')).toEqual([
      { element: 'pageBreak', text: '' },
      { element: 'section', text: 'ACT ONE' },
      { element: 'synopsis', text: 'Brick learns the truth.' },
      { element: 'note', text: 'Check this with legal.' },
      { element: 'lyric', text: 'Willy Wonka! Willy Wonka!' },
    ])
  })

  it('leaves the boneyard out, over lines or inside one, and notes inside a line', () => {
    expect(elements('Before.\n\n/* A scene\nthat was cut. */\n\nAfter.')).toEqual(['action', 'blank', 'boneyard', 'boneyard', 'blank', 'action'])
    expect(read('He smiles /* a lot */ at her.[[too much?]]')).toEqual([{ element: 'action', text: 'He smiles  at her.' }])
  })

  it('keeps an action line’s own indent, and takes trailing spaces off', () => {
    expect(read('\t\tThe pit boss waits.   ')).toEqual([{ element: 'action', text: '\t\tThe pit boss waits.' }])
  })
})

describe('the title page', () => {
  const script = 'Title: Brick & Steel\n    Full Retired\nCredit: Written by\nAuthor: Stu Maschwitz\nDraft date: 1/20/2012\nContact:\n    Next Level Productions\n    1588 Mission Dr.\n\nEXT. BRICK’S PATIO - DAY'

  it('is the key: value lines at the top, up to the first empty line', () => {
    expect(elements(script)).toEqual(['title', 'title', 'title', 'title', 'title', 'title', 'title', 'title', 'blank', 'scene'])
    expect(titlePage(script.split('\n'))).toEqual([
      { key: 'title', value: ['Brick & Steel', 'Full Retired'] },
      { key: 'credit', value: ['Written by'] },
      { key: 'author', value: ['Stu Maschwitz'] },
      { key: 'draft date', value: ['1/20/2012'] },
      { key: 'contact', value: ['Next Level Productions', '1588 Mission Dr.'] },
    ])
  })

  it('isn’t there when the first line isn’t one of its keys, as FADE IN: so often is', () => {
    expect(titlePage(['INT. HOUSE - DAY', '', 'Title: this is action.'])).toEqual([])
    expect(elements('FADE IN:\n\nEXT. BEACH - DAY')).toEqual(['action', 'blank', 'scene'])
  })
})

describe('linesOf', () => {
  it('is a line a paragraph, a line break inside one a space, a note link its title', () => {
    const body = { type: 'doc', content: [para(text('INT. HOUSE')), para(), para(text('One'), { type: 'hardBreak' }, text('two')), para(text('See '), { type: 'noteLink', attrs: { id: 'x', title: 'Notes' } })] }
    expect(linesOf(body)).toEqual(['INT. HOUSE', '', 'One two', 'See Notes'])
  })
})

describe('toFountain and fromFountain', () => {
  const body: JSONContent = {
    type: 'doc',
    content: [
      para(text('EXT. BEACH - DAY')),
      para(),
      para(text('The '), text('waves', 'italic'), text(' are '), text('loud', 'bold'), text(', and '), text('cold', 'underline'), text('.')),
      para(),
      para(text('MARA')),
      para(text('I said '), text('no', 'bold', 'italic'), text('. 2 * 3 is_not_ 7.')),
    ],
  }
  const file = 'EXT. BEACH - DAY\n\nThe *waves* are **loud**, and _cold_.\n\nMARA\nI said ***no***. 2 \\* 3 is\\_not\\_ 7.\n'

  it('writes bold, italic and underline as **, * and _, and escapes the characters in the words', () => {
    expect(toFountain(body)).toBe(file)
  })

  it('reads them back as marks, a backslash’s character kept as it is', () => {
    expect(fromFountain(file)).toEqual(body)
  })

  it('reads Windows and old Mac line ends, a byte-order mark, and no last line end', () => {
    expect(linesOf(fromFountain('﻿INT. A\r\n\r\nB\rC'))).toEqual(['INT. A', '', 'B', 'C'])
  })

  it('leaves a lone * or _ as it is', () => {
    expect(fromFountain('5 * 4 and snake_case')).toEqual({ type: 'doc', content: [para(text('5 * 4 and snake_case'))] })
  })

  it('writes a line break inside a paragraph as a new line, and other blocks as their words', () => {
    const odd = { type: 'doc', content: [para(text('Hi.'), { type: 'hardBreak' }, text('Bye.')), { type: 'heading', attrs: { level: 1 }, content: [text('ACT ONE')] }] }
    expect(toFountain(odd)).toBe('Hi.\nBye.\nACT ONE\n')
  })
})

describe('asElement: a line made an element, from the keyboard bar or with Tab', () => {
  it('starts an empty line as a scene heading, a character, a parenthetical or a transition', () => {
    expect(asElement(['', ''], 1, 'scene')).toEqual({ text: 'INT. ', caret: 5, before: false, after: false })
    expect(asElement(['', ''], 1, 'character')).toEqual({ text: '@', caret: 1, before: false, after: false })
    expect(asElement(['', ''], 1, 'parenthetical')).toEqual({ text: '()', caret: 1, before: false, after: false })
    expect(asElement(['', ''], 1, 'transition')).toEqual({ text: '>', caret: 1, before: false, after: false })
  })

  it('makes words a heading with a dot when they don’t begin as one, and puts the empty line before it', () => {
    expect(asElement(['She runs.', 'the roof'], 1, 'scene')).toMatchObject({ text: '.the roof', before: true })
    expect(asElement(['', 'ext. roof - night'], 1, 'scene')).toMatchObject({ text: 'ext. roof - night', before: false })
  })

  it('puts a character’s name in capitals, and leaves its extension as it is', () => {
    expect(asElement(['', 'mara (v.o.)'], 1, 'character')).toMatchObject({ text: 'MARA (v.o.)' })
  })

  it('makes a transition of words ending TO: in capitals, others with >, and gives it room after', () => {
    expect(asElement(['Rain.', 'cut to:', 'INT. HOUSE'], 1, 'transition')).toEqual({ text: 'CUT TO:', caret: 7, before: true, after: true })
    expect(asElement(['', 'Fade to black.'], 1, 'transition')).toMatchObject({ text: '>Fade to black.' })
  })

  it('takes a forcing mark or brackets off for dialogue, and wraps a parenthetical', () => {
    expect(asElement(['MARA', '(quietly)'], 1, 'dialogue')).toMatchObject({ text: 'quietly' })
    expect(asElement(['MARA', 'quietly'], 1, 'parenthetical')).toEqual({ text: '(quietly)', caret: 8, before: false, after: false })
    expect(asElement(['', '@Mara'], 1, 'action')).toMatchObject({ text: 'Mara' })
  })

  it('forces action with ! when it would read as something else, and breaks it from a speech above', () => {
    expect(asElement(['', 'BOOM!', 'The house shakes.'], 1, 'action')).toMatchObject({ text: '!BOOM!' })
    expect(asElement(['MARA', 'Run.', 'She runs.'], 2, 'action')).toMatchObject({ text: 'She runs.', before: true })
  })
})

describe('nextElement: Tab’s order', () => {
  it('goes from action to a character, a scene heading, a transition and round; in a speech, between dialogue and a parenthetical', () => {
    expect(['action', 'character', 'scene', 'transition'].map((one) => nextElement(one as Element))).toEqual(['character', 'scene', 'transition', 'action'])
    expect(nextElement('blank')).toBe('character')
    expect(nextElement('character', -1)).toBe('action')
    expect([nextElement('dialogue'), nextElement('parenthetical')]).toEqual(['parenthetical', 'dialogue'])
  })
})

describe('isSceneHeading and isCue', () => {
  it('tell a heading’s start and a name in capitals', () => {
    expect([isSceneHeading('int. house'), isSceneHeading('Interior')]).toEqual([true, false])
    expect([isCue('MARA'), isCue('MARA (V.O.)'), isCue('@Mara'), isCue('Mara'), isCue('!MARA')]).toEqual([true, true, true, false, false])
  })
})

describe('pageCount', () => {
  const lines = (count: number, element: Element, text = 'x') => Array.from({ length: count }, () => ({ element, text }))

  it('is none for nothing printed, and a page for a line', () => {
    expect(pageCount(readLines(['Title: Untitled']))).toBe(0)
    expect(pageCount(readLines(['INT. HOUSE - DAY']))).toBe(1)
  })

  it('counts 55 lines a page, each element wrapped at its own width', () => {
    expect(pageCount(lines(55, 'action'))).toBe(1)
    expect(pageCount(lines(56, 'action'))).toBe(2)
    // 70 characters of dialogue is two lines at 35; of action, two at 60.
    expect(pageCount(lines(28, 'dialogue', 'x'.repeat(70)))).toBe(2)
    expect(pageCount(lines(27, 'action', 'x'.repeat(70)))).toBe(1)
  })

  it('starts a new page at a page break, and doesn’t count what isn’t printed', () => {
    expect(pageCount([...lines(3, 'action'), { element: 'pageBreak', text: '' }, ...lines(3, 'action')])).toBe(2)
    expect(pageCount([...lines(1, 'action'), ...lines(200, 'note'), ...lines(200, 'section')])).toBe(1)
  })
})

describe('scriptTitle', () => {
  it('is the title page’s title, or the first line printed, as printed, or Untitled', () => {
    expect(scriptTitle(fromFountain('Title: The Lighthouse\n    Keeper\nAuthor: Ana\n\nINT. A'))).toBe('The Lighthouse Keeper')
    expect(scriptTitle(fromFountain('[[a note]]\n\n.a harbour at dawn'))).toBe('A HARBOUR AT DAWN')
    expect(scriptTitle(fromFountain(''))).toBe('Untitled')
  })
})

describe('what a screenplay is called, and what its card shows under that', () => {
  const script = (text: string) => ({ kind: 'page' as const, screenplay: true as const, body: fromFountain(text) })

  it('is its title and its first printed line; with no title page, its first two', () => {
    expect(nameOf(script('Title: The Keeper\n\n# Act one\n\nFADE IN:'))).toBe('The Keeper')
    expect(scriptPreview(script('Title: The Keeper\n\n# Act one\n\nFADE IN:').body)).toBe('FADE IN:')
    expect(nameOf(script('int. house - day\n\nThe door opens.'))).toBe('INT. HOUSE - DAY')
    expect(scriptPreview(script('int. house - day\n\nThe door opens.').body)).toBe('The door opens.')
  })

  it('is a page’s first line for any other', () => {
    expect(nameOf({ kind: 'page', body: fromFountain('Title: The Keeper\n\nINT. HOUSE') })).toBe('Title: The Keeper')
  })
})

describe('emphasis, out to Fountain and back', () => {
  type Marked = { text: string; marks?: string[] }
  const body = (...lines: Marked[][]) => ({ type: 'doc', content: lines.map((line) => ({ type: 'paragraph', content: line.map(({ text, marks }) => ({ type: 'text', text, ...(marks?.length && { marks: marks.map((type) => ({ type })) }) })) })) })
  /** A line's text and marks, however it's cut into pieces: each character with its marks, in one order. */
  const letters = (doc: { content?: { content?: { text?: string; marks?: { type: string }[] }[] }[] }) =>
    (doc.content ?? []).map((line) => (line.content ?? []).flatMap((piece) => [...(piece.text ?? '')].map((char) => `${char}:${(piece.marks ?? []).map((mark) => mark.type).sort().join('+')}`)))

  it('writes a mark once where it begins and once where it ends, whatever is marked inside it', () => {
    expect(toFountain(body([{ text: 'He said ', marks: ['bold'] }, { text: 'now', marks: ['bold', 'italic'] }, { text: ' again', marks: ['bold'] }]))).toBe('**He said *now* again**\n')
    expect(toFountain(body([{ text: 'She ', marks: ['italic'] }, { text: 'really', marks: ['italic', 'bold'] }, { text: ' means it', marks: ['italic'] }]))).toBe('*She **really** means it*\n')
    expect(toFountain(body([{ text: 'all three', marks: ['italic', 'bold', 'underline'] }]))).toBe('_***all three***_\n')
  })

  it('reads its own nested and neighbouring marks back as they were', () => {
    for (const line of ['**He said *now* again**', '*She **really** means it*', '**NO*!***', '*a***b**', '**a***b*', '***a****b*', '_*a*_*b*', '*\\*x*', 'a \\* b \\_ c', '***both***']) {
      const read = fromFountain(line)
      expect(toFountain(read), line).toBe(`${line}\n`)
      expect(letters(fromFountain(toFountain(read))), line).toEqual(letters(read))
    }
    expect(letters(fromFountain('**NO*!***'))).toEqual([['N:bold', 'O:bold', '!:bold+italic']])
    // Never closed: its characters.
    expect(letters(fromFountain('5 * 3 and **bold**'))).toEqual([[...'5 * 3 and '].map((char) => `${char}:`).concat([...'bold'].map((char) => `${char}:bold`))])
  })

  it('keeps every mark of every piece, for any marks on any pieces side by side', () => {
    let seed = 11
    const roll = (below: number) => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return Math.floor((seed / 4294967296) * below)
    }
    const WORDS = ['a', 'MARA', ' ', 'x y', '*', '_', '\\', 'né', '!', ' z']
    for (let run = 0; run < 2000; run++) {
      const line: Marked[] = []
      for (let piece = 0, pieces = 1 + roll(6); piece < pieces; piece++) {
        const marks = ['bold', 'italic', 'underline'].filter(() => roll(2) === 1)
        // Pieces side by side with the same marks are one piece on the page.
        if (line.length > 0 && (line.at(-1)!.marks ?? []).join() === marks.join()) continue
        line.push({ text: WORDS[roll(WORDS.length)], marks })
      }
      const doc = body(line)
      expect(letters(fromFountain(toFountain(doc))), toFountain(doc)).toEqual(letters(doc))
    }
  })
})

describe('a line made to be slow', () => {
  const quick = (work: () => unknown) => {
    const from = performance.now()
    work()
    return performance.now() - from
  }
  // Each of these took seconds, and four times as long for twice the length: patterns tried again from every space, bracket or mark.
  it('is read in a moment, however long', () => {
    const spaces = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: `.X${' '.repeat(200_000)}Y` }] }] }
    expect(quick(() => scriptTitle(spaces))).toBeLessThan(500)
    expect(quick(() => readLines([`MARA${' '.repeat(200_000)}(`, 'Hello.']))).toBeLessThan(500)
    expect(quick(() => readLines(['[['.repeat(200_000)]))).toBeLessThan(500)
    expect(quick(() => readLines(['/*'.repeat(200_000)]))).toBeLessThan(500)
    expect(quick(() => fromFountain('****x'.repeat(40_000)))).toBeLessThan(500)
    expect(quick(() => fromFountain('_*'.repeat(100_000)))).toBeLessThan(500)
  })

  it('still reads a scene’s number, a cue’s extension, and notes and the boneyard inside a line', () => {
    expect(readLines(['INT. HOUSE - DAY #12A#', ''])[0]).toMatchObject({ element: 'scene', text: 'INT. HOUSE - DAY', number: '12A' })
    expect(readLines(['INT. HOUSE#12A#', ''])[0]).toMatchObject({ element: 'scene', text: 'INT. HOUSE#12A#' })
    expect(readLines(['', 'MARA (V.O.)', 'Hello.'])[1]).toMatchObject({ element: 'character' })
    expect(readLines(['', 'Mara (V.O.)', 'Hello.'])[1]).toMatchObject({ element: 'action' })
    expect(readLines(['', 'A [[note]] line /* cut */ kept [[open'])[1].text).toBe('A  line  kept [[open')
  })
})

describe('a screenplay as it’s shared', () => {
  /** As typed into a screenplay: each line a paragraph of its words as they are. */
  const typed = (script: string): JSONContent => ({ type: 'doc', content: script.split('\n').map((line) => (line ? para(text(line)) : para())) })
  const shared = (script: string) => linesOf(withoutWritersLines(typed(script)))

  it('goes without the writer’s own lines: notes, sections, synopses and what’s cut, on lines of their own or inside one', () => {
    expect(
      shared(
        ['Title: The Keeper', 'Notes: kept, it’s the title page', '', '# Act One', '', '= She comes home.', '', 'INT. LIGHTHOUSE - NIGHT', '', '[[check the tide tables]]', '', 'Mara climbs [[ninety-one? count]] the steps. /* too slow */', '', '/* A scene', 'that was cut. */', '', 'MARA', 'The lamp is cold[[ or dark?]].'].join('\n'),
      ),
    ).toEqual(['Title: The Keeper', 'Notes: kept, it’s the title page', '', '', '', 'INT. LIGHTHOUSE - NIGHT', '', '', 'Mara climbs  the steps. ', '', '', '', 'MARA', 'The lamp is cold.'])
  })

  it('keeps a line’s marks around what’s taken out, and the script’s own empty lines', () => {
    const body = withoutWritersLines(fromFountain('*Quietly [[how?]] now*\n\n  \nNothing here to take.'))
    expect(body.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Quietly  now', marks: [{ type: 'italic' }] }] },
      { type: 'paragraph' },
      { type: 'paragraph', content: [{ type: 'text', text: '  ' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Nothing here to take.' }] },
    ])
  })

  it('leaves nothing of a note for a reader to find', () => {
    const sent = JSON.stringify(withoutWritersLines(typed('INT. HOUSE - DAY\n\n[[SECRET one]]\n\nJoe waits. [[SECRET two]] /* SECRET six */\n\n/*\nSECRET three\n*/\n\n= SECRET four\n\n# SECRET five')))
    expect(sent).not.toContain('SECRET')
  })
})
