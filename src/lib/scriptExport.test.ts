// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { fromFountain } from './fountain'
import { scriptDocx, scriptHtml } from './scriptExport'

const SCRIPT = [
  'Title: The Keeper',
  'Credit: Written by',
  'Author: Ana Lee',
  '',
  'ext. lighthouse - night #1#',
  '',
  'Rain *hammers* the glass.',
  'The lamp turns.',
  '',
  'MARA',
  '(quietly)',
  'Every night.',
  '',
  'TOM ^',
  'Not tonight.',
  '',
  '===',
  '',
  'CUT TO:',
  '',
  '> THE END <',
].join('\n')

describe('scriptHtml', () => {
  const page = new DOMParser().parseFromString(scriptHtml(fromFountain(SCRIPT), 'The Keeper'), 'text/html')
  const shown = [...page.querySelectorAll('main > p, main > div > div > p')].map((p) => [p.className, p.textContent])

  it('sets each element as its own paragraph, as it prints, without Fountain’s marks', () => {
    expect(page.title).toBe('The Keeper')
    expect(shown).toEqual([
      ['scene', '11EXT. LIGHTHOUSE - NIGHT'],
      ['action', 'Rain hammers the glass.The lamp turns.'],
      ['character', 'MARA'],
      ['parenthetical', '(quietly)'],
      ['dialogue', 'Every night.'],
      ['character', 'TOM'],
      ['dialogue', 'Not tonight.'],
      ['transition page-break', 'CUT TO:'],
      ['centered', 'THE END'],
    ])
    expect(page.querySelector('.action')!.innerHTML).toBe('Rain <i>hammers</i> the glass.<br>The lamp turns.')
  })

  it('puts two speaking at once side by side, and the title page first', () => {
    expect([...page.querySelectorAll('.dual > div')].map((side) => side.querySelector('.character')?.textContent)).toEqual(['MARA', 'TOM'])
    const title = [...page.querySelectorAll('.title-page p')]
    expect(title.filter((line) => line.textContent).map((line) => [line.getAttribute('style'), line.textContent])).toEqual([
      ['text-align: center', 'The Keeper'],
      ['text-align: center', 'Written by'],
      ['text-align: center', 'Ana Lee'],
    ])
  })
})

describe('scriptDocx', () => {
  it('is Courier on Letter, each element from its indent, the title page a section of its own and the script’s pages numbered after the first', async () => {
    const files = unzipSync(new Uint8Array(await (await scriptDocx(fromFountain(SCRIPT), 'The Keeper')).arrayBuffer()))
    const xml = strFromU8(files['word/document.xml'])
    const styles = strFromU8(files['word/styles.xml'])
    expect(styles).toContain('w:ascii="Courier New"')
    expect(xml.match(/<w:pgSz [^>]*>/g)).toEqual(['<w:pgSz w:w="12240" w:h="15840" w:orient="portrait"/>', '<w:pgSz w:w="12240" w:h="15840" w:orient="portrait"/>'])
    expect(xml).toContain('<w:titlePg/>')
    const paragraph = (words: string) => xml.split('<w:p>').find((one) => one.includes(`>${words}<`)) ?? ''
    expect(paragraph('MARA')).toContain('<w:ind w:left="3168" w:right="0"/>')
    expect(paragraph('(quietly)')).toContain('<w:ind w:left="2304" w:right="2736"/>')
    expect(paragraph('Every night.')).toContain('<w:ind w:left="1440" w:right="2160"/>')
    expect(paragraph('CUT TO:')).toContain('<w:pageBreakBefore/>')
    expect(paragraph('CUT TO:')).toContain('<w:jc w:val="right"/>')
    expect(paragraph('EXT. LIGHTHOUSE - NIGHT')).toContain('w:hanging="720"')
    expect(paragraph('hammers')).toContain('<w:i/>')
    expect(paragraph('MARA')).toContain('<w:keepNext/>')
    expect(paragraph('Every night.')).not.toContain('<w:keepNext/>')
  })
})
