/**
 * Which of a long library's cards are in the page (Library's CardGrid): those
 * in the window and a few windows' worth either side, and the rest a stretch of
 * empty grid, as tall as they'd be. Thousands of cards took seconds to draw
 * each time the library came back. Cards are in whole rows, so the grid's
 * columns still line up; what isn't drawn yet is guessed at the height the last
 * rows drawn had, and each row's own height kept once it's been seen, so
 * scrolling back doesn't shift a thing.
 */

/** A row of the grid, as measured. */
export type GridShape = {
  columns: number
  /** Between rows (px). */
  gap: number
  /** Each row's height and the gap after it, of those drawn so far. */
  rows: number[]
  /** A row that hasn't been drawn yet. */
  typical: number
  measured: boolean
}

/** Drawn before anything can be measured: more than a window holds, in whole rows of one, two or three. */
export const FIRST_DRAWN = 60

export const newShape = (): GridShape => ({ columns: 1, gap: 0, rows: [], typical: 148, measured: false })

const heightOf = (shape: GridShape, row: number) => shape.rows[row] || shape.typical

/** How much of the grid rows `from` to `to` take up, each with the gap after it. */
export function span(shape: GridShape, from: number, to: number): number {
  let total = 0
  for (let row = from; row < to; row++) total += heightOf(shape, row)
  return total
}

export type Drawn = { first: number; last: number }

/** The cards within `windows` windows either way of one `height` tall scrolled to `top`, from the top of the grid. */
export function around(shape: GridShape, count: number, top: number, height: number, windows: number): Drawn {
  const rows = Math.ceil(count / shape.columns)
  const from = top - height * windows
  const to = top + height * (1 + windows)
  let row = 0
  let y = 0
  while (row < rows && y + heightOf(shape, row) <= from) y += heightOf(shape, row++)
  const first = row
  while (row < rows && y < to) y += heightOf(shape, row++)
  return { first: first * shape.columns, last: Math.min(count, row * shape.columns) }
}

/** What's drawn already takes in what's needed, and in whole rows of the columns there are now. */
export function covers(drawn: Drawn, need: Drawn, columns: number, count: number): boolean {
  const last = Math.min(drawn.last, count)
  return drawn.first <= need.first && last >= need.last && drawn.first % columns === 0 && (last % columns === 0 || last === count)
}

/** `drawn`, and the rows the cards at `also` are in, as runs of cards, in order and not overlapping. */
export function runsOf(drawn: Drawn, also: number[], columns: number, count: number): [number, number][] {
  const runs: [number, number][] = [[Math.min(drawn.first, count), Math.min(drawn.last, count)]]
  for (const index of also) {
    const first = index - (index % columns)
    runs.push([first, Math.min(first + columns, count)])
  }
  runs.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const run of runs) {
    const last = merged.at(-1)
    if (last && run[0] <= last[1]) last[1] = Math.max(last[1], run[1])
    else if (run[1] > run[0]) merged.push(run)
  }
  return merged
}

/**
 * The columns and the rows drawn, read from the page: `cards` in the page's
 * order, `order` each one's place in the list. Whether the empty stretches need
 * drawing again for it.
 */
export function measure(shape: GridShape, grid: HTMLElement, cards: HTMLElement[], order: number[]): boolean {
  const style = getComputedStyle(grid)
  const columns = style.gridTemplateColumns.split(' ').length
  const gap = parseFloat(style.rowGap) || 0
  const changed = !shape.measured || columns !== shape.columns
  if (columns !== shape.columns) shape.rows = []
  shape.columns = columns
  shape.gap = gap
  const tops = new Map<number, { top: number; height: number }>()
  cards.forEach((card, at) => {
    const row = Math.floor(order[at] / columns)
    if (!tops.has(row)) tops.set(row, { top: card.offsetTop, height: card.offsetHeight })
  })
  let total = 0
  for (const [row, { top, height }] of tops) {
    const pitch = (tops.get(row + 1)?.top ?? top + height + gap) - top
    shape.rows[row] = pitch
    total += pitch
  }
  if (total > 0) {
    shape.typical = total / tops.size
    shape.measured = true
  }
  return changed && total > 0
}
