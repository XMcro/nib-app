import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { asCast, MAX_CAST, mentionsIn, type CastCard } from './cast'

const chapter = (id: string, ...lines: string[]): { id: string; body: JSONContent } => ({
  id,
  body: { type: 'doc', content: lines.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) },
})
const card = (name: string, also: string[] = [], kind: CastCard['kind'] = 'character'): CastCard => ({ id: name.toLowerCase().replace(/\W+/g, '-'), kind, name, also })

describe('asCast', () => {
  it('keeps each card once by its id, its name and other names a line each, its line one of at most 200 characters', () => {
    expect(
      asCast([
        { id: 'mara', kind: 'character', name: '  Mara\n Lee ', also: ['Mrs Lee', 'Mara Lee', 'Mrs  Lee', ''], line: 'Keeps the light.\nSixty.' },
        { id: 'mara', kind: 'character', name: 'Again' },
        { id: 'harbour', kind: 'place', name: 'The harbour', line: 'x'.repeat(300) },
      ]),
    ).toEqual([
      { id: 'mara', kind: 'character', name: 'Mara Lee', also: ['Mrs Lee'], line: 'Keeps the light. Sixty.' },
      { id: 'harbour', kind: 'place', name: 'The harbour', also: [], line: 'x'.repeat(200) },
    ])
  })

  it('passes over what isn’t one, and says nothing for what isn’t a list', () => {
    expect(asCast([null, 'x', { id: 'a', kind: 'monster', name: 'A' }, { id: 'b c', kind: 'place', name: 'B' }, { id: 'c', kind: 'place', name: '' }, { id: 'd', kind: 'place', name: 'x'.repeat(81) }])).toEqual([])
    for (const raw of [null, {}, 'x']) expect(asCast(raw)).toBeUndefined()
    expect(asCast(Array.from({ length: MAX_CAST + 5 }, (_, n) => ({ id: `c${n}`, kind: 'place', name: `P${n}` })))).toHaveLength(MAX_CAST)
  })
})

describe('mentionsIn', () => {
  it('finds each card’s chapters in their order, with how many times they name it, by any of its names', () => {
    const mara = card('Mara', ['Mrs Lee'])
    const harbour = card('Port Ellen', [], 'place')
    const found = mentionsIn([mara, harbour], [
      chapter('one', 'Mara climbs the steps. Mrs Lee, they call her.', 'Mara’s notebook. Mara\'s tin.'),
      chapter('two', 'Nobody here.'),
      chapter('three', 'The boat to Port Ellen. Port Ellen again.'),
    ])
    expect(found.get(mara.id)).toEqual([{ id: 'one', count: 4 }])
    expect(found.get(harbour.id)).toEqual([{ id: 'three', count: 2 }])
  })

  it('takes whole words only, as written or in capitals, and a longer name as one mention', () => {
    const lee = card('Lee', ['Mrs Lee'])
    const rose = card('Rose')
    const found = mentionsIn([lee, rose], [
      chapter('one', 'Leeds. Mrs Lee. Lee-Lee.'),
      chapter('two', 'She picked a rose.', 'ROSE', '(quietly)', 'Here.'),
    ])
    // "Mrs Lee" once, then Lee and Lee either side of the hyphen; not Leeds.
    expect(found.get(lee.id)).toEqual([{ id: 'one', count: 3 }])
    // A screenplay's cue in capitals; not the flower.
    expect(found.get(rose.id)).toEqual([{ id: 'two', count: 1 }])
  })

  it('finds a name that has a full stop or brackets in it as written', () => {
    const doctor = card('Dr. Okafor (senior)')
    expect(mentionsIn([doctor], [chapter('one', 'Dr. Okafor (senior) arrives. Dr Okafor does not.')]).get(doctor.id)).toEqual([{ id: 'one', count: 1 }])
  })
})
