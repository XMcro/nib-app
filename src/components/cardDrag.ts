import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { Item } from '../db/db'
import { motion } from '../lib/motion'

/**
 * A card picked up in the library and dropped on its row of folders and
 * categories (Places' PlaceChips, whose chips carry `data-drop`). A mouse
 * picks one up by moving it; a finger by resting on it first, so a swipe
 * still scrolls the list. Let go, the held copy flies into the chip it was
 * dropped on, or back to its card when it was dropped on nothing.
 */

/** A chip's `data-drop`: `folder:<name>`, `category:<name>`, `new` for "+ New folder", or `archive`. */
export type Drop = { folder: string } | { category: string } | 'new' | 'archive'

export type Held = {
  item: Item
  title: string
  x: number
  y: number
  touch: boolean
  /** The `data-drop` of the chip under it. */
  over: string | null
  /** Let go: where it's flying, and whether into a chip or back to its card. */
  landing?: { x: number; y: number; into: boolean }
}

// A mouse moves this far (px) before a press is a drag. A finger rests this
// long (ms), straying no further than SLOP, before a card lifts. A folder's
// chip lifts the same way (chipDrag).
export const MOVE = 6
export const HOLD = 400
export const SLOP = 8
/** The flight once let go, at Motion's Full. */
export const LANDING_MS = 320

const chipAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop]') ?? null

function asDrop(raw: string): Drop {
  if (raw === 'new' || raw === 'archive') return raw
  const colon = raw.indexOf(':')
  const name = raw.slice(colon + 1)
  return raw.slice(0, colon) === 'folder' ? { folder: name } : { category: name }
}

const middle = (box: DOMRect) => ({ x: box.left + box.width / 2, y: box.top + box.height / 2 })

/** Where the held copy is drawn: above a finger, which would hide it, beside a pointer, and once let go, centred where it's flying. */
export function heldAt(held: Held): CSSProperties {
  if (held.landing) return { left: held.landing.x, top: held.landing.y, transform: `translate(-50%, -50%) scale(${held.landing.into ? 0.15 : 0.9})` }
  return held.touch ? { left: held.x - 60, top: held.y - 72 } : { left: held.x + 14, top: held.y + 14 }
}

export function useCardDrag(onDrop: (item: Item, drop: Drop, chip: string) => void) {
  const [held, setHeld] = useState<Held | null>(null)
  // The held copy, moved by hand between one chip and the next: as state, every move of the pointer drew the whole library again.
  const copy = useRef<HTMLDivElement>(null)
  const droppedAt = useRef(0)

  function press(event: ReactPointerEvent<HTMLElement>, item: Item, title: string) {
    if (event.button !== 0) return
    const touch = event.pointerType !== 'mouse'
    const card = event.currentTarget
    const from = { x: event.clientX, y: event.clientY }
    let at = from
    let lifted = false
    let last: Held | null = null
    const strayed = (x: number, y: number, by: number) => Math.hypot(x - from.x, y - from.y) > by
    const move = (x: number, y: number) => {
      at = { x, y }
      if (!lifted) return
      const over = chipAt(x, y)?.dataset.drop ?? null
      const sameChip = last !== null && last.over === over
      last = { item, title, x, y, touch, over }
      if (!sameChip || !copy.current) return setHeld(last)
      const { left, top } = heldAt(last)
      copy.current.style.left = `${left}px`
      copy.current.style.top = `${top}px`
    }
    const timer = touch ? window.setTimeout(() => ((lifted = true), move(at.x, at.y)), HOLD) : undefined

    const onPointerMove = (moved: PointerEvent) => {
      if (!lifted && strayed(moved.clientX, moved.clientY, MOVE)) lifted = true
      move(moved.clientX, moved.clientY)
    }
    // Once a card is up, the finger's moves are the card's, not the page's to scroll.
    const onTouchMove = (moved: TouchEvent) => {
      const point = moved.touches[0]
      if (!lifted) return void (strayed(point.clientX, point.clientY, SLOP) && end(false))
      moved.preventDefault()
      move(point.clientX, point.clientY)
    }
    const onEnd = () => end(true)
    const onCancel = () => end(false)

    function end(drop: boolean) {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onCancel)
      if (!lifted || !last) return
      droppedAt.current = Date.now()
      const chip = drop ? chipAt(at.x, at.y) : null
      const target = chip?.dataset.drop
      const ms = LANDING_MS * motion()
      const done = () => {
        setHeld(null)
        if (target) onDrop(item, asDrop(target), target)
      }
      if (!ms) return done()
      setHeld({ ...last, landing: { ...middle((chip ?? card).getBoundingClientRect()), into: Boolean(chip) } })
      window.setTimeout(done, ms)
    }

    if (touch) {
      window.addEventListener('touchmove', onTouchMove, { passive: false })
      window.addEventListener('touchend', onEnd)
      window.addEventListener('touchcancel', onCancel)
    } else {
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onEnd)
      window.addEventListener('pointercancel', onCancel)
    }
  }

  return {
    held,
    copy,
    press,
    /** A card let go where it was picked up ends in a click, which mustn't also open it. */
    justDropped: () => Date.now() - droppedAt.current < 300,
  }
}
