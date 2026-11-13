import { describe, expect, it } from 'vitest'
import { around, covers, newShape, runsOf, span, type GridShape } from './cardWindow'

const shape = (over: Partial<GridShape> = {}): GridShape => ({ ...newShape(), columns: 3, gap: 16, typical: 150, measured: true, ...over })

describe('around', () => {
  it('takes whole rows, the window and as many windows either side as asked', () => {
    // 800 high at 150 a row: 2 windows above and below of the rows at 4,000.
    expect(around(shape(), 3000, 4000, 800, 2)).toEqual({ first: 48, last: 129 })
  })

  it('starts at the top and stops at the end of the list', () => {
    expect(around(shape(), 3000, 0, 800, 2).first).toBe(0)
    const end = around(shape(), 100, 100 * 150, 800, 2)
    expect(end.last).toBe(100)
  })

  it('goes by the heights it has seen, and guesses the rest', () => {
    const measured = shape({ rows: [300, 300] })
    // Two rows of 300, then rows at the typical 150: row 4 begins at 900.
    expect(around(measured, 300, 900, 100, 0)).toEqual({ first: 12, last: 15 })
  })
})

describe('covers', () => {
  it('needs nothing new while what is drawn takes in what is needed', () => {
    expect(covers({ first: 0, last: 60 }, { first: 0, last: 42 }, 3, 3000)).toBe(true)
    expect(covers({ first: 30, last: 60 }, { first: 0, last: 42 }, 3, 3000)).toBe(false)
    expect(covers({ first: 0, last: 60 }, { first: 0, last: 90 }, 3, 3000)).toBe(false)
  })

  it('wants drawing again when the columns no longer line up with it', () => {
    expect(covers({ first: 30, last: 60 }, { first: 30, last: 42 }, 4, 3000)).toBe(false)
  })

  it('takes the list ending part-way through a row', () => {
    expect(covers({ first: 0, last: 60 }, { first: 0, last: 50 }, 3, 50)).toBe(true)
  })
})

describe('runsOf', () => {
  it('adds the rows of the cards it’s asked to keep, on their own or joined to the window', () => {
    expect(runsOf({ first: 30, last: 60 }, [], 3, 3000)).toEqual([[30, 60]])
    expect(runsOf({ first: 30, last: 60 }, [4], 3, 3000)).toEqual([[3, 6], [30, 60]])
    expect(runsOf({ first: 30, last: 60 }, [61], 3, 3000)).toEqual([[30, 63]])
  })

  it('stays inside the list', () => {
    expect(runsOf({ first: 0, last: 60 }, [], 3, 10)).toEqual([[0, 10]])
    expect(runsOf({ first: 0, last: 3 }, [9], 3, 10)).toEqual([[0, 3], [9, 10]])
  })
})

describe('span', () => {
  it('adds rows, each with the gap after it', () => {
    expect(span(shape({ rows: [200, undefined as never, 100] }), 0, 3)).toBe(450)
  })
})
