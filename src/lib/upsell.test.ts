// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { due, keptHere, KEPT_WORDS, LOOK_MS, PAUSE_MS, SETTLE_DAYS, watchUpsell } from './upsell'

const DAY = 24 * 60 * 60 * 1000
const START = Date.UTC(2026, 9, 1)

describe('due', () => {
  it('waits out the first days, then asks', () => {
    expect(due({ first: START, times: 0 }, START)).toBe(false)
    expect(due({ first: START, times: 0 }, START + SETTLE_DAYS * DAY - 1)).toBe(false)
    expect(due({ first: START, times: 0 }, START + SETTLE_DAYS * DAY)).toBe(true)
  })

  it('asks weekly for the first three showings, then monthly', () => {
    const last = START + 10 * DAY
    expect(due({ first: START, last, times: 1 }, last + 6 * DAY)).toBe(false)
    expect(due({ first: START, last, times: 1 }, last + 7 * DAY)).toBe(true)
    expect(due({ first: START, last, times: 3 }, last + 29 * DAY)).toBe(false)
    expect(due({ first: START, last, times: 3 }, last + 30 * DAY)).toBe(true)
  })
})

describe('keptHere', () => {
  it('says nothing in particular until there is a fair amount written', () => {
    expect(keptHere(KEPT_WORDS - 1, 'iPhone')).toBeUndefined()
  })

  it('says how much, and names the other two devices', () => {
    expect(keptHere(12437, 'iPhone')).toBe('12,437 words, all on this iPhone. Nib Plus puts them on your iPad and Mac too, with an encrypted backup.')
    expect(keptHere(KEPT_WORDS, 'Mac')).toBe('1,000 words, all on this Mac. Nib Plus puts them on your iPhone and iPad too, with an encrypted backup.')
  })
})

describe('watchUpsell', () => {
  let stop = () => {}
  const stored = () => JSON.parse(localStorage.getItem('nib-upsell')!)
  // An offer that comes up, as most do.
  const watch = () => {
    const show = vi.fn((shown: () => void) => shown())
    stop = watchUpsell(show)
    return show
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(START)
    localStorage.clear()
  })

  afterEach(() => {
    stop()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('starts the clock on first look and shows nothing in the first days', () => {
    const show = watch()
    vi.advanceTimersByTime(PAUSE_MS)
    expect(show).not.toHaveBeenCalled()
    expect(stored()).toEqual({ first: START + PAUSE_MS, times: 0 })
  })

  it('shows a moment after opening once settled, and counts it', () => {
    localStorage.setItem('nib-upsell', JSON.stringify({ first: START - SETTLE_DAYS * DAY, times: 0 }))
    const show = watch()
    vi.advanceTimersByTime(PAUSE_MS - 1)
    expect(show).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(show).toHaveBeenCalledOnce()
    expect(stored()).toEqual({ first: START - SETTLE_DAYS * DAY, last: START + PAUSE_MS, times: 1 })
    // Not again on the hour: a week has to pass.
    vi.advanceTimersByTime(LOOK_MS)
    expect(show).toHaveBeenCalledOnce()
  })

  // Its look passed, and then something else came up, or the App Store had nothing to sell.
  it('counts a showing only once the offer has come up, and looks again if it didn’t', () => {
    const first = START - SETTLE_DAYS * DAY
    localStorage.setItem('nib-upsell', JSON.stringify({ first, times: 0 }))
    const show = vi.fn<(shown: () => void) => void>()
    stop = watchUpsell(show)
    vi.advanceTimersByTime(PAUSE_MS)
    expect(show).toHaveBeenCalledOnce()
    expect(stored()).toEqual({ first, times: 0 })

    vi.advanceTimersByTime(LOOK_MS)
    expect(show).toHaveBeenCalledTimes(2)
    show.mock.calls[1][0]()
    expect(stored()).toEqual({ first, last: START + LOOK_MS, times: 1 })
  })

  it('looks again on the hour while Nib stays open', () => {
    localStorage.setItem('nib-upsell', JSON.stringify({ first: START, times: 0 }))
    const show = watch()
    vi.advanceTimersByTime(SETTLE_DAYS * DAY)
    expect(show).toHaveBeenCalledOnce()
  })

  it('waits while someone is typing', () => {
    localStorage.setItem('nib-upsell', JSON.stringify({ first: START - SETTLE_DAYS * DAY, times: 0 }))
    const show = watch()
    vi.advanceTimersByTime(PAUSE_MS - 100)
    document.body.appendChild(document.createElement('textarea')).dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    vi.advanceTimersByTime(100)
    expect(show).not.toHaveBeenCalled()
    // Still due, so the next hourly look after a quiet minute shows it.
    vi.advanceTimersByTime(LOOK_MS)
    expect(show).toHaveBeenCalledOnce()
  })

  it('never stacks on another dialog', () => {
    localStorage.setItem('nib-upsell', JSON.stringify({ first: START - SETTLE_DAYS * DAY, times: 0 }))
    document.body.innerHTML = '<div role="dialog"></div>'
    const show = watch()
    vi.advanceTimersByTime(PAUSE_MS)
    expect(show).not.toHaveBeenCalled()
    expect(stored().times).toBe(0)
  })

  it('looks again a moment after Nib comes back to the front', () => {
    localStorage.setItem('nib-upsell', JSON.stringify({ first: START - SETTLE_DAYS * DAY, times: 0 }))
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    const show = watch()
    vi.advanceTimersByTime(PAUSE_MS)
    expect(show).not.toHaveBeenCalled()
    visibility.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(PAUSE_MS)
    expect(show).toHaveBeenCalledOnce()
  })

  it('never shows without storage, where it would ask on every launch', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const show = watch()
    vi.advanceTimersByTime(SETTLE_DAYS * DAY + LOOK_MS)
    expect(show).not.toHaveBeenCalled()
  })

  it('stops looking when stopped', () => {
    localStorage.setItem('nib-upsell', JSON.stringify({ first: START - SETTLE_DAYS * DAY, times: 0 }))
    const show = watch()
    stop()
    vi.advanceTimersByTime(PAUSE_MS + LOOK_MS)
    expect(show).not.toHaveBeenCalled()
  })
})
