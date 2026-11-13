import { describe, expect, it } from 'vitest'
import type { Item } from '../db/db'
import { asPlaced, gathered, MAX_GATHERED, samePlaced, whatIs } from './placed'
import { drawn } from './rewards'
import { BOOK } from './stampbook'

describe('asPlaced', () => {
  it('keeps the book’s stamps by number and holidays’ by their day, each once, three at most', () => {
    expect(asPlaced(undefined)).toBeUndefined()
    expect(asPlaced('stamps')).toBeUndefined()
    expect(asPlaced([])).toEqual([])
    expect(
      asPlaced([{ day: '2026-11-04', no: 7 }, { day: '2026-11-05', no: 7 }, { day: '2026-10-31' }, { day: '2027-10-31' }, { day: '2026-11-04', no: 200 }, { day: '2026-11-04', no: 8 }]),
    ).toEqual([{ day: '2026-11-04', no: 7 }, { day: '2026-10-31' }, { day: '2026-11-04', no: 200 }])
    expect(asPlaced([{ day: '2026-11-04' }, { day: '2026-11-04', no: 0 }, { day: '2026-11-04', no: 301 }, { day: '2026-11-04', no: 1.5 }, { no: 3 }, null, 'x'])).toEqual([])
  })
})

describe('samePlaced', () => {
  it('is the same stamp whatever day it was found', () => {
    expect(samePlaced({ day: '2026-01-01', no: 7 }, { day: '2027-05-05', no: 7 })).toBe(true)
    expect(samePlaced({ day: '2026-10-31' }, { day: '2027-10-31' })).toBe(true)
    expect(samePlaced({ day: '2026-10-31' }, { day: '2026-11-26' })).toBe(false)
    expect(samePlaced({ day: '2026-10-31', no: 7 }, { day: '2026-10-31' })).toBe(false)
  })
})

describe('whatIs and drawn', () => {
  it('tell a book’s stamp from a holiday’s, and draw each as it was found', () => {
    expect(whatIs({ day: '2026-11-04', no: 127 })).toEqual({ entry: BOOK[126] })
    expect(whatIs({ day: '2026-10-31' })).toMatchObject({ holiday: { name: 'Halloween' } })
    expect(drawn({ day: '2026-11-04', no: 127 })).toMatchObject({ day: '2026-11-04', no: 127, rarity: 'rare' })
    expect(drawn({ day: '2026-10-31' })).toMatchObject({ day: '2026-10-31', rarity: 'unique' })
  })
})

describe('gathered', () => {
  const chapter = (stamps?: Item['stamps']) => ({ stamps }) as Item
  it('gives a manuscript its chapters’ stamps, each once, in chapter order, as many as a cover shows', () => {
    expect(gathered([chapter([{ day: '2026-01-01', no: 9 }]), chapter(), chapter([{ day: '2026-02-01', no: 9 }, { day: '2026-10-31' }])])).toEqual([
      { day: '2026-01-01', no: 9 },
      { day: '2026-10-31' },
    ])
    const many = Array.from({ length: 8 }, (_, i) => chapter([{ day: '2026-01-01', no: i * 2 + 1 }, { day: '2026-01-01', no: i * 2 + 2 }]))
    expect(gathered(many)).toHaveLength(MAX_GATHERED)
  })
})
