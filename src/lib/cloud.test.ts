// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// iCloud's key-value store, stood in for: its one value, and the other devices' changes, said as they come.
const icloud = vi.hoisted(() => ({
  value: null as string | null,
  writes: 0,
  changed: null as ((change: { value: string | null }) => void) | null,
}))
vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  registerPlugin: () => ({
    read: async () => ({ value: icloud.value }),
    write: async ({ value }: { value: string }) => {
      icloud.value = value
      icloud.writes++
    },
    addListener: async (_: string, listener: (change: { value: string | null }) => void) => {
      icloud.changed = listener
      return { remove: async () => {} }
    },
  }),
}))

const { keepInCloud } = await import('./cloud')
const { readCollection } = await import('./collection')
const { STAMPS_CHANGED, STAMPS_SYNCED } = await import('./collection')

const inCloud = () => JSON.parse(icloud.value!)
const login = (day: string, earned: number, step: number) => ({ id: `login:${day}`, day, sold: [], kind: 'login', earned, step })
/** Kept in iCloud, till iCloud's have been read. */
async function keeping() {
  let looked = () => {}
  const read = new Promise<void>((resolve) => (looked = resolve))
  const stop = keepInCloud(looked)
  await read
  return stop
}

beforeEach(() => {
  localStorage.clear()
  icloud.value = null
  icloud.writes = 0
  icloud.changed = null
})

describe('the stamps in iCloud', () => {
  it('take in a pack opened and coins collected on another device, before anything is offered', async () => {
    icloud.value = JSON.stringify({ stamps: ['2026-11-04'], book: [['2026-11-04', 7]], trades: [login('2026-11-04', 80, 4)] })
    const told = vi.fn()
    window.addEventListener(STAMPS_SYNCED, told)
    const stop = await keeping()
    expect(readCollection().book).toEqual([['2026-11-04', 7]])
    expect(readCollection().trades).toEqual([login('2026-11-04', 80, 4)])
    expect(told).toHaveBeenCalled()
    // Nothing here iCloud hadn't: nothing sent back.
    expect(icloud.writes).toBe(0)
    window.removeEventListener(STAMPS_SYNCED, told)
    stop()
  })

  it('send up what this device has and iCloud hasn’t, all that either has', async () => {
    icloud.value = JSON.stringify({ stamps: ['2026-11-03'], book: [['2026-11-03', 7]] })
    localStorage.setItem('nib-stamps', JSON.stringify(['2026-11-04']))
    localStorage.setItem('nib-book', JSON.stringify([['2026-11-04', 150]]))
    const stop = await keeping()
    expect(inCloud().book).toEqual([
      ['2026-11-03', 7],
      ['2026-11-04', 150],
    ])
    // A day's coins collected here: up they go.
    localStorage.setItem('nib-trades', JSON.stringify([login('2026-11-04', 10, 1)]))
    window.dispatchEvent(new Event(STAMPS_CHANGED))
    expect(inCloud().trades).toEqual([login('2026-11-04', 10, 1)])
    // And not again for nothing.
    const writes = icloud.writes
    window.dispatchEvent(new Event(STAMPS_CHANGED))
    window.dispatchEvent(new Event(STAMPS_SYNCED))
    expect(icloud.writes).toBe(writes)
    stop()
  })

  it('take in another device’s change as it comes, keeping this one’s too', async () => {
    localStorage.setItem('nib-book', JSON.stringify([['2026-11-01', 3]]))
    const stop = await keeping()
    await vi.waitFor(() => expect(icloud.changed).not.toBeNull())
    icloud.changed!({ value: JSON.stringify({ book: [['2026-11-02', 4]], trades: [login('2026-11-02', 20, 2)] }) })
    expect(readCollection().book).toEqual([
      ['2026-11-01', 3],
      ['2026-11-02', 4],
    ])
    expect(inCloud().book).toEqual(readCollection().book)
    expect(inCloud().trades).toEqual([login('2026-11-02', 20, 2)])
    stop()
  })

  it('say they’ve looked even when iCloud can’t be read, and keep what’s here', async () => {
    localStorage.setItem('nib-book', JSON.stringify([['2026-11-01', 3]]))
    icloud.value = '{ not the stamps'
    const stop = await keeping()
    expect(readCollection().book).toEqual([['2026-11-01', 3]])
    expect(inCloud().book).toEqual([['2026-11-01', 3]])
    stop()
  })

  // Past iCloud's megabyte a write fails without a word; past it the stamps stay here, and in sync.
  it('send up nothing past what iCloud keeps', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stop = await keeping()
    const sales = Array.from({ length: 20_000 }, (_, i) => ({ id: `sale-${i}-${'x'.repeat(30)}`, day: '2026-11-04', sold: [] }))
    localStorage.setItem('nib-trades', JSON.stringify(sales))
    window.dispatchEvent(new Event(STAMPS_CHANGED))
    expect(icloud.writes).toBe(0)
    expect(warn).toHaveBeenCalledWith('Nib: the stamps are too many for iCloud to keep, so they stay on this device and in sync')
    warn.mockRestore()
    stop()
  })
})
