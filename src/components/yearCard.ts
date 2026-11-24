import { localDay } from '../lib/time'
import { hourOf, type Summary } from '../lib/writingStats'
import { BODY } from './NibMark'

/**
 * The year's card (Phase 13): the year's writing on this device as a picture
 * to save or share, free, in December. In the writer's own theme's colours.
 * "Your year in writing" when the calendar holds the whole year, which it
 * shows by holding days from the year before; till then, as in 2026, the
 * calendar's first year, "Your writing so far".
 */

const [WIDTH, HEIGHT, MARGIN] = [1080, 1350, 96]
const SANS = '"Inter Variable", system-ui, sans-serif'
const SERIF = '"Literata Variable", Georgia, serif'

export const cardTitle = (calendar: Record<string, number>, year: string) =>
  Object.keys(calendar).some((day) => day < `${year}-01-01`) ? 'Your year in writing' : 'Your writing so far'

const shortDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export type Card = { png: Blob; src: string; title: string; alt: string }

/** The card, as a PNG and as a data URL to show it by. */
export async function drawCard(sums: Summary, calendar: Record<string, number>, now: number): Promise<Card> {
  const title = cardTitle(calendar, sums.year)
  const whole = title === 'Your year in writing'
  await Promise.all([`600 80px ${SERIF}`, `500 40px ${SANS}`, `600 40px ${SANS}`].map((font) => document.fonts.load(font)))

  const style = getComputedStyle(document.documentElement)
  const [paper, ink, muted, accent] = ['paper', 'ink', 'muted', 'accent'].map((name) => style.getPropertyValue(`--color-${name}`).trim())
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const context = canvas.getContext('2d')!
  context.fillStyle = paper
  context.fillRect(0, 0, WIDTH, HEIGHT)

  /** Text at a baseline, made smaller to fit `room`, down to `least`, and cut short with an ellipsis if even that won't do. */
  function write(value: string, x: number, y: number, weight: number, size: number, family: string, colour: string, room = WIDTH - 2 * MARGIN, least = 28) {
    let text = value
    do context.font = `${weight} ${size}px ${family}`
    while (context.measureText(text).width > room && (size -= 2) >= least)
    while (context.measureText(text).width > room && text.length > 1) text = `${text.slice(0, -2).trimEnd()}…`
    context.fillStyle = colour
    context.fillText(text, x, y)
  }

  write(sums.year, MARGIN, 140, 500, 36, SANS, muted)
  write(title, MARGIN, 240, 600, 80, SERIF, ink)
  write(sums.total.toLocaleString(), MARGIN, 440, 600, 180, SERIF, accent)
  write(sums.total === 1 ? 'word' : 'words', MARGIN, 500, 500, 40, SANS, muted)

  // Every day from the first week with words (the year's first, for a whole year), a week to a column, Sunday at the top.
  const date = new Date(`${whole ? `${sums.year}-01` : sums.since!.slice(0, 7)}-01T12:00:00`)
  date.setDate(date.getDate() - date.getDay())
  const today = localDay(now)
  const days: number[] = []
  for (; localDay(date.getTime()) <= today; date.setDate(date.getDate() + 1)) days.push(calendar[localDay(date.getTime())] ?? 0)
  const weeks = Math.ceil(days.length / 7)
  const cell = Math.min(20, (WIDTH - 2 * MARGIN) / (weeks * 1.2 - 0.2))
  const most = Math.max(1, ...days)
  context.fillStyle = accent
  for (const [i, words] of days.entries()) {
    // Shaded against the best day, as the Goals calendar is.
    context.globalAlpha = words ? 0.25 + (0.75 * words) / most : 0.07
    context.fillRect(MARGIN + Math.floor(i / 7) * cell * 1.2, 560 + (i % 7) * cell * 1.2, cell, cell)
  }
  context.globalAlpha = 1
  const below = 560 + 7 * cell * 1.2 + 40
  if (!whole) write(`Counted since ${shortDay(sums.since!)}`, MARGIN, below, 500, 30, SANS, muted)

  // Two to a row: what each figure is under it.
  const figures: [string, string][] = [
    [sums.days.toLocaleString(), sums.days === 1 ? 'writing day' : 'writing days'],
    [`${sums.longestRun.toLocaleString()} ${sums.longestRun === 1 ? 'day' : 'days'}`, 'longest run'],
  ]
  if (sums.best) figures.push([sums.best.words.toLocaleString(), `best day, ${shortDay(sums.best.day)}`])
  if (sums.busiestHour !== undefined) figures.push([hourOf(sums.busiestHour), 'busiest hour'])
  let top = below + 45
  for (const [i, [value, name]] of figures.entries()) {
    const x = MARGIN + (i % 2) * 444
    write(value, x, top + 50, 600, 54, SERIF, ink, 420)
    write(name, x, top + 92, 500, 30, SANS, muted, 420)
    if (i % 2 === 1 || i === figures.length - 1) top += 120
  }
  const book = sums.books[0]?.name
  if (book) {
    write('Most words went into', MARGIN, top + 30, 500, 30, SANS, muted)
    write(book, MARGIN, top + 85, 600, 48, SERIF, ink, undefined, 40)
  }

  // Nib's mark and name at the foot, and where to find it.
  const scale = 48 / 103.4
  context.save()
  context.translate(MARGIN, HEIGHT - 88 - 48)
  context.scale(scale, scale)
  context.fillStyle = ink
  context.fill(new Path2D(BODY))
  context.fillRect(10.5, 90.1, 42.9, 13.3)
  context.restore()
  write('Written in Nib', MARGIN + 44, HEIGHT - 98, 600, 32, SANS, ink)
  context.textAlign = 'right'
  write('nibprivacy.com', WIDTH - MARGIN, HEIGHT - 98, 500, 30, SANS, muted)

  // Encoded once: toBlob took a second where toDataURL took a few milliseconds.
  const src = canvas.toDataURL('image/png')
  const png = new Blob([Uint8Array.from(atob(src.slice(src.indexOf(',') + 1)), (char) => char.charCodeAt(0))], { type: 'image/png' })
  const alt = `${title}, ${sums.year}: ${sums.total.toLocaleString()} words on ${figures[0][0]} ${figures[0][1]}${book ? `; the most went into ${book}` : ''}.`
  return { png, src, title, alt }
}
