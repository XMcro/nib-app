// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fromFdx, toFdx } from './fdx'
import { fromFountain, linesOf, readLines, titlePage, toFountain } from './fountain'

/** Each paragraph of a file's script as its Type, its other attributes and its words, a line break as |. */
function paragraphs(xml: string) {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml')
  return [...parsed.querySelectorAll('Content > Paragraph')]
    .filter((paragraph) => paragraph.closest('TitlePage') === null)
    .map((paragraph) => {
      const attributes = Object.fromEntries([...paragraph.attributes].map((attribute) => [attribute.name, attribute.value]))
      const words = [...paragraph.children].filter((child) => child.tagName === 'Text').map((text) => text.textContent).join('').replace(/\n/g, '|')
      const pair = paragraph.querySelector(':scope > DualDialogue')
      return pair ? { dual: [...pair.children].map((one) => `${one.getAttribute('Type')}: ${one.textContent}`) } : { ...attributes, words }
    })
}

const SCRIPT = [
  'Title: The Lighthouse Keeper',
  'Credit: Written by',
  'Author: Ana Lee',
  'Draft date: 22 November 2026',
  'Contact:',
  '    ana@example.com',
  '',
  'ext. lighthouse - night #1#',
  '',
  'Rain *hammers* the glass.',
  'The **lamp** turns.',
  '',
  '# Act one',
  '',
  '[[Check the tide tables.]]',
  '',
  'MARA (V.O.)',
  '(quietly)',
  'Every night & every day.',
  '',
  'TOM ^',
  'Not tonight.',
  '',
  '~La la la',
  '',
  '> THE END <',
  '',
  '===',
  '',
  'CUT TO:',
].join('\n')

describe('toFdx', () => {
  const xml = toFdx(fromFountain(SCRIPT))

  it('is Final Draft’s XML, as the open-source tools write it', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<FinalDraft DocumentType="Script" Template="No" Version="1">\n  <Content>\n')).toBe(true)
    expect(new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('parsererror')).toHaveLength(0)
  })

  it('writes each printed element as its paragraph, and leaves out what isn’t printed', () => {
    expect(paragraphs(xml)).toEqual([
      { Type: 'Scene Heading', Number: '1', words: 'EXT. LIGHTHOUSE - NIGHT' },
      { Type: 'Action', words: 'Rain hammers the glass.|The lamp turns.' },
      { dual: ['Character: MARA (V.O.)', 'Parenthetical: (quietly)', 'Dialogue: Every night & every day.', 'Character: TOM', 'Dialogue: Not tonight.'] },
      { Type: 'Action', words: 'La la la' },
      { Type: 'Action', Alignment: 'Center', words: 'THE END' },
      { Type: 'Transition', StartsNewPage: 'Yes', words: 'CUT TO:' },
    ])
  })

  it('keeps bold, italic and underline in Text’s Style, and lyrics in italic', () => {
    expect(xml).toContain('<Text>Rain </Text><Text Style="Italic">hammers</Text><Text> the glass.</Text><Text>\n</Text><Text>The </Text><Text Style="Bold">lamp</Text>')
    expect(xml).toContain('<Text Style="Italic">La la la</Text>')
    expect(xml).toContain('Every night &amp; every day.')
  })

  it('writes the title page a line a paragraph, aligned as Nib prints it', () => {
    const title = new DOMParser().parseFromString(xml, 'application/xml').querySelectorAll('TitlePage > Content > Paragraph')
    const filled = [...title].filter((paragraph) => paragraph.textContent).map((paragraph) => [paragraph.getAttribute('Alignment'), paragraph.textContent])
    expect(filled).toEqual([
      ['Center', 'The Lighthouse Keeper'],
      ['Center', 'Written by'],
      ['Center', 'Ana Lee'],
      ['Left', 'ana@example.com'],
      ['Right', '22 November 2026'],
    ])
    // The title a third of the way down, as on the PDF.
    expect([...title].findIndex((paragraph) => paragraph.textContent)).toBe(18)
  })

  it('has no title page without title lines', () => {
    expect(toFdx(fromFountain('INT. HOUSE - DAY'))).not.toContain('TitlePage')
  })
})

