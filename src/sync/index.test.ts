// @vitest-environment jsdom
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncOnce } from './engine'
import { Session } from './session'
import { LOOKS_CHANGED } from '../lib/look'

vi.mock('./engine', () => ({ syncOnce: vi.fn(), expireHistory: vi.fn(async () => {}), resetSyncState: vi.fn(), SyncReset: class SyncReset extends Error {} }))

const nothing = { changed: [], full: false, tooLarge: 0, copies: 0, moved: new Map(), clean: false }

describe('sync while the app is open', () => {
  let passes: number[]
  let session: Session

  beforeEach(() => {
    vi.useFakeTimers()
    const start = Date.now()
    passes = []
    vi.mocked(syncOnce).mockImplementation(async () => {
      passes.push((Date.now() - start) / 1000)
      return nothing
    })
    session = new Session({} as never, { onStatus: () => {}, onApplied: () => {}, receipt: () => undefined, manual: () => false })
    session.start()
  })

  afterEach(() => {
    session.stop()
    vi.mocked(syncOnce).mockReset()
    vi.useRealTimers()
  })

  // An open window, a Mac's all day, asked the server every 30 s for nothing.
  it('looks less often while nothing changes, till it’s every five minutes', async () => {
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(passes).toEqual([0, 30, 90, 210, 450, 750, 1050])
  })

  const written = () => Dexie.on.storagemutated.fire({ 'idb://nib/items/': true } as never)
  const shown = (visibility: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { value: visibility, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }
  afterEach(() => shown('visible'))

  // A device sent a couple of seconds after each pause in the writing, so the
  // server could follow its rhythm. Now a minute apart at the closest.
  it('sends what’s written here no sooner than a minute after the last look', async () => {
    await vi.advanceTimersByTimeAsync(450_000)
    expect(passes.at(-1)).toBe(450)
    for (let second = 0; second < 200; second += 7) {
      written()
      await vi.advanceTimersByTimeAsync(7000)
    }
    const looks = passes.filter((at) => at >= 450)
    expect(looks.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < looks.length; i++) expect(looks[i] - looks[i - 1]).toBeGreaterThanOrEqual(60)
  })

  it('sends at once when Nib is put away, and looks at once when it’s back', async () => {
    await vi.advanceTimersByTimeAsync(450_000)
    await vi.advanceTimersByTimeAsync(5000)
    written()
    shown('hidden')
    await vi.advanceTimersByTimeAsync(0)
    expect(passes.at(-1)).toBe(455)
    await vi.advanceTimersByTimeAsync(100_000)
    shown('visible')
    await vi.advanceTimersByTimeAsync(0)
    expect(passes.at(-1)).toBe(555)
    // And the poll starts over from there.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(passes.at(-1)).toBe(585)
    const before = passes.length
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(0)
    expect(passes).toHaveLength(before + 1)
  })

  // Changing the code (changeLibrary): no pass meanwhile, and one asked for then runs after.
  // Saved looks aren't in the database, so no write there says they changed: the window's event does (lib/look).
  it('sends at once when a saved look is saved or deleted here', async () => {
    await vi.advanceTimersByTimeAsync(460_000)
    expect(passes.at(-1)).toBe(450)
    window.dispatchEvent(new Event(LOOKS_CHANGED))
    await vi.advanceTimersByTimeAsync(1000)
    expect(passes.at(-1)).toBe(460)
  })

  it('holds off its passes while it’s held', async () => {
    let release!: () => void
    const held = session.hold(() => new Promise<void>((resolve) => (release = resolve)))
    window.dispatchEvent(new Event('focus'))
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(passes).toEqual([0])
    release()
    await held
    expect(passes).toEqual([0, 600])
  })

  it('starts over when another device’s changes arrive', async () => {
    await vi.advanceTimersByTimeAsync(450_000)
    vi.mocked(syncOnce).mockImplementationOnce(async () => {
      passes.push(750)
      return { ...nothing, changed: ['someone else’s edit'] }
    })
    await vi.advanceTimersByTimeAsync(300_000)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(passes.slice(-2)).toEqual([750, 780])
  })
})

// Sync only when I ask (a switch on this device): nothing is sent or fetched until Sync now.
describe('sync only when it’s asked for', () => {
  let passes: number[]
  let said: string[]
  let manual: boolean
  let session: Session
  const written = () => Dexie.on.storagemutated.fire({ 'idb://nib/items/': true } as never)
  const shown = (visibility: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { value: visibility, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  beforeEach(() => {
    vi.useFakeTimers()
    const start = Date.now()
    passes = []
    said = []
    manual = true
    vi.mocked(syncOnce).mockImplementation(async () => {
      passes.push((Date.now() - start) / 1000)
      return nothing
    })
    session = new Session({} as never, { onStatus: (status) => void said.push(status.state + (status.message ? `: ${status.message}` : '')), onApplied: () => {}, receipt: () => undefined, manual: () => manual })
    session.start()
  })

  afterEach(() => {
    shown('visible')
    session.stop()
    vi.mocked(syncOnce).mockReset()
    vi.useRealTimers()
  })

  it('doesn’t look as Nib opens, nor as time goes by', async () => {
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(passes).toEqual([])
    expect(said).toEqual(['manual'])
  })

  it('doesn’t look for writing, for Nib put away or brought back, for the window, the network or a pack opened', async () => {
    written()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    written()
    shown('hidden')
    shown('visible')
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    window.dispatchEvent(new Event('nib-stamps-changed'))
    session.nudge()
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(passes).toEqual([])
  })

  it('looks once when asked, and not again by itself', async () => {
    await vi.advanceTimersByTimeAsync(60_000)
    session.run()
    await vi.advanceTimersByTimeAsync(0)
    expect(passes).toEqual([60])
    expect(said.slice(-2)).toEqual(['syncing', 'synced'])
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(passes).toEqual([60])
  })

  it('says so when there’s writing here that hasn’t been sent', async () => {
    session.run()
    await vi.advanceTimersByTimeAsync(0)
    written()
    expect(said.at(-1)).toBe('manual: Changes on this device haven’t been sent.')
    session.run()
    await vi.advanceTimersByTimeAsync(0)
    expect(said.at(-1)).toBe('synced')
  })

  it('takes up by itself again once the switch is off: a look at once, then as ever', async () => {
    await vi.advanceTimersByTimeAsync(60_000)
    manual = false
    session.nudge()
    await vi.advanceTimersByTimeAsync(0)
    expect(passes).toEqual([60])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(passes).toEqual([60, 90])
  })

  it('stops looking by itself as soon as the switch is on, a look already set included', async () => {
    manual = false
    session.nudge()
    await vi.advanceTimersByTimeAsync(0)
    expect(passes).toEqual([0])
    manual = true
    await vi.advanceTimersByTimeAsync(20 * 60_000)
    expect(passes).toEqual([0])
  })
})

