import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { arrange } from '../lib/folderSettings'
import { sameName } from '../lib/folders'
import { HOLD, MOVE, SLOP } from './cardDrag'

/**
 * A folder's chip moved along its row (Places' PlaceChips) to put the folders
 * in an order of one's own (lib/folderSettings), among those beside it: the
 * folders at the top, or those inside the one that's open. Picked up as a
 * card is (cardDrag): a mouse by moving it, a finger by resting on it first,
 * so a swipe still scrolls. Held, it takes its place among the others as it
 * goes, and let go, they're kept in that order.
 */
export type Moving = { name: string; order: string[] }

/**
 * `order` with `name` where (x, y) is among the others, by their chips in
 * `row` as they're laid out now: after each whose middle it's past, reading
 * along the rows, and before the rest.
 */
function placed(row: HTMLElement, name: string, order: string[], x: number, y: number): string[] {
  const chips = new Map([...row.querySelectorAll<HTMLElement>('[data-drop^="folder:"]')].map((chip) => [chip.dataset.drop!.slice('folder:'.length).toLocaleLowerCase(), chip]))
  const others = order.filter((one) => !sameName(one, name))
  const before = others.filter((one) => {
    const box = chips.get(one.toLocaleLowerCase())?.getBoundingClientRect()
    return box !== undefined && (y > box.bottom || (y >= box.top && x > box.left + box.width / 2))
  }).length
  return [...others.slice(0, before), order.find((one) => sameName(one, name))!, ...others.slice(before)]
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((name, index) => name === b[index])

export function useChipDrag() {
  const [moving, setMoving] = useState<Moving | null>(null)
  // The one just let go in a new place, a moment, to settle as a folder does a card dropped in it.
  const [settled, setSettled] = useState<string | null>(null)
  const movedAt = useRef(0)

  /** `beside`: the folders side by side with `name`, in their order now. */
  function press(event: ReactPointerEvent<HTMLElement>, name: string, beside: string[]) {
    if (event.button !== 0 || beside.length < 2) return
    const touch = event.pointerType !== 'mouse'
    const row = event.currentTarget.parentElement!
    const from = { x: event.clientX, y: event.clientY }
    let at = from
    let lifted = false
    let order = beside
    const strayed = (x: number, y: number, by: number) => Math.hypot(x - from.x, y - from.y) > by
    const move = (x: number, y: number) => {
      at = { x, y }
      if (!lifted) return
      const next = placed(row, name, order, x, y)
      if (same(next, order)) return
      order = next
      setMoving({ name, order })
    }
    const lift = () => {
      lifted = true
      setMoving({ name, order })
      move(at.x, at.y)
    }
    const timer = touch ? window.setTimeout(lift, HOLD) : undefined

    const onPointerMove = (moved: PointerEvent) => {
      if (!lifted && strayed(moved.clientX, moved.clientY, MOVE)) lift()
      move(moved.clientX, moved.clientY)
    }
    // Once a chip is up, the finger's moves are the chip's, not the page's to scroll.
    const onTouchMove = (moved: TouchEvent) => {
      const point = moved.touches[0]
      if (!lifted) return void (strayed(point.clientX, point.clientY, SLOP) && end(false))
      moved.preventDefault()
      move(point.clientX, point.clientY)
    }
    const onEnd = () => end(true)
    const onCancel = () => end(false)

    function end(keep: boolean) {
      window.clearTimeout(timer)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onEnd)
      window.removeEventListener('touchcancel', onCancel)
      if (!lifted) return
      movedAt.current = Date.now()
      setMoving(null)
      if (keep && !same(order, beside)) {
        arrange(order)
        setSettled(name)
        window.setTimeout(() => setSettled((now) => (now === name ? null : now)), 600)
      }
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
    moving,
    settled,
    press,
    /** A chip let go ends in a click, which mustn't also show its folder. */
    justMoved: () => Date.now() - movedAt.current < 300,
  }
}