describe('fromFdx', () => {
  const file = `<?xml version="1.0" encoding="UTF-8" standalone="no" ?>
<FinalDraft DocumentType="Script" Template="No" Version="5">
  <Content>
    <Paragraph Type="Scene Heading" Number="12A"><Text>Lighthouse lamp room</Text></Paragraph>
    <Paragraph Type="Action"><Text>The lamp </Text><Text Style="Bold+Underline">turns</Text><Text>.
It always has.</Text></Paragraph>
    <Paragraph Type="General"><Text>BOOM. A WAVE.</Text></Paragraph>
    <Paragraph Type="Shot"><Text>ANGLE ON THE SEA</Text></Paragraph>
    <Paragraph Type="Character"><Text>McCLANE</Text></Paragraph>
    <Paragraph Type="Parenthetical"><Text>quietly</Text></Paragraph>
    <Paragraph Type="Dialogue"><Text Style="AllCaps+Italic">now</Text><Text> or never.</Text><ScriptNote ID="1"><Paragraph><Text>a note</Text></Paragraph></ScriptNote></Paragraph>
    <Paragraph>
      <DualDialogue>
        <Paragraph Type="Character"><Text>MARA</Text></Paragraph>
        <Paragraph Type="Dialogue"><Text>Here.</Text></Paragraph>
        <Paragraph Type="Character"><Text>TOM</Text></Paragraph>
        <Paragraph Type="Dialogue"><Text>There.</Text></Paragraph>
      </DualDialogue>
    </Paragraph>
    <Paragraph Type="Action" Alignment="Center"><Text>THE END</Text></Paragraph>
    <Paragraph Type="Transition" StartsNewPage="Yes"><Text>Dissolve</Text></Paragraph>
    <Paragraph Type="Action"><Text></Text></Paragraph>
  </Content>
  <TitlePage>
    <Content>
      <Paragraph Alignment="Center"><Text>THE KEEPER</Text></Paragraph>
      <Paragraph Alignment="Center"><Text></Text></Paragraph>
      <Paragraph Alignment="Center"><Text>Written by</Text></Paragraph>
      <Paragraph Alignment="Center"><Text>Ana Lee</Text></Paragraph>
      <Paragraph Alignment="Left"><Text>Agent Name
555 0100</Text></Paragraph>
      <Paragraph Alignment="Right"><Text>First draft</Text></Paragraph>
    </Content>
  </TitlePage>
</FinalDraft>`

  it('reads it as Fountain, forcing only what would be read as something else', () => {
    expect(toFountain(fromFdx(file)!)).toBe(
      [
        'Title: THE KEEPER',
        'Credit: Written by',
        'Author: Ana Lee',
        'Contact:',
        '    Agent Name',
        '    555 0100',
        'Draft date: First draft',
        '',
        '.Lighthouse lamp room #12A#',
        '',
        'The lamp _**turns**_.',
        'It always has.',
        '',
        'BOOM. A WAVE.',
        '',
        'ANGLE ON THE SEA',
        '',
        '@McCLANE',
        '(quietly)',
        '*NOW* or never.',
        '',
        'MARA',
        'Here.',
        '',
        'TOM ^',
        'There.',
        '',
        '> THE END <',
        '',
        '===',
        '',
        '> Dissolve',
        '',
      ].join('\n'),
    )
  })

  it('reads each line as Final Draft had it', () => {
    const read = readLines(linesOf(fromFdx(file)!)).filter((line) => line.element !== 'blank' && line.element !== 'title')
    expect(read.map((line) => [line.element, line.text])).toEqual([
      ['scene', 'Lighthouse lamp room'],
      ['action', 'The lamp turns.'],
      ['action', 'It always has.'],
      ['action', 'BOOM. A WAVE.'],
      ['action', 'ANGLE ON THE SEA'],
      ['character', 'McCLANE'],
      ['parenthetical', '(quietly)'],
      ['dialogue', 'NOW or never.'],
      ['character', 'MARA'],
      ['dialogue', 'Here.'],
      ['character', 'TOM'],
      ['dialogue', 'There.'],
      ['centered', 'THE END'],
      ['pageBreak', ''],
      ['transition', 'Dissolve'],
    ])
    expect(read.find((line) => line.text === 'TOM')?.dual).toBe(true)
    expect(read[0].number).toBe('12A')
  })

  it('comes back as it went out: what’s printed, in capitals where it prints so, and its title page', () => {
    const body = fromFountain(SCRIPT)
    const back = fromFdx(toFdx(body))!
    const printed = (lines: string[]) =>
      readLines(lines)
        .filter((line) => !['blank', 'title', 'section', 'note', 'synopsis', 'boneyard'].includes(line.element))
        .map((line) => [line.element, line.text, line.number ?? null, line.dual ?? null])
    const capitals = ['scene', 'character', 'transition']
    expect(printed(linesOf(back))).toEqual(
      printed(linesOf(body)).map(([element, text, ...rest]) => [element === 'lyric' ? 'action' : element, capitals.includes(element as string) ? (text as string).toUpperCase() : text, ...rest]),
    )
    expect(titlePage(linesOf(back))).toEqual([
      { key: 'title', value: ['The Lighthouse Keeper'] },
      { key: 'credit', value: ['Written by'] },
      { key: 'author', value: ['Ana Lee'] },
      { key: 'contact', value: ['ana@example.com'] },
      { key: 'draft date', value: ['22 November 2026'] },
    ])
  })

  it('is null for a file that isn’t Final Draft’s', () => {
    expect(fromFdx('<html><body>Hi</body></html>')).toBeNull()
    expect(fromFdx('<FinalDraft><Content>')).toBeNull()
    expect(fromFdx('not xml at all')).toBeNull()
  })
})
