import { touchApp } from './platform'

/**
 * Whether Nib may bring something up of its own accord (lib/useUnprompted, and
 * the Plus offer, lib/upsell): only at a pause. Nothing typed into the writing
 * or a field for a minute, Nib on the screen, and no other dialog up; and on
 * iPhone and iPad not with the caret in the text, as the keyboard is up then
 * and a card would come up behind it. And no third card in a row (ROW_MS).
 */

/** A typed key within this long means someone is writing, not to be interrupted. */
export const IDLE_MS = 60 * 1000

/** Two cards unasked in this long at most: the day's coins and its pack are the one arrival, and a third would be one too many. */
export const ROW_MS = 10 * 60 * 1000

let typedAt = 0
/** When the last two came up unasked. */
let cards: number[] = []
const watchers = new Set<object>()

function onKey(event: KeyboardEvent) {
  const target = event.target
  if (target instanceof HTMLElement && (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) typedAt = Date.now()
}

/** Minds the keys until the function it returns is called. The first to ask starts the clock afresh, as Nib opens. */
export function watchTyping(): () => void {
  const watcher = {}
  if (watchers.size === 0) {
    typedAt = 0
    cards = []
    window.addEventListener('keydown', onKey, true)
  }
  watchers.add(watcher)
  return () => {
    watchers.delete(watcher)
    if (watchers.size === 0) window.removeEventListener('keydown', onKey, true)
  }
}

/** A draft opened to be typed in, as good as a key: or the first thing to come up lands before the first word. */
export function aboutToType() {
  typedAt = Date.now()
}

/** Something has come up without being asked for. */
export function cardCame() {
  cards = [...cards, Date.now()].slice(-2)
}

/** Two have come up unasked, the first of them not long ago. */
export const twoInARow = () => cards.length === 2 && Date.now() - cards[0] < ROW_MS

export const caretInText = () => document.activeElement?.closest('.ProseMirror') != null

/** A sheet is up (components/Sheet). Commands and the Mac's menu wait for it: under it they'd take the keyboard, unseen. */
export const sheetUp = () => document.querySelector('[aria-modal="true"]') !== null

/**
 * A card over the writing that isn't a sheet: a note to self open to read
 * (editor/NoteCard), or First steps' list (components/FirstSteps). Commands and
 * the Mac's menu don't wait for one; what comes up of its own accord does.
 */
const cardUp = () => document.querySelector('[role="dialog"]:not([aria-modal])') !== null

/** `arrival`: for the pack that follows the day's coins, the one arrival with them, whatever came up before those. */
export function quiet(arrival = false): boolean {
  if (document.visibilityState !== 'visible' || Date.now() - typedAt < IDLE_MS || (!arrival && twoInARow())) return false
  if (sheetUp() || cardUp()) return false
  return !(touchApp && caretInText())
}
