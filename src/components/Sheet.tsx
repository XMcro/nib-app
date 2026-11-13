import { useEffect, useRef, type ComponentProps, type KeyboardEvent, type MouseEvent, type RefObject } from 'react'
import { touchApp } from '../lib/platform'

type Focusable = RefObject<HTMLElement | null>

/**
 * Focus comes here once whatever opened this has let go of it: Commands hands
 * it back to the writing as it closes (effects clean up before they run, and
 * this is why nothing under a sheet is `autoFocus`), and typing would go
 * there, behind this. It goes back on closing, or everything typed afterwards
 * goes to document.body and is silently dropped. Refocusing a detached node
 * is a no-op, so commands that do remount the editor still let it claim focus
 * itself. Not back if it has gone somewhere of its own since, as a stamp's
 * page hands it back to the stamp.
 *
 * Not on iPhone and iPad: handing focus back there raises the keyboard the
 * writer did not ask for. They tap in to type. `onTouch`: a sheet the writer
 * has just opened still takes it there, on itself or a button, which raises
 * nothing and lets a keyboard that's up go down, or on the field it opened to
 * have typed into. And one that comes up unasked, as the coins do, takes it on
 * itself: no field has it then (lib/quiet), and it's how VoiceOver learns the
 * card is there.
 *
 * Up, it holds what's under it out of reach (holdUnder), once it has the focus
 * and let go only as that goes back, which an inert page wouldn't take.
 */
function useFocusBack(sheet: Focusable, target: Focusable | null, onTouch: boolean) {
  useEffect(() => {
    if (touchApp) {
      if (onTouch) target?.current?.focus()
      return holdUnder(sheet)
    }
    const before = document.activeElement
    target?.current?.focus()
    const letGo = holdUnder(sheet)
    return () => {
      letGo()
      const lost = !document.activeElement || document.activeElement === document.body
      if (lost && before instanceof HTMLElement) before.focus()
    }
  }, [sheet, target, onTouch])
}

const inField = (element: Element | null) => element instanceof HTMLElement && (element.isContentEditable || element.matches('input, textarea, select'))

/** The sheets up now, the newest last: what's under them comes back with the last to go. */
const up: Focusable[] = []

/**
 * The library and the writing (App's [data-under-sheets]) out of reach of Tab
 * and VoiceOver while a sheet is over them. Not with a field in them holding
 * the iPhone or iPad keyboard, as inert would take its focus and drop it.
 */
function holdUnder(sheet: Focusable) {
  const under = document.querySelector('[data-under-sheets]')
  up.push(sheet)
  if (!(touchApp && under?.contains(document.activeElement) && inField(document.activeElement))) under?.setAttribute('inert', '')
  return () => {
    up.splice(up.indexOf(sheet), 1)
    if (up.length === 0) under?.removeAttribute('inert')
  }
}

/**
 * Tab goes round inside a sheet, from control to control. Left to itself it
 * walks out to the browser or the body, and WebKit's skips buttons, which on a
 * sheet of them is at once.
 */
function keepTabIn(event: Pick<KeyboardEvent, 'shiftKey' | 'preventDefault'>, sheet: HTMLElement) {
  const stops = [...sheet.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex="0"]')].filter((stop) => stop.tabIndex >= 0 && !stop.matches(':disabled') && !stop.closest('[inert]') && stop.getClientRects().length > 0)
  event.preventDefault()
  const at = stops.indexOf(document.activeElement as HTMLElement)
  stops[event.shiftKey ? (at <= 0 ? stops.length - 1 : at - 1) : (at + 1) % stops.length]?.focus()
}

/**
 * What every sheet over the page is: an overlay, pressed to close, holding a
 * modal dialog that closes with Escape and takes the keyboard (useFocusBack).
 * `top` and `z` place the usual card, under a light tint; `overlay` is for a
 * sheet of another kind, centred or on a darker one, in place of all that.
 */
export function Sheet({
  label,
  onClose,
  top = 'pt-[18vh]',
  z = 'z-50',
  // It scrolls: a phone on its side is shorter than most cards.
  overlay = `flex justify-center overflow-y-auto overscroll-contain bg-ink/10 pb-[max(1rem,env(safe-area-inset-bottom))] ${z} ${top}`,
  focus,
  focusOnTouch = false,
  pressOutside = true,
  ref,
  className = '',
  onKeyDown,
  children,
  ...dialog
}: {
  label?: string
  onClose: () => void
  top?: string
  z?: string
  overlay?: string
  /** What takes the focus: the sheet itself unless said, and null for nothing. */
  focus?: Focusable | null
  focusOnTouch?: boolean
  /** Whether pressing outside it closes it. */
  pressOutside?: boolean
  ref?: RefObject<HTMLDivElement | null>
} & Omit<ComponentProps<'div'>, 'ref'>) {
  const own = useRef<HTMLDivElement>(null)
  const sheet = ref ?? own
  // Escape and Tab with the focus nowhere, as when the button pressed has gone with what Settings was showing: they reach no sheet by themselves.
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const lostKey = (event: globalThis.KeyboardEvent) => {
      if (document.activeElement !== document.body || up.at(-1) !== sheet || !sheet.current) return
      if (event.key === 'Escape') close.current()
      else if (event.key === 'Tab') keepTabIn(event, sheet.current)
    }
    window.addEventListener('keydown', lostKey)
    return () => window.removeEventListener('keydown', lostKey)
  }, [sheet])
  useFocusBack(sheet, focus === undefined ? sheet : focus, focusOnTouch)
  // The press's own default would clear the focus just handed back.
  const pressed = (event: MouseEvent) => {
    event.preventDefault()
    onClose()
  }
  return (
    <div className={`nib-overlay fixed inset-0 ${overlay}`} onMouseDown={pressOutside ? pressed : undefined}>
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
          if (event.key === 'Tab') keepTabIn(event, event.currentTarget)
          onKeyDown?.(event)
        }}
        className={`outline-none ${className}`}
        {...dialog}
      >
        {children}
      </div>
    </div>
  )
}
