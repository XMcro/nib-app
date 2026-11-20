/**
 * A setImmediate for the page, before React's scheduler loads, so the
 * scheduler runs its work through it and not through a MessageChannel.
 *
 * React runs every update that isn't a direct answer to a click or a key (one
 * made after an await, a timer, a live query) through a MessageChannel it makes
 * once, as it loads, unless the page has a setImmediate. In WebKit a channel
 * goes through the network process, and once that process has ended under a
 * page left alone for hours (as it did on the Mac on 18 November), a channel
 * made before then stops delivering. Those updates never came, or came only
 * with the next click once they were overdue: New note's sheet went and left
 * the library over the new note. A message the page posts to itself stays in
 * the page, and was delivered all the same.
 *
 * Imported first in main.tsx, ahead of React.
 */
const page = globalThis as unknown as { setImmediate?: unknown; clearImmediate?: unknown }

if (typeof page.setImmediate !== 'function' && typeof window !== 'undefined') {
  const key = `nib-immediate-${Math.random().toString(36).slice(2)}-`
  const waiting = new Map<number, () => void>()
  let last = 0
  window.addEventListener('message', (event) => {
    if (typeof event.data !== 'string' || !event.data.startsWith(key)) return
    event.stopImmediatePropagation()
    const id = Number(event.data.slice(key.length))
    const run = waiting.get(id)
    waiting.delete(id)
    run?.()
  })
  page.setImmediate = (run: (...args: unknown[]) => void, ...args: unknown[]) => {
    const id = ++last
    waiting.set(id, () => run(...args))
    window.postMessage(key + id, '*')
    return id
  }
  page.clearImmediate = (id: number) => void waiting.delete(id)
}

export {}
