// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * React's scheduler runs every update that isn't a direct answer to a click or a key (one made after an await, a
 * timer, a live query) through a MessageChannel it makes once, as it loads, unless the page has a setImmediate. In
 * WebKit a channel goes through its network process: once that process has ended under a page left alone (the Mac
 * on 18 November, overnight), a channel made before stops delivering, and those updates never came. New note's
 * sheet went, the library stayed over the new note.
 */

type Immediate = { setImmediate?: unknown; clearImmediate?: unknown; MessageChannel: typeof MessageChannel }
const page = globalThis as unknown as Immediate
const nodes = { setImmediate: page.setImmediate, clearImmediate: page.clearImmediate }
const channel = page.MessageChannel

/** A MessageChannel as WebKit's is after its network process has gone: what's posted never arrives. */
class DeadChannel {
  port1 = { onmessage: null as unknown, postMessage() {}, close() {} }
  port2 = { onmessage: null as unknown, postMessage() {}, close() {} }
}

beforeEach(() => {
  // A page has none; jsdom runs on Node, which has its own.
  delete page.setImmediate
  delete page.clearImmediate
  vi.resetModules()
})
afterEach(() => {
  page.setImmediate = nodes.setImmediate
  page.clearImmediate = nodes.clearImmediate
  page.MessageChannel = channel
})

const later = () => new Promise((resolve) => setTimeout(resolve, 50))

describe('the page’s setImmediate', () => {
  it('lets React’s scheduler run its work when the page’s message channels have stopped delivering', async () => {
    page.MessageChannel = DeadChannel as unknown as typeof MessageChannel
    await import('./immediate')
    // @ts-expect-error React's scheduler ships no types.
    const scheduler = (await import('scheduler')) as unknown as { unstable_scheduleCallback: (priority: number, run: () => void) => void; unstable_NormalPriority: number }
    let ran = false
    scheduler.unstable_scheduleCallback(scheduler.unstable_NormalPriority, () => void (ran = true))
    await later()
    expect(ran).toBe(true)
  })

  it('runs each later, in order, with what it was given; and not one cleared', async () => {
    await import('./immediate')
    const set = page.setImmediate as (run: (...args: unknown[]) => void, ...args: unknown[]) => number
    const clear = page.clearImmediate as (id: number) => void
    const ran: unknown[] = []
    set((a, b) => ran.push([a, b]), 1, 2)
    const cleared = set(() => ran.push('cleared'))
    set(() => ran.push('last'))
    clear(cleared)
    expect(ran).toEqual([])
    await later()
    expect(ran).toEqual([[1, 2], 'last'])
  })

  it('leaves a page’s own messages to their listeners, and runs nothing for them', async () => {
    await import('./immediate')
    const heard: unknown[] = []
    window.addEventListener('message', (event) => heard.push(event.data))
    window.postMessage('nib-immediate-1', '*')
    window.postMessage({ any: 'thing' }, '*')
    await later()
    expect(heard).toEqual(['nib-immediate-1', { any: 'thing' }])
  })

  it('leaves a setImmediate the page already has', async () => {
    const own = () => 0
    page.setImmediate = own
    await import('./immediate')
    expect(page.setImmediate).toBe(own)
  })
})
