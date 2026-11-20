// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

/** When the day's coins and its pack come up of their own accord (lib/useUnprompted), on an iPhone, the rest stood in for. */

vi.mock('./platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('./platform')>()), nativeApp: true, touchApp: true }))
vi.mock('./cloud', () => ({ keepInCloud: (looked: () => void) => (looked(), () => {}) }))
vi.mock('./feedback', () => ({ askDue: async () => null, rememberOffered: async () => {} }))
vi.mock('./dailyReminder', () => ({ dailyAsked: () => true }))

const { useUnprompted } = await import('./useUnprompted')
const { cardCame } = await import('./quiet')

type Props = Parameters<typeof useUnprompted>[0]
const firsts = { begun: true, earned: false, celebrating: false, celebrate: () => {}, grant: () => {} } as unknown as Props['firsts']
const synced = { known: true, code: null, status: { state: 'inactive' } } as unknown as Props['sync']
const day = (more: Partial<Props> = {}): Props => ({ listed: [], writing: true, sync: synced, plusKnown: true, coinsDue: true, packWaiting: true, today: '2026-11-17', firsts, held: false, ...more })
const pass = (ms: number) => act(() => void vi.advanceTimersByTime(ms))
const back = () => act(() => void document.dispatchEvent(new Event('visibilitychange')))
/** The caret in the writing, as iOS leaves it when Nib comes back. */
function caretInWriting() {
  const writing = document.createElement('div')
  writing.className = 'ProseMirror'
  writing.tabIndex = 0
  document.body.append(writing)
  writing.focus()
  return writing
}

beforeEach(() => void vi.useFakeTimers())
afterEach(() => {
  cleanup()
  document.body.replaceChildren()
  vi.useRealTimers()
})

describe('the day’s coins and its pack, coming up unasked', () => {
  it('come a moment after Nib opens: the coins, then, those collected, the pack', () => {
    const { result, rerender } = renderHook((props: Props) => useUnprompted(props), { initialProps: day() })
    pass(700)
    expect(result.current.coinsOpen).toBe(true)
    act(() => result.current.closeCoins())
    rerender(day({ coinsDue: false }))
    pass(700)
    expect(result.current.packOpen).toBe('offered')
  })

  // The library is read again with every save, and what sync brings: each began the wait afresh.
  it('aren’t put off by a save', () => {
    const { result, rerender } = renderHook((props: Props) => useUnprompted(props), { initialProps: day() })
    pass(600)
    rerender(day({ listed: [] }))
    pass(150)
    expect(result.current.coinsOpen).toBe(true)
  })

  it('don’t wait five seconds on a sync that only looks when asked', () => {
    const manual = { known: true, code: 'a-code', status: { state: 'manual' } } as unknown as Props['sync']
    const { result } = renderHook((props: Props) => useUnprompted(props), { initialProps: day({ sync: manual }) })
    pass(1000)
    expect(result.current.coinsOpen).toBe(true)
  })

  it('do wait, five seconds at most, on a sync that hasn’t yet looked', () => {
    const syncing = { known: true, code: 'a-code', status: { state: 'syncing' } } as unknown as Props['sync']
    const { result } = renderHook((props: Props) => useUnprompted(props), { initialProps: day({ sync: syncing }) })
    pass(4000)
    expect(result.current.coinsOpen).toBe(false)
    pass(1000)
    pass(700)
    expect(result.current.coinsOpen).toBe(true)
  })

  // Two unasked is the most in a row, and the pack counted as the third.
  it('are the one arrival: the pack follows its coins though something else came up just before them', () => {
    const { result, rerender } = renderHook((props: Props) => useUnprompted(props), { initialProps: day() })
    act(() => cardCame())
    pass(700)
    expect(result.current.coinsOpen).toBe(true)
    act(() => result.current.closeCoins())
    rerender(day({ coinsDue: false }))
    pass(700)
    expect(result.current.packOpen).toBe('offered')
  })

  it('still wait their turn as a third: a pack with no coins before it, after two others', () => {
    const { result } = renderHook((props: Props) => useUnprompted(props), { initialProps: day({ coinsDue: false }) })
    act(() => (cardCame(), cardCame()))
    pass(1400)
    expect(result.current.packOpen).toBe(false)
  })
})

describe('coming back to the front with the caret in the writing', () => {
  it('puts the keyboard away for a new day’s coins, which then come', () => {
    const writing = caretInWriting()
    const { result, rerender } = renderHook((props: Props) => useUnprompted(props), { initialProps: day({ coinsDue: false, packWaiting: false }) })
    pass(700)
    // The day is read again as Nib comes back (lib/useStamps), in the same breath.
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
      rerender(day({ today: '2026-11-18' }))
    })
    expect(document.activeElement).not.toBe(writing)
    pass(700)
    expect(result.current.coinsOpen).toBe(true)
  })

  it('leaves the caret where it is with nothing new to bring', () => {
    const writing = caretInWriting()
    renderHook((props: Props) => useUnprompted(props), { initialProps: day({ coinsDue: false, packWaiting: false }) })
    back()
    pass(700)
    expect(document.activeElement).toBe(writing)
  })

  // Come back to while something held it all (focus mode, say), the coming back was taken as seen, and the coins then waited on the caret for good.
  it('puts the keyboard away once what held the coins back has gone', () => {
    const writing = caretInWriting()
    const { result, rerender } = renderHook((props: Props) => useUnprompted(props), { initialProps: day({ held: true }) })
    back()
    expect(document.activeElement).toBe(writing)
    rerender(day({ held: false }))
    expect(document.activeElement).not.toBe(writing)
    pass(700)
    expect(result.current.coinsOpen).toBe(true)
  })

  it('doesn’t take the keyboard from writing that goes on past midnight', () => {
    const writing = caretInWriting()
    const { result, rerender } = renderHook((props: Props) => useUnprompted(props), { initialProps: day({ coinsDue: false, packWaiting: false }) })
    back()
    pass(700)
    rerender(day({ today: '2026-11-18' }))
    pass(1400)
    expect(document.activeElement).toBe(writing)
    expect(result.current.coinsOpen).toBe(false)
  })
})
