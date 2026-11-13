import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { Item, Placed } from '../db/db'
import { whatIs } from '../lib/placed'
import { drawn } from '../lib/rewards'
import { StampArt } from './StampArt'

/** Stamps across the cover, at most, before the next row. */
const ACROSS = 4
const [WIDTH, HEIGHT, GAP] = [110, 132, 24]
/** Each a little askew, as pressed on by hand. */
const TURNS = [-6, 3, 8, -3, 5, -8]

/**
 * A compiled manuscript's cover (lib/manuscript, lib/placed): its title, and
 * the stamps its chapters wear, as a chapter before the first. Word, PDF and
 * EPUB each take it as they take any page, the stamps as one picture. None
 * without stamps.
 */
export async function coverOf(title: string, stamps: Placed[]): Promise<Item | null> {
  if (stamps.length === 0) return null
  const names = stamps.map((placed) => {
    const what = whatIs(placed)
    return 'entry' in what ? what.entry.name : what.holiday.name
  })
  return {
    id: 'cover',
    kind: 'page',
    version: 0,
    createdAt: 0,
    updatedAt: 0,
    body: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: title }] },
        { type: 'paragraph', content: [{ type: 'image', attrs: { src: await picture(stamps), alt: `Stamps: ${names.join(', ')}` } }] },
      ],
    },
  }
}

/** The stamps in rows, drawn into one PNG at twice their size. */
async function picture(stamps: Placed[]): Promise<string> {
  // Drawn off the page, in a palette of their own, then each read back as an SVG file.
  const host = document.createElement('div')
  const root = createRoot(host)
  flushSync(() =>
    root.render(
      <>
        {stamps.map((placed) => (
          <StampArt key={placed.no ?? placed.day} stamp={drawn(placed)} width={WIDTH} print />
        ))}
      </>,
    ),
  )
  // Each stamp's own svg, not the one within it that holds a sunburst.
  const files = [...host.querySelectorAll(':scope > svg')].map((svg) => new XMLSerializer().serializeToString(svg))
  root.unmount()

  const across = Math.min(ACROSS, stamps.length)
  const down = Math.ceil(stamps.length / ACROSS)
  const canvas = document.createElement('canvas')
  canvas.width = (across * (WIDTH + GAP) + GAP) * 2
  canvas.height = (down * (HEIGHT + GAP) + GAP) * 2
  const context = canvas.getContext('2d')!
  context.scale(2, 2)
  for (const [i, file] of files.entries()) {
    const image = new Image()
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(file)}`
    await image.decode()
    context.save()
    context.translate(GAP + (i % ACROSS) * (WIDTH + GAP) + WIDTH / 2, GAP + Math.floor(i / ACROSS) * (HEIGHT + GAP) + HEIGHT / 2)
    context.rotate((TURNS[i % TURNS.length] * Math.PI) / 180)
    context.drawImage(image, -WIDTH / 2, -HEIGHT / 2, WIDTH, HEIGHT)
    context.restore()
  }
  return canvas.toDataURL('image/png')
}
