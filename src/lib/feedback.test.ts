// @vitest-environment jsdom
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { setCountsAnswer } from './counts'
import { CALENDAR_KEY, rememberCardOffered } from './yearCard'
import { askDue, countLaunch, FeedbackError, feedbackFits, giftStillOpen, launches, rememberGifted, rememberOffered, sendFeedback } from './feedback'

const held = vi.hoisted(() => ({ keychain: new Map<string, string>(), fails: false }))

vi.mock('./platform', () => ({ nativeApp: true, macApp: false, touchApp: true, deviceKind: () => 'ipad' }))
vi.mock('./keychain', () => ({
  keychain: {
    get: async ({ key, lasting }: { key: string; lasting?: boolean }) => {
      if (held.fails || !lasting) throw new Error('no')
      return { value: held.keychain.get(key) ?? null }
    },
    set: async ({ key, value, lasting }: { key: string; value: string; lasting?: boolean }) => {
      if (lasting) held.keychain.set(key, value)
    },
  },
}))

const launch = (times = 1) => {
  for (let i = 0; i < times; i++) countLaunch()
}

/** What deleting Nib and downloading it again does: the web view's storage goes, the Keychain stays. */
const downloadAgain = () => localStorage.clear()

beforeEach(() => {
  localStorage.clear()
  held.keychain.clear()
  held.fails = false
})

describe('what Nib asks once', () => {
  it('asks nothing at the first launch', async () => {
    launch()
    expect(await askDue()).toBeNull()
  })

  it('asks about counts at the second launch, and only until answered', async () => {
    launch(2)
    expect(await askDue()).toBe('counts')
    setCountsAnswer(false)
    expect(await askDue()).toBeNull()
  })

  it('offers feedback at the third launch', async () => {
    setCountsAnswer(true)
    launch(2)
    expect(await askDue()).toBeNull()
    launch()
    expect(launches()).toBe(3)
    expect(await askDue()).toBe('feedback')
  })

  it('still offers it at a later launch, if the third had no quiet moment', async () => {
    setCountsAnswer(true)
    launch(7)
    expect(await askDue()).toBe('feedback')
  })

  it('offers feedback once', async () => {
    setCountsAnswer(true)
    launch(3)
    await rememberOffered()
    launch(20)
    // Then only the writing buddy, once (lib/buddy).
    expect(await askDue()).toBe('buddy')
  })

  it('offers the writing buddy once, a launch after feedback, and not if it was set in Settings first', async () => {
    vi.resetModules()
    const fresh = await import('./feedback')
    const counts = await import('./counts')
    const buddy = await import('./buddy')
    counts.setCountsAnswer(true)
    for (let i = 0; i < 3; i++) fresh.countLaunch()
    expect(await fresh.askDue()).toBe('feedback')
    await fresh.rememberOffered()
    expect(await fresh.askDue()).toBeNull()
    fresh.countLaunch()
    expect(await fresh.askDue()).toBe('buddy')
    buddy.setBuddy(false)
    expect(await fresh.askDue()).toBeNull()

    // Turned on in Settings before its turn came: not offered.
    localStorage.clear()
    vi.resetModules()
    const again = await import('./feedback')
    ;(await import('./counts')).setCountsAnswer(true)
    ;(await import('./buddy')).setBuddy(true)
    for (let i = 0; i < 5; i++) again.countLaunch()
    await again.rememberOffered()
    // Not the buddy: the next turn, invitations to write, at the fifth launch.
    expect(await again.askDue()).toBe('invitations')
  })

  it('offers invitations to write once, on their own, a launch after the writing buddy, and not if set in Settings first', async () => {
    vi.resetModules()
    const fresh = await import('./feedback')
    ;(await import('./counts')).setCountsAnswer(true)
    ;(await import('./buddy')).setBuddy(false)
    await fresh.rememberOffered()
    for (let i = 0; i < 4; i++) fresh.countLaunch()
    expect(await fresh.askDue()).toBeNull()
    fresh.countLaunch()
    expect(await fresh.askDue()).toBe('invitations')
    const invitations = await import('./invitationSwitch')
    invitations.declineInvitations()
    expect(await fresh.askDue()).toBeNull()
    expect(invitations.invitationsOn()).toBe(false)
    // Turned on in Settings before its turn came: not offered.
    localStorage.clear()
    ;(await import('./counts')).setCountsAnswer(true)
    ;(await import('./buddy')).setBuddy(false)
    invitations.setInvitationsOn(true)
    for (let i = 0; i < 6; i++) fresh.countLaunch()
    expect(await fresh.askDue()).toBeNull()
  })

  it('offers the year’s card in December, once, after counts and before feedback', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 11, 3, 12) })
    onTestFinished(() => void vi.useRealTimers())
    setCountsAnswer(true)
    launch(3)
    localStorage.setItem(CALENDAR_KEY, JSON.stringify({ '2026-12-01': 300 }))
    expect(await askDue()).toBe('card')
    rememberCardOffered(Date.now())
    expect(await askDue()).toBe('feedback')
  })

  it('does not offer feedback again after Nib is deleted and downloaded again', async () => {
    setCountsAnswer(true)
    launch(3)
    await rememberOffered()
    downloadAgain()
    setCountsAnswer(true)
    launch(3)
    expect(launches()).toBe(3)
    expect(await askDue()).toBeNull()
  })

  it('would rather not ask than risk asking twice, if the Keychain can’t say', async () => {
    setCountsAnswer(true)
    launch(3)
    held.fails = true
    expect(await askDue()).toBeNull()
  })
})

describe('the two weeks for feedback', () => {
  it('are open until given, even after Nib is deleted and downloaded again', async () => {
    expect(await giftStillOpen()).toBe(true)
    await rememberGifted()
    downloadAgain()
    expect(await giftStillOpen()).toBe(false)
  })

  it('stay shut if the Keychain can’t say', async () => {
    held.fails = true
    expect(await giftStillOpen()).toBe(false)
  })
})

describe('a feedback message', () => {
  it('has to be 200 characters or more, and not a book', () => {
    expect(feedbackFits('   hi   ')).toBe(false)
    expect(feedbackFits('x'.repeat(199))).toBe(false)
    expect(feedbackFits(`  ${'x'.repeat(199)}  `)).toBe(false)
    expect(feedbackFits('x'.repeat(200))).toBe(true)
    expect(feedbackFits('x'.repeat(4000))).toBe(true)
    expect(feedbackFits('x'.repeat(4001))).toBe(false)
  })

  it('goes with the kind of device and version and nothing else', async () => {
    let sent: Record<string, unknown> = {}
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string)
      return new Response('{}', { status: 200 })
    })
    await sendFeedback('  A word count per chapter.  ')
    expect(Object.keys(sent).sort()).toEqual(['device', 'text', 'version'])
    expect(sent.text).toBe('A word count per chapter.')
    expect(sent.device).toBe('ipad')
  })

  it('says what went wrong, offline, refused or failed', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('offline')
    })
    await expect(sendFeedback('A word count per chapter.')).rejects.toThrow(/connection/)
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 429 }))
    await expect(sendFeedback('A word count per chapter.')).rejects.toThrow(/tomorrow/)
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 502 }))
    await expect(sendFeedback('A word count per chapter.')).rejects.toBeInstanceOf(FeedbackError)
  })
})
