import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import './index.css'
import { db } from './db/db'
import { localDay } from './lib/time'
import * as items from './db/items'
import { STAMPS_SYNCED } from './lib/collection'
import { stampFor } from './lib/rewards'
import { WINTER_PROMPTS } from './lib/stampWords'
import { BOOK, packFor, RARITY_INKS, RARITY_NAMES } from './lib/stampbook'

/**
 * Stamps (lib/rewards, lib/stampbook, components/Pack) through the whole app,
 * as on the Mac: a pack a day, come up the first time Nib opens that day,
 * torn open to three stamps and the day's prompt, and written from; the
 * stampbook they fill, and the days with stamps of their own.
 */

vi.mock('./lib/platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('./lib/platform')>()), nativeApp: true, macApp: true }))
vi.mock('./lib/inbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/inbox')>()),
  inbox: { list: async () => ({ captures: [] }), ack: async () => {}, addListener: async () => ({ remove: async () => {} }) },
}))
const subscribed = vi.hoisted(() => ({ on: false }))
vi.mock('./lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/plus')>()),
  usePlus: () => [{ active: subscribed.on }, () => {}, true],
  store: { products: async () => ({ products: [] }), purchase: vi.fn(), restore: vi.fn(), manage: vi.fn(), entitlement: vi.fn() },
}))

// Nib's server for codes for coins (worker/coins), stood in for: a code with one use, one used up, and one asked with no connection.
vi.mock('./lib/codes', async (importOriginal) => {
  const codes = await importOriginal<typeof import('./lib/codes')>()
  const table = new Map([
    [codes.fingerprintOf('NIB-TEST-CODE'), { coins: 300, uses: 1 }],
    [codes.fingerprintOf('NIB-FULL-CODE'), { coins: 50, uses: 0 }],
  ])
  const claims = new Map<string, Set<string>>()
  const askForCoins: typeof codes.askForCoins = async (fingerprint, claim) => {
    if (fingerprint === codes.fingerprintOf('NIB-AWAY-CODE')) return 'offline'
    if (fingerprint === codes.fingerprintOf('NIB-BUSY-CODE')) return 'too many'
    const code = table.get(fingerprint)
    if (!code) return 'unknown'
    const used = claims.get(fingerprint) ?? new Set<string>()
    if (!used.has(claim) && used.size >= code.uses) return 'used up'
    claims.set(fingerprint, used.add(claim))
    return { coins: code.coins, sig: 'signed' }
  }
  // Signed by this stand-in, not the server's key (lib/codes has tests of its own).
  const codeCoinsKept: typeof codes.codeCoinsKept = (_fingerprint, _coins, _claim, sig) => sig === 'signed'
  return { ...codes, askForCoins, codeCoinsKept }
})

const { App } = await import('./App')

const packDialog = () => screen.queryByRole('dialog', { name: 'Today’s pack' })
const waitingPack = () => screen.queryByRole('button', { name: 'Today’s pack' })
const book = () => JSON.parse(localStorage.getItem('nib-book') ?? '[]') as [string, number][]
const newNote = () => userEvent.click(screen.getByRole('button', { name: 'New note' }))
async function command(label: string) {
  await userEvent.keyboard('{Meta>}k{/Meta}')
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${label}`) }))
}
/** Today's pack, come up of its own accord. */
const arrives = () => screen.findByRole('dialog', { name: 'Today’s pack' }, { timeout: 3000 })
/** Put off, to get on with something else. */
async function later() {
  await userEvent.click(within(await arrives()).getByRole('button', { name: 'Later' }))
}
/** Torn open, and its stamps all out. */
async function openPack() {
  const dialog = await arrives()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Open the pack' }))
  await waitFor(() => expect(dialog.dataset.phase).toBe('done'), { timeout: 5000 })
  return within(dialog)
}
/** Today's coins for coming back, collected already (none, here), for today's pack to come up first: they have tests of their own, below. */
function coinsCollected() {
  const day = localDay(Date.now())
  const trades = JSON.parse(localStorage.getItem('nib-trades') ?? '[]')
  localStorage.setItem('nib-trades', JSON.stringify([...trades, { id: `login:${day}`, day, sold: [], kind: 'login' }]))
}
/** Customize → Motion: None, as lib/look's applyLook puts it on the page: once Nib is up, or its own look would take it off. */
function stillMotion() {
  document.documentElement.dataset.motion = 'none'
  onTestFinished(() => void delete document.documentElement.dataset.motion)
}
/** The phases a pack goes through, as each happens: tearing lasts a second, and a busy machine may not look in time. */
function phasesOf(dialog: HTMLElement) {
  const seen = [dialog.dataset.phase]
  const watcher = new MutationObserver(() => seen.push(dialog.dataset.phase))
  watcher.observe(dialog, { attributes: true, attributeFilter: ['data-phase'] })
  onTestFinished(() => watcher.disconnect())
  return seen
}
const told = (nos: number[]) => `In today’s pack: ${nos.map((no) => `${BOOK[no - 1].name}, ${RARITY_NAMES[BOOK[no - 1].rarity].toLowerCase()}, new`).join('; ')}.`

beforeEach(async () => {
  localStorage.clear()
  localStorage.setItem('nib-device-asked', '1') // the welcome, already seen
  localStorage.setItem('nib-daily-asked', 'true') // the daily reminder, already offered (dailyReminder.browser.test)
  await db.items.clear()
  await page.viewport(1280, 800)
})
afterEach(cleanup)

describe('Today’s pack', () => {
  // Only the date is the 4th of November; timers run as ever.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T10:00:00') })
    coinsCollected()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('come up of its own accord, has the focus itself, not its button: a key meant for the writing can’t open it', async () => {
    await act(async () => void render(<App />))
    const dialog = await arrives()
    await waitFor(() => expect(document.activeElement).toBe(dialog))
    await userEvent.keyboard(' {Enter}')
    expect(dialog.dataset.phase).toBe('sealed')
    expect(localStorage.getItem('nib-book')).toBeNull()
  })

  // Escape did nothing for up to five seconds as it tore: the open button gone, the focus fell out of the pack.
  it('goes to its stamps with Escape as it tears open, the focus kept in it', async () => {
    await act(async () => void render(<App />))
    const dialog = await arrives()
    const phases = phasesOf(dialog)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open the pack' }))
    await waitFor(() => expect(phases).toContain('tearing'))
    await waitFor(() => expect(document.activeElement).toBe(dialog))
    await userEvent.keyboard('{Escape}')
    expect(dialog.dataset.phase).toBe('done')
    expect(phases.slice(0, 2)).toEqual(['sealed', 'tearing'])
  })

  it('comes up as Nib opens, and tears open to a stamp, new, and the day’s prompt', async () => {
    await act(async () => void render(<App />))
    const dialog = await arrives()
    const phases = phasesOf(dialog)
    expect(dialog.dataset.phase).toBe('sealed')
    expect(localStorage.getItem('nib-book')).toBeNull()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open the pack' }))
    // Shaken, its top torn off, then the stamps out one by one.
    await waitFor(() => expect(dialog.dataset.phase).toBe('done'), { timeout: 8000 })
    expect(phases).toEqual(['sealed', 'tearing', 'showing', 'done'])

    const nos = packFor('2026-11-04')
    expect(book()).toEqual(nos.map((no) => ['2026-11-04', no]))
    expect(JSON.parse(localStorage.getItem('nib-stamps')!)).toEqual(['2026-11-04'])
    const pack = within(dialog)
    for (const no of nos) expect(pack.getByText(BOOK[no - 1].name)).toBeTruthy()
    expect(pack.getByText(/^In today’s pack: /).textContent).toBe(told(nos))
    expect(pack.getAllByText('New')).toHaveLength(1)
    const lucky = dialog.querySelector<HTMLElement>('[data-lucky]')!
    expect(lucky.dataset.rarity).toBe(BOOK[nos[0] - 1].rarity)
    expect(pack.getByText(stampFor('2026-11-04', book()).prompt)).toBeTruthy()
    await userEvent.click(pack.getByRole('button', { name: 'Done' }))
    expect(packDialog()).toBeNull()

    // Once a day: Nib opened again later today has none.
    cleanup()
    await act(async () => void render(<App />))
    await newNote()
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(packDialog()).toBeNull()
    expect(waitingPack()).toBeNull()
  })

  it('goes straight to its stamps when tapped while they come out', async () => {
    await act(async () => void render(<App />))
    const dialog = await arrives()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open the pack' }))
    await waitFor(() => expect(dialog.dataset.phase).toBe('showing'), { timeout: 3000 })
    await userEvent.click(dialog)
    expect(dialog.dataset.phase).toBe('done')
  })

  it('put off till later, waits beside the way back to the library, steps aside for focus mode, and opens from there', async () => {
    await act(async () => void render(<App />))
    await later()
    expect(packDialog()).toBeNull()
    expect(localStorage.getItem('nib-book')).toBeNull()
    // Not again of its own accord today.
    await newNote()
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(packDialog()).toBeNull()
    await command('Focus mode')
    expect(waitingPack()).toBeNull()
    await command('Leave focus mode')
    await userEvent.click(waitingPack()!)
    expect(packDialog()!.dataset.phase).toBe('sealed')
    // Escape puts it off again.
    await userEvent.keyboard('{Escape}')
    expect(packDialog()).toBeNull()
    stillMotion()
    await userEvent.click(waitingPack()!)
    await userEvent.click(screen.getByRole('button', { name: 'Open the pack' }))
    // With Motion off, its stamps at once.
    expect(packDialog()!.dataset.phase).toBe('done')
    expect(book()).toHaveLength(1)
    await userEvent.keyboard('{Escape}')
    expect(packDialog()).toBeNull()
    expect(waitingPack()).toBeNull()
  })

  it('writes from the prompt: a new note that begins with it, the cursor on the line below', async () => {
    await act(async () => void render(<App />))
    stillMotion()
    const pack = await openPack()
    await userEvent.click(pack.getByRole('button', { name: 'Write from it' }))
    expect(packDialog()).toBeNull()
    const prompt = stampFor('2026-11-04', book()).prompt
    await waitFor(() => expect(document.querySelector('main .ProseMirror')!.textContent).toBe(prompt))
    await waitFor(() => expect(document.activeElement?.closest('.ProseMirror')).not.toBeNull())
    await userEvent.keyboard('A room')
    await waitFor(async () => expect((await items.list('note')).map((note) => note.body.content?.map((block) => block.content?.[0]?.text ?? ''))).toContainEqual([prompt, 'A room']))
  })

  it('leads to the Stampbook, and puts it in Commands, alone', async () => {
    await act(async () => void render(<App />))
    stillMotion()
    await later()
    await newNote()
    await userEvent.keyboard('{Meta>}k{/Meta}')
    expect(screen.queryByRole('button', { name: /^Stampbook/ })).toBeNull()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(waitingPack()!)
    await userEvent.click(screen.getByRole('button', { name: 'Open the pack' }))
    await userEvent.click(screen.getByRole('button', { name: 'Stampbook' }))
    expect(packDialog()).toBeNull()
    expect(within(screen.getByRole('dialog', { name: 'Stampbook' })).getByText(/ found, and /).textContent).toMatch(/^1 of 300 found, /)
    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('{Meta>}k{/Meta}')
    expect(screen.queryByRole('button', { name: /^Your stamps/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^Stampbook/ }))
    // Not in the writing behind it, where Commands handed it back.
    expect(document.activeElement?.closest('[role="dialog"]')?.getAttribute('aria-label')).toBe('Stampbook')
  })

  it('brings repeats as real packs do, each showing how many there are now', async () => {
    // Every one found already: today's is a repeat, whatever it is.
    localStorage.setItem('nib-book', JSON.stringify(BOOK.map((entry) => ['2026-11-01', entry.no])))
    await act(async () => void render(<App />))
    stillMotion()
    const pack = await openPack()
    const [no] = packFor('2026-11-04')
    expect(pack.getByText(/^In today’s pack: /).textContent).toBe(`In today’s pack: ${BOOK[no - 1].name}, ${RARITY_NAMES[BOOK[no - 1].rarity].toLowerCase()}, a repeat, 2 now.`)
  })

  it('brings a legendary or mythic stamp with confetti, on a day whose draw is one', async () => {
    // The first day from here whose pack holds one.
    const day = Array.from({ length: 2000 }, (_, i) => localDay(new Date(2026, 10, 4 + i).getTime())).find((one) => /^(legendary|mythic)$/.test(BOOK[packFor(one)[0] - 1].rarity))!
    vi.setSystemTime(new Date(`${day}T10:00:00`))
    coinsCollected()
    await act(async () => void render(<App />))
    const pack = await openPack()
    const [no] = packFor(day)
    expect(book()).toEqual([[day, no]])
    expect(pack.getByText(BOOK[no - 1].name)).toBeTruthy()
    expect(document.querySelector('[data-lucky]')!.getAttribute('data-rarity')).toBe(BOOK[no - 1].rarity)
    expect(document.querySelector('[data-confetti]')!.children.length).toBeGreaterThan(0)
  })

  it('goes, still sealed, when sync brings it opened on another device', async () => {
    await act(async () => void render(<App />))
    stillMotion()
    await arrives()
    localStorage.setItem('nib-book', JSON.stringify([['2026-11-04', 9], ['2026-11-04', 10], ['2026-11-04', 130]]))
    localStorage.setItem('nib-stamps', JSON.stringify(['2026-11-04']))
    act(() => void window.dispatchEvent(new Event(STAMPS_SYNCED)))
    await waitFor(() => expect(packDialog()).toBeNull())
    expect(waitingPack()).toBeNull()
  })

  it('opened already in another window, shows what that one held', async () => {
    await act(async () => void render(<App />))
    stillMotion()
    const dialog = await arrives()
    const other: [string, number][] = [
      ['2026-11-04', 9],
      ['2026-11-04', 10],
      ['2026-11-04', 130],
    ]
    localStorage.setItem('nib-book', JSON.stringify(other))
    localStorage.setItem('nib-stamps', JSON.stringify(['2026-11-04']))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Open the pack' }))
    expect(book()).toEqual(other)
    expect(within(dialog).getByText(BOOK[129].name)).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('nib-stamps')!)).toEqual(['2026-11-04'])
  })
})

describe('Today’s coins', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T10:00:00') })
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  const coins = () => screen.findByRole('dialog', { name: 'Today’s coins' }, { timeout: 3000 })
  const coinsDialog = () => screen.queryByRole('dialog', { name: 'Today’s coins' })
  const log = () => JSON.parse(localStorage.getItem('nib-trades') ?? '[]')
  const days = (dialog: HTMLElement) => within(dialog).getAllByRole('listitem').map((day) => day.getAttribute('aria-label'))

  it('come up as Nib opens on a day, before today’s pack: 10 the first day, collected, counted, and once a day', async () => {
    await act(async () => void render(<App />))
    const dialog = await coins()
    expect(packDialog()).toBeNull()
    const card = within(dialog)
    expect(card.getByText('Day 1 of 7')).toBeTruthy()
    expect(card.getByText('Come back tomorrow for 20. Miss a day and the week starts over.')).toBeTruthy()
    expect(days(dialog)).toEqual(['Day 1, 10 coins, today', 'Day 2, 20 coins', 'Day 3, 40 coins', 'Day 4, 80 coins', 'Day 5, 160 coins', 'Day 6, 320 coins', 'Day 7, 640 coins'])
    await userEvent.click(card.getByRole('button', { name: 'Collect 10 coins' }))
    expect(log()).toEqual([{ id: 'login:2026-11-04', day: '2026-11-04', sold: [], kind: 'login', earned: 10, step: 1 }])
    expect(days(dialog)[0]).toBe('Day 1, 10 coins, collected')
    // The little coins fly as the count goes up.
    expect(dialog.querySelectorAll('.nib-coin-fly').length).toBeGreaterThan(0)
    // Counted up on the card; said once, for VoiceOver, as it ends.
    await waitFor(() => expect(card.getAllByText(/^You have/).map((line) => line.textContent)).toEqual(['You have 10 coins.', 'You have 10 coins.']), { timeout: 3000 })
    await userEvent.click(card.getByRole('button', { name: 'Done' }))
    expect(coinsDialog()).toBeNull()
    // Then today's pack, and the market has them.
    await later()
    expect(screen.getByRole('button', { name: 'Market, 10 coins' })).toBeTruthy()

    cleanup()
    await act(async () => void render(<App />))
    await newNote()
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(coinsDialog()).toBeNull()
  })

  it('double each day running, and are collected by a tap outside them', async () => {
    const before = ['2026-11-01', '2026-11-02', '2026-11-03'].map((day, i) => ({ id: `login:${day}`, day, sold: [], kind: 'login', earned: 10 * 2 ** i, step: i + 1 }))
    localStorage.setItem('nib-trades', JSON.stringify(before))
    await act(async () => void render(<App />))
    const dialog = await coins()
    expect(within(dialog).getByText('Day 4 of 7')).toBeTruthy()
    expect(within(dialog).getAllByRole('listitem').map((day) => day.dataset.state)).toEqual(['got', 'got', 'got', 'today', 'ahead', 'ahead', 'ahead'])
    expect(within(dialog).getByText('+80')).toBeTruthy()
    fireEvent.mouseDown(dialog.parentElement!)
    expect(coinsDialog()).toBeNull()
    expect(log().at(-1)).toEqual({ id: 'login:2026-11-04', day: '2026-11-04', sold: [], kind: 'login', earned: 80, step: 4 })
    await arrives()
  })

  it('after a whole week, are 10 a day till a new week starts', async () => {
    const week = Array.from({ length: 7 }, (_, i) => {
      const day = `2026-10-${25 + i}`
      return { id: `login:${day}`, day, sold: [], kind: 'login', earned: 10 * 2 ** i, step: i + 1 }
    })
    localStorage.setItem('nib-trades', JSON.stringify(week))
    await act(async () => void render(<App />))
    const dialog = await coins()
    expect(within(dialog).getByText('Today’s coins')).toBeTruthy()
    expect(within(dialog).getByText('10 a day for now. A new week starts in 27 days.')).toBeTruthy()
    expect(within(dialog).queryByRole('list')).toBeNull()
    await userEvent.keyboard('{Escape}')
    expect(log().at(-1)).toMatchObject({ earned: 10, step: 0 })
  })

  // The card said 10 a day to a subscriber getting 25.
  it('say the 25 a day after a whole week with Nib Plus', async () => {
    subscribed.on = true
    onTestFinished(() => void (subscribed.on = false))
    const week = Array.from({ length: 7 }, (_, i) => {
      const day = `2026-10-${25 + i}`
      return { id: `login:${day}`, day, sold: [], kind: 'login', earned: 25 * 2 ** i, step: i + 1 }
    })
    localStorage.setItem('nib-trades', JSON.stringify(week))
    await act(async () => void render(<App />))
    expect(within(await coins()).getByText('25 a day for now. A new week starts in 27 days.')).toBeTruthy()
  })

  it('are two and a half times as many with Nib Plus', async () => {
    subscribed.on = true
    onTestFinished(() => void (subscribed.on = false))
    await act(async () => void render(<App />))
    const dialog = await coins()
    expect(days(dialog).map((day) => day!.split(', ')[1])).toEqual(['25 coins', '50 coins', '100 coins', '200 coins', '400 coins', '800 coins', '1,600 coins'])
    await userEvent.click(within(dialog).getByRole('button', { name: 'Collect 25 coins' }))
    expect(log().at(-1)).toMatchObject({ earned: 25, step: 1 })
  })

  it('go, uncollected here, once sync brings them collected on another device', async () => {
    await act(async () => void render(<App />))
    await coins()
    localStorage.setItem('nib-trades', JSON.stringify([{ id: 'login:2026-11-04', day: '2026-11-04', sold: [], kind: 'login', earned: 20, step: 2 }]))
    act(() => void window.dispatchEvent(new Event(STAMPS_SYNCED)))
    await waitFor(() => expect(coinsDialog()).toBeNull())
    expect(log()).toHaveLength(1)
    await arrives()
  })

  // Set back a day at a time, the date brought a day's coins and pack each time, and a new week of packs.
  it('don’t come, nor the day’s pack, and coins can’t be spent, with the date set before a day already had', async () => {
    localStorage.setItem(
      'nib-trades',
      JSON.stringify([
        { id: 'login:2026-11-05', day: '2026-11-05', sold: [], kind: 'login', earned: 10, step: 1 },
        { id: 'earlier', day: '2026-11-01', sold: Array<number>(10).fill(191) },
      ]),
    )
    localStorage.setItem('nib-book', JSON.stringify([['2026-11-05', 7], ...Array.from({ length: 11 }, () => ['2026-10-31', 191])]))
    localStorage.setItem('nib-stamps', JSON.stringify(['2026-11-05']))
    await act(async () => void render(<App />))
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(coinsDialog()).toBeNull()
    expect(packDialog()).toBeNull()
    expect(waitingPack()).toBeNull()
    const library = within(document.querySelector<HTMLElement>('.nib-library')!)
    await userEvent.click(library.getByRole('button', { name: /^Market/ }))
    const market = within(screen.getByRole('dialog', { name: 'Market' }))
    expect(market.getByRole('status').textContent).toMatch(/^Your stamps and coins have been used as late as .*2026, and this device’s date is earlier\./)
    const spend = [...market.getAllByRole('button', { name: /^Buy a pack|of Nib Plus for/ }), market.getByRole('button', { name: /^Re-roll/ })]
    expect(spend.map((button) => (button as HTMLButtonElement).disabled)).toEqual(Array(8).fill(true))
    expect(log()).toHaveLength(2)
  })

  // The day was read again only as Nib came back to the screen: a Mac left open had no new day.
  it('come on a new day at midnight, with Nib left open', async () => {
    vi.setSystemTime(new Date('2026-11-04T23:59:59'))
    localStorage.setItem('nib-trades', JSON.stringify([{ id: 'login:2026-11-04', day: '2026-11-04', sold: [], kind: 'login', earned: 10, step: 1 }]))
    localStorage.setItem('nib-book', JSON.stringify([['2026-11-04', 5]]))
    await act(async () => void render(<App />))
    await new Promise((resolve) => setTimeout(resolve, 1000))
    expect(coinsDialog()).toBeNull()
    vi.setSystemTime(new Date('2026-11-05T00:00:01'))
    expect(within(await coins()).getByText('Day 2 of 7')).toBeTruthy()
  })

  // Once a card that came up unasked had closed, nothing had focus, and what was typed next went nowhere.
  it('give the keyboard back to the writing as they go', async () => {
    vi.setSystemTime(new Date('2026-11-04T23:59:59'))
    localStorage.setItem('nib-trades', JSON.stringify([{ id: 'login:2026-11-04', day: '2026-11-04', sold: [], kind: 'login', earned: 10, step: 1 }]))
    localStorage.setItem('nib-book', JSON.stringify([['2026-11-04', 5]]))
    await act(async () => void render(<App />))
    await newNote()
    const inTheWriting = () => document.activeElement?.closest('.ProseMirror') != null
    await expect.poll(inTheWriting).toBe(true)
    vi.setSystemTime(new Date('2026-11-05T00:02:00'))
    const dialog = await screen.findByRole('dialog', { name: 'Today’s coins' }, { timeout: 5000 })
    await waitFor(() => expect(document.activeElement).toBe(dialog))
    await userEvent.keyboard('{Escape}')
    expect(coinsDialog()).toBeNull()
    await expect.poll(inTheWriting).toBe(true)
  })

  it('wait while you write, for a minute without a key, and come up taking no key meant for the writing', async () => {
    await act(async () => void render(<App />))
    const field = document.body.appendChild(document.createElement('textarea'))
    onTestFinished(() => field.remove())
    fireEvent.keyDown(field, { key: 'a' })
    await new Promise((resolve) => setTimeout(resolve, 1500))
    expect(coinsDialog()).toBeNull()
    vi.setSystemTime(new Date('2026-11-04T10:01:01'))
    const dialog = await coins()
    // The card has the focus, not its coin: a space or a Return collects nothing.
    await waitFor(() => expect(document.activeElement).toBe(dialog))
    await userEvent.keyboard(' {Enter}')
    expect(log()).toEqual([])
    expect(within(dialog).getByRole('button', { name: 'Collect 10 coins' })).toBeTruthy()
  })
})

describe('The stampbook', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T10:00:00') })
    coinsCollected()
    // Today's pack opened already.
    localStorage.setItem('nib-stamps', JSON.stringify(['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04']))
    localStorage.setItem('nib-book', JSON.stringify([['2026-11-01', 7], ['2026-11-02', 150], ['2026-11-03', 191], ['2026-11-04', 7]]))
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  const stampbook = () => screen.getByRole('dialog', { name: 'Stampbook' })
  const longDate = (date: Date) => date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
  /** The page showing, not one turning away. */
  const showing = () => stampbook().querySelector<HTMLElement>('section:not([aria-hidden])')!
  /** Turned to a part of the book from its contents. */
  async function turnTo(part: string) {
    const contents = within(stampbook()).queryByRole('button', { name: 'Contents' })
    if (contents) await userEvent.click(contents)
    await userEvent.click(within(stampbook()).getByRole('button', { name: new RegExp(`^${part},`) }))
  }

  // The bars had a blue and a violet of their own, apart from the pack's and the market's.
  it('fills each rarity’s bar in that rarity’s one colour', async () => {
    await act(async () => void render(<App />))
    await newNote()
    await command('Stampbook')
    await waitFor(() => expect(stampbook().querySelector('[data-cover]')).toBeNull(), { timeout: 3000 })
    const probe = document.body.appendChild(document.createElement('i'))
    onTestFinished(() => probe.remove())
    const rgb = (colour: string) => {
      probe.style.color = colour
      return getComputedStyle(probe).color
    }
    const bar = (rarity: string) => getComputedStyle(stampbook().querySelector(`.nib-progress[data-rarity='${rarity}'] > span`)!)
    expect(bar('rare').backgroundColor).toBe(rgb(RARITY_INKS.rare))
    expect(bar('unique').backgroundColor).toBe(rgb(RARITY_INKS.unique))
    expect(bar('legendary').backgroundImage).toContain(rgb(RARITY_INKS.legendary))
    expect(bar('mythic').backgroundImage).toContain(rgb(RARITY_INKS.mythic))
  })

  // At 320 points (Slide Over on an iPad) five stamps to a row ran off the page, and its words ran to eight lines.
  it('fits 320 points across', async () => {
    await page.viewport(320, 568)
    onTestFinished(() => page.viewport(414, 896))
    await act(async () => void render(<App />))
    await newNote()
    await command('Stampbook')
    await waitFor(() => expect(stampbook().querySelector('[data-cover]')).toBeNull(), { timeout: 3000 })
    await userEvent.click(within(showing()).getByRole('button', { name: /^Common/ }))
    await waitFor(() => expect(showing().querySelectorAll('.grid > *').length).toBeGreaterThan(5))
    const book = stampbook().getBoundingClientRect()
    expect([...showing().querySelectorAll('.grid > *')].every((mount) => mount.getBoundingClientRect().right <= book.right)).toBe(true)
    expect(within(stampbook()).getByText(/ found, and /).getBoundingClientRect().height).toBeLessThan(60)
  })

  it('is in Commands: a book whose cover swings open onto its contents, each rarity, the holidays and the keepsakes, found or not', async () => {
    await act(async () => void render(<App />))
    await newNote()
    await command('Stampbook')
    expect(within(stampbook()).getByText(/ found, and /).textContent).toBe('3 of 300 found, and 1 of 17 holidays. Kept on this device, and through iCloud on your others.')
    expect(stampbook().querySelector('[data-cover]')).not.toBeNull()
    await waitFor(() => expect(stampbook().querySelector('[data-cover]')).toBeNull(), { timeout: 3000 })
    expect(showing().getAttribute('aria-label')).toBe('Contents')
    expect(
      within(showing())
        .getAllByRole('button')
        .map((row) => row.getAttribute('aria-label')),
    ).toEqual([
      'Common, 1 of 187 found, 70% of stamps drawn',
      'Rare, 1 of 60 found, 23% of stamps drawn',
      'Unique, 0 of 37 found, 5% of stamps drawn',
      'Legendary, 1 of 10 found, 1.5% of stamps drawn',
      'Mythic, 0 of 6 found, 0.5% of stamps drawn',
      'Holidays, 1 of 17 found, in the day’s pack',
      'Keepsakes, 0 of 32 found, milestones, special days, and christmas',
    ])
    expect(within(stampbook()).getByRole('button', { name: 'Previous page' }).hasAttribute('disabled')).toBe(true)

    // Page by page to the end: common's 187 over eight, rare's 60 over three, unique's 37 over two, and the rest one each.
    const pages: [string, number][] = []
    for (let i = 0; i < 16; i++) {
      await userEvent.click(within(stampbook()).getByRole('button', { name: 'Next page' }))
      pages.push([showing().getAttribute('aria-label')!, within(showing()).getAllByRole('button').length])
    }
    expect(pages).toEqual([
      ...Array.from({ length: 7 }, (_, i): [string, number] => [`Common, page ${i + 1} of 8`, 25]),
      ['Common, page 8 of 8', 12],
      ['Rare, page 1 of 3', 25],
      ['Rare, page 2 of 3', 25],
      ['Rare, page 3 of 3', 10],
      ['Unique, page 1 of 2', 25],
      ['Unique, page 2 of 2', 12],
      ['Legendary', 10],
      ['Mythic', 6],
      ['Holidays', 17],
    ])
    // Found, a stamp shows itself; still to find, only its number, or a holiday its next day.
    const holidays = within(showing())
    expect(holidays.getByRole('button', { name: 'Halloween' }).querySelector('svg')?.getAttribute('aria-label')).toBe('A jack-o’-lantern, Oct 31')
    expect(holidays.getByRole('button', { name: 'Thanksgiving, still to find' }).textContent).toBe('Nov 26')
    // Easter is past for this year, so next year's, the 28th of March.
    expect(holidays.getByRole('button', { name: 'Easter, still to find' }).textContent).toBe('Mar 28')
    // And last, the keepsakes: first steps, the birthday, Inkwell's, the five milestones and special days, and the 24 doors.
    await userEvent.click(within(stampbook()).getByRole('button', { name: 'Next page' }))
    expect(showing().getAttribute('aria-label')).toBe('Keepsakes')
    expect(within(showing()).getAllByRole('button')).toHaveLength(32)
    expect(within(showing()).getByRole('button', { name: 'Inkwell, still to find' })).toBeTruthy()
    expect(within(stampbook()).getByRole('button', { name: 'Next page' }).hasAttribute('disabled')).toBe(true)

    await turnTo('Common')
    expect(showing().getAttribute('aria-label')).toBe('Common, page 1 of 8')
    // Found twice: the stamp, and how many copies.
    const seven = within(showing()).getByRole('button', { name: `No. 7, ${BOOK[6].name}, 2 copies` })
    expect(seven.querySelector('svg')).not.toBeNull()
    expect(seven.textContent).toMatch(/×2$/)
    expect(within(showing()).getByRole('button', { name: 'No. 8, still to find' }).textContent).toBe('8')
  })

  it('turns with the arrow keys and with a swipe, which isn’t a tap on the stamp it began on', async () => {
    await act(async () => void render(<App />))
    await newNote()
    await command('Stampbook')
    await turnTo('Legendary')
    await userEvent.keyboard('{ArrowRight}')
    expect(showing().getAttribute('aria-label')).toBe('Mythic')
    await userEvent.keyboard('{ArrowLeft}')
    await userEvent.keyboard('{ArrowLeft}')
    expect(showing().getAttribute('aria-label')).toBe('Unique, page 2 of 2')
    const album = showing().parentElement!
    const across = (target: Element, from: number, to: number) => {
      fireEvent.pointerDown(target, { clientX: from, clientY: 300 })
      fireEvent.pointerUp(target, { clientX: to, clientY: 306 })
      fireEvent.click(target)
    }
    across(album, 300, 180)
    await waitFor(() => expect(showing().getAttribute('aria-label')).toBe('Legendary'))
    across(within(showing()).getByRole('button', { name: `No. 191, ${BOOK[190].name}` }), 180, 320)
    await waitFor(() => expect(showing().getAttribute('aria-label')).toBe('Unique, page 2 of 2'))
    expect(screen.queryByRole('dialog', { name: 'No. 191' })).toBeNull()
    // A tap stays put.
    across(album, 200, 204)
    expect(showing().getAttribute('aria-label')).toBe('Unique, page 2 of 2')
  })

  it('opens at once with Motion off, no cover to swing', async () => {
    await act(async () => void render(<App />))
    await newNote()
    stillMotion()
    await command('Stampbook')
    expect(stampbook().querySelector('[data-cover]')).toBeNull()
    await turnTo('Rare')
    expect(stampbook().querySelectorAll('section')).toHaveLength(1)
  })

  it('opens each stamp to a page of its own: when it was found, or how to find it, and Escape goes back a step', async () => {
    await act(async () => void render(<App />))
    await newNote()
    await command('Stampbook')
    const page = () => screen.queryByRole('dialog', { name: /^No\. |Thanksgiving/ })

    await turnTo('Rare')
    await userEvent.click(within(showing()).getByRole('button', { name: `No. 150, ${BOOK[149].name}` }))
    expect(within(page()!).getByText('Rare · No. 150')).toBeTruthy()
    expect(within(page()!).getByText(BOOK[149].story)).toBeTruthy()
    expect(within(page()!).getByText(`Found on ${longDate(new Date(2026, 10, 2))}.`)).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(page()).toBeNull()
    expect(document.activeElement?.getAttribute('aria-label')).toBe(`No. 150, ${BOOK[149].name}`)

    await turnTo('Common')
    await userEvent.click(within(showing()).getByRole('button', { name: `No. 7, ${BOOK[6].name}, 2 copies` }))
    expect(within(page()!).getByText(`Found 2 times, first on ${longDate(new Date(2026, 10, 1))}.`)).toBeTruthy()
    await userEvent.click(within(page()!).getByRole('button', { name: 'Back' }))

    await userEvent.click(within(showing()).getByRole('button', { name: 'No. 8, still to find' }))
    expect(within(page()!).getByText('Still to find')).toBeTruthy()
    expect(within(page()!).getByText('Each stamp drawn is common 70% of the time, any of the 187, so repeats come too.')).toBeTruthy()
    expect(within(page()!).queryByText(BOOK[7].name)).toBeNull()
    await userEvent.keyboard('{Escape}')

    await turnTo('Legendary')
    await userEvent.click(within(showing()).getByRole('button', { name: 'No. 192, still to find' }))
    expect(within(page()!).getByText('Each stamp drawn is legendary 1.5% of the time, any of the 10, so repeats come too.')).toBeTruthy()
    await userEvent.keyboard('{Escape}')

    await turnTo('Holidays')
    await userEvent.click(within(showing()).getByRole('button', { name: 'Thanksgiving, still to find' }))
    const thanksgiving = new Date(2026, 10, 26).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
    expect(within(page()!).getByText(`Open the day’s pack on ${thanksgiving}, and it’s yours.`)).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(page()).toBeNull()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Stampbook' })).toBeNull()
  })

  it('has a market: repeats traded in for points, one at a time or all, always keeping one of each', async () => {
    localStorage.setItem('nib-book', JSON.stringify([['2026-11-01', 7], ['2026-11-02', 150], ['2026-11-03', 150], ['2026-11-04', 7], ['2026-11-04', 150]]))
    await act(async () => void render(<App />))
    stillMotion()
    await newNote()
    await command('Stampbook')
    await userEvent.click(within(stampbook()).getByRole('button', { name: 'Market · 0' }))
    const market = within(screen.getByRole('dialog', { name: 'Market' }))
    expect(market.getByText('0')).toBeTruthy()
    // 7 is common, with one spare; 150 rare, with two.
    expect(market.getAllByRole('listitem').map((row) => row.textContent)).toEqual([
      expect.stringContaining(`${BOOK[149].name}Rare · 2 spare · +5 each`),
      expect.stringContaining(`${BOOK[6].name}Common · 1 spare · +1 each`),
    ])

    await userEvent.click(market.getByRole('button', { name: `Sell one copy of ${BOOK[149].name} for 5 coins` }))
    expect(market.getByText('5')).toBeTruthy()
    expect(market.getByText(/1 spare · \+5 each/)).toBeTruthy()
    await userEvent.click(market.getByRole('button', { name: 'Sell all 2 repeats · +6' }))
    expect(market.getByText('11')).toBeTruthy()
    expect(market.getByText(/^No repeats to sell\./)).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('nib-trades')!).map((trade: { sold: number[] }) => trade.sold)).toEqual([[], [150], [150, 7]])

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Market' })).toBeNull()
    expect(document.activeElement?.textContent).toBe('Market · 11')
    await turnTo('Rare')
    expect(within(showing()).getByRole('button', { name: `No. 150, ${BOOK[149].name}` }).textContent).not.toMatch(/×/)

    // Kept: the points are still there next time.
    cleanup()
    await act(async () => void render(<App />))
    await newNote()
    await command('Stampbook')
    expect(within(stampbook()).getByRole('button', { name: 'Market · 11' })).toBeTruthy()
  })

  it('sells a repeat from its own page, a copy at a time, keeping the last', async () => {
    await act(async () => void render(<App />))
    await newNote()
    await command('Stampbook')
    await turnTo('Common')
    await userEvent.click(within(showing()).getByRole('button', { name: `No. 7, ${BOOK[6].name}, 2 copies` }))
    const page = () => within(screen.getAllByRole('dialog').at(-1)!)
    expect(page().getByText('You have 2. You always keep one.')).toBeTruthy()
    await userEvent.click(page().getByRole('button', { name: 'Sell one for 1 coin' }))
    expect(page().getByText('You have 1. You always keep one.')).toBeTruthy()
    expect(page().queryByRole('button', { name: /^Sell one/ })).toBeNull()
    expect(JSON.parse(localStorage.getItem('nib-trades')!).at(-1).sold).toEqual([7])
    // The button gone, focus is back on Back, so Escape still goes.
    expect(document.activeElement?.textContent).toBe('Back')
    await userEvent.keyboard('{Escape}')
    expect(within(stampbook()).getByRole('button', { name: 'Market · 1' })).toBeTruthy()
    // One copy: nothing to sell.
    await userEvent.click(within(showing()).getByRole('button', { name: `No. 7, ${BOOK[6].name}` }))
    expect(page().queryByText(/You always keep one/)).toBeNull()
  })

  it('takes a code for coins in the market, as Nib’s server counts it, once on an Apple Account', async () => {
    await act(async () => void render(<App />))
    stillMotion()
    const library = within(document.querySelector<HTMLElement>('.nib-library')!)
    await userEvent.click(library.getByRole('button', { name: /^Market/ }))
    const market = within(screen.getByRole('dialog', { name: 'Market' }))
    const field = market.getByLabelText('A code for coins')
    const said = async (code: string) => {
      await userEvent.clear(field)
      await userEvent.type(field, code)
      await userEvent.click(market.getByRole('button', { name: 'Redeem' }))
      return (await market.findByRole('status')).textContent
    }
    expect(await said('nib test code')).toBe('300 coins, yours.')
    expect(market.getByText('300')).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('nib-trades')!).at(-1)).toMatchObject({ day: '2026-11-04', kind: 'code', earned: 300 })
    expect(JSON.parse(localStorage.getItem('nib-coin-claims')!)).toEqual({})
    // Again, on this Apple Account: used, without asking the server.
    expect(await said('NIB-TEST-CODE')).toBe('You’ve used that code already.')
    expect(await said('NIB-TEST-CODX')).toBe('That isn’t a code Nib knows. Check it and try again.')
    expect(await said('NIB-FULL-CODE')).toBe('That code has been used as many times as it can be.')
    expect(await said('NIB-BUSY-CODE')).toBe('That’s as many codes as Nib takes from one connection in a day. Try again tomorrow.')
    // No connection: said so, and this attempt's claim kept, to be counted once when it's tried again.
    expect(await said('NIB-AWAY-CODE')).toBe('Nib couldn’t reach its server. Try again when you’re online.')
    expect(Object.keys(JSON.parse(localStorage.getItem('nib-coin-claims')!))).toHaveLength(1)
    expect(market.getByText('300')).toBeTruthy()
  })

  it('asks before selling every repeat when legendary or mythic ones are among them', async () => {
    localStorage.setItem('nib-book', JSON.stringify([['2026-10-31', 191], ['2026-11-01', 191], ['2026-11-02', 191]]))
    await act(async () => void render(<App />))
    stillMotion()
    const library = within(document.querySelector<HTMLElement>('.nib-library')!)
    await userEvent.click(library.getByRole('button', { name: /^Market/ }))
    const market = within(screen.getByRole('dialog', { name: 'Market' }))
    await userEvent.dblClick(market.getByRole('button', { name: 'Sell all 2 repeats · +200' }))
    expect(market.getByText('That sells 2 legendary and mythic stamps too, keeping one of each.')).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('nib-trades')!).some((trade: { sold: number[] }) => trade.sold.length)).toBe(false)
    await userEvent.click(market.getByRole('button', { name: 'Sell all' }))
    expect(market.getByText('200')).toBeTruthy()
  })

  /** Coins to spend, as repeats sold before: a legendary is 100, got before, one more than were sold. */
  const points = (hundreds: number) => {
    localStorage.setItem('nib-trades', JSON.stringify([...JSON.parse(localStorage.getItem('nib-trades')!), { id: 'earlier', day: '2026-11-01', sold: Array<number>(hundreds).fill(191) }]))
    localStorage.setItem('nib-book', JSON.stringify([...JSON.parse(localStorage.getItem('nib-book') ?? '[]'), ...Array.from({ length: hundreds + 1 }, () => ['2026-10-31', 191])]))
  }

  it('never sells a stamp still to find: coins buy packs, not a stamp of your choosing', async () => {
    points(100)
    await act(async () => void render(<App />))
    await newNote()
    await command('Stampbook')
    await turnTo('Legendary')
    await userEvent.click(within(showing()).getByRole('button', { name: 'No. 192, still to find' }))
    const page = within(screen.getAllByRole('dialog').at(-1)!)
    expect(page.getByText('Still to find')).toBeTruthy()
    expect(page.queryByRole('button', { name: /^Buy/ })).toBeNull()
  })

  it('sells packs of 1, 3 and 10, five a week, each stamp at the odds, the rarest last', async () => {
    points(20)
    await act(async () => void render(<App />))
    stillMotion()
    await newNote()
    await command('Stampbook')
    await userEvent.click(within(stampbook()).getByRole('button', { name: 'Market · 2,000' }))
    const market = within(screen.getByRole('dialog', { name: 'Market' }))
    expect(market.getByText(/^5 of 5 packs left this week\./)).toBeTruthy()
    await userEvent.click(market.getByRole('button', { name: 'Buy a pack of 3 stamps for 150 coins' }))
    const pack = within(screen.getByRole('dialog', { name: 'A pack of 3' }))
    expect(pack.getByText('Tap it to open: 3 stamps, and any might be rare.')).toBeTruthy()
    // Its price on it, and put off, it isn't bought: Cancel, not Later.
    expect(pack.getByText('A pack of 3 · 150 coins')).toBeTruthy()
    expect(pack.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    await userEvent.click(pack.getByRole('button', { name: 'Open the pack' }))
    const trade = JSON.parse(localStorage.getItem('nib-trades')!).at(-1)
    expect(trade).toMatchObject({ kind: 'pack', spent: 150, day: '2026-11-04' })
    expect(trade.bought).toHaveLength(3)
    const rank = (no: number) => ['common', 'rare', 'unique', 'legendary', 'mythic'].indexOf(BOOK[no - 1].rarity)
    expect(trade.bought.map(rank)).toEqual([...trade.bought.map(rank)].sort((a, b) => a - b))
    for (const no of trade.bought) expect(pack.getAllByText(BOOK[no - 1].name).length).toBeGreaterThan(0)
    // No prompt: it isn't the day's.
    expect(pack.queryByRole('button', { name: 'Write from it' })).toBeNull()
    await userEvent.click(pack.getByRole('button', { name: 'Done' }))
    expect(market.getByText('1,850')).toBeTruthy()
    expect(market.getByText(/^4 of 5 packs left this week\./)).toBeTruthy()

    for (let i = 0; i < 4; i++) {
      await userEvent.click(market.getByRole('button', { name: 'Buy a pack of 1 stamp for 50 coins' }))
      await userEvent.click(screen.getByRole('button', { name: 'Open the pack' }))
      await userEvent.click(within(screen.getByRole('dialog', { name: 'A pack of 1' })).getByRole('button', { name: 'Done' }))
    }
    expect(market.getByText(/^No packs left this week\. More on Monday\./)).toBeTruthy()
    for (const size of ['1 stamp for 50', '3 stamps for 150', '10 stamps for 500']) expect(market.getByRole('button', { name: `Buy a pack of ${size} coins` }).hasAttribute('disabled')).toBe(true)
  })

  it('draws today’s stamp again, in place of the one there was', async () => {
    points(1)
    await act(async () => void render(<App />))
    stillMotion()
    await newNote()
    await command('Stampbook')
    await userEvent.click(within(stampbook()).getByRole('button', { name: 'Market · 100' }))
    const market = within(screen.getByRole('dialog', { name: 'Market' }))
    expect(market.getByText('A new draw in place of today’s. 10 of 10 left this week.')).toBeTruthy()
    await userEvent.click(market.getByRole('button', { name: 'Re-roll · 50' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Today’s stamp, again' })).getByRole('button', { name: 'Open the pack' }))
    const trade = JSON.parse(localStorage.getItem('nib-trades')!).at(-1)
    // Today's was 7, which was had twice: one goes back.
    expect(trade).toMatchObject({ kind: 'reroll', spent: 50, gave: [7] })
    const again = within(screen.getByRole('dialog', { name: 'Today’s stamp, again' }))
    expect(again.getByText(BOOK[trade.bought[0] - 1].name)).toBeTruthy()
    await userEvent.click(again.getByRole('button', { name: 'Done' }))
    expect(market.getByText('A new draw in place of today’s. 9 of 10 left this week.')).toBeTruthy()
    expect(market.getByText('50')).toBeTruthy()
  })

  it('opens Plus’s features for days bought with points, though not as the subscription', async () => {
    points(5)
    await act(async () => void render(<App />))
    stillMotion()
    await newNote()
    await userEvent.keyboard('{Meta>}k{/Meta}')
    expect((await screen.findByRole('button', { name: /^Start a sprint…/ })).textContent).toBe('Start a sprint…Plus')
    await userEvent.keyboard('{Escape}')
    await command('Stampbook')
    await userEvent.click(within(stampbook()).getByRole('button', { name: 'Market · 500' }))
    const market = within(screen.getByRole('dialog', { name: 'Market' }))
    // A day 500, a week 3,000, two weeks 6,500, a month 13,000.
    expect(market.getByRole('button', { name: '1 week of Nib Plus for 3,000 coins' }).hasAttribute('disabled')).toBe(true)
    expect(market.getByRole('button', { name: '2 weeks of Nib Plus for 6,500 coins' })).toBeTruthy()
    expect(market.getByRole('button', { name: '1 month of Nib Plus for 13,000 coins' })).toBeTruthy()
    // Asked first: a double tap on the length only asks.
    await userEvent.dblClick(market.getByRole('button', { name: '1 day of Nib Plus for 500 coins' }))
    expect(market.getByText('1 day of Plus’s features for 500 coins?')).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('nib-trades')!).some((trade: { kind?: string }) => trade.kind === 'plus')).toBe(false)
    await userEvent.click(market.getByRole('button', { name: 'Buy' }))
    const tomorrow = (form: Intl.DateTimeFormatOptions) => new Date(Date.now() + 86_400_000).toLocaleString(undefined, { ...form, year: 'numeric', hour: 'numeric', minute: '2-digit' })
    expect(market.getByText(`Yours till ${tomorrow({ day: 'numeric', month: 'long' })}`)).toBeTruthy()
    expect(market.getByText('0')).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('nib-trades')!).at(-1)).toMatchObject({ kind: 'plus', spent: 500, days: 1 })
    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('{Escape}')

    // A Plus feature, open.
    await userEvent.keyboard('{Meta>}k{/Meta}')
    expect((await screen.findByRole('button', { name: /^Start a sprint…/ })).textContent).toBe('Start a sprint…')
    expect(screen.getByRole('button', { name: 'Start a 15-minute sprint' })).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    // Billing knows it isn't the subscription.
    await userEvent.click(screen.getByRole('button', { name: 'Notes' }))
    await userEvent.click(within(document.querySelector<HTMLElement>('.nib-library')!).getByRole('button', { name: 'Settings' }))
    expect(within(await screen.findByRole('dialog', { name: 'Settings' })).getByText(`Until ${tomorrow({ day: 'numeric', month: 'short' })}`)).toBeTruthy()
  })

  it('opens from the library: the Stampbook, and the market with the points there are', async () => {
    points(1)
    await act(async () => void render(<App />))
    stillMotion()
    const library = within(document.querySelector<HTMLElement>('.nib-library')!)
    await userEvent.click(library.getByRole('button', { name: 'Stampbook' }))
    expect(stampbook()).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(library.getByRole('button', { name: 'Market, 100 coins' }))
    const market = within(screen.getByRole('dialog', { name: 'Market' }))
    expect(market.getByText('100')).toBeTruthy()
  })

  it('keeps first steps’, Nib’s birthday’s and the Christmas calendar’s stamps on a page of their own, each opening to its page', async () => {
    localStorage.setItem('nib-stamps', JSON.stringify(['2025-12-02', '2025-12-05', '2026-11-04']))
    localStorage.setItem('nib-doors-late', JSON.stringify({ '2025-12-02': '2025-12-04' }))
    localStorage.setItem('nib-birthday', JSON.stringify([2026]))
    await act(async () => void render(<App />))
    await newNote()
    await command('Stampbook')
    await turnTo('Keepsakes')
    const keepsakes = within(showing())
    expect(keepsakes.getByText('3 of 32 found')).toBeTruthy()
    expect(keepsakes.getByRole('button', { name: 'Nib’s birthday' }).querySelector('svg')?.getAttribute('aria-label')).toBe('A birthday cake, Jun 12')
    expect(keepsakes.getByRole('button', { name: 'Door 2' }).querySelector('svg')?.getAttribute('aria-label')).toMatch(/^A bright star, /)
    expect(keepsakes.getByRole('button', { name: 'Door 3, still to find' }).textContent).toBe('Dec 3')

    const page = () => within(screen.getAllByRole('dialog').at(-1)!)
    const on = (date: number) => new Date(2025, 11, date).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
    await userEvent.click(keepsakes.getByRole('button', { name: 'Door 2' }))
    expect(page().getByText(`Opened on ${on(4)}, with that day’s pack.`)).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Door 2')
    await userEvent.click(keepsakes.getByRole('button', { name: 'Door 3, still to find' }))
    expect(page().getByText(`It opens on ${new Date(2026, 11, 3).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })}, with that day’s pack.`)).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(keepsakes.getByRole('button', { name: 'Nib’s birthday' }))
    expect(page().getByText(`Kept on ${longDate(new Date(2026, 5, 12))}.`)).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(keepsakes.getByRole('button', { name: 'First steps, still to find' }))
    expect(page().getByText('Yours when the four first steps are done.')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    // The milestones and special days, still to find: a year from the first stamp, and the days to come.
    await userEvent.click(keepsakes.getByRole('button', { name: 'A year with Nib, still to find' }))
    expect(page().getByText(`Yours on ${longDate(new Date(2026, 11, 2))}, a year from your first stamp or your oldest writing.`)).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(keepsakes.getByRole('button', { name: 'A rarity completed, still to find' }))
    expect(page().getByText('Yours the first time you find every stamp of one rarity, from common to mythic.')).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    expect(keepsakes.getByRole('button', { name: 'World Book Day, still to find' }).textContent).toBe(new Date(2028, 3, 23).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))
    await userEvent.click(keepsakes.getByRole('button', { name: 'Leap day, still to find' }))
    const leap = new Date(2028, 1, 29).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
    expect(page().getByText(`Open Nib on ${leap}, the next in 2028, and the day’s pack holds it.`)).toBeTruthy()
  })

  it('keeps a year with Nib, a rarity completed and the special days found, each on its page', async () => {
    // First stamped on World Book Day last year; every mythic stamp found, the last on the 3rd; today's pack opened.
    localStorage.setItem('nib-stamps', JSON.stringify(['2025-04-23', '2026-11-01', '2026-11-04']))
    const mythic = BOOK.filter((entry) => entry.rarity === 'mythic').map((entry) => entry.no)
    const days = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']
    localStorage.setItem('nib-book', JSON.stringify([...mythic.map((no, i) => [days[i], no]), ['2026-11-04', 7]]))
    await act(async () => void render(<App />))
    await newNote()
    await command('Stampbook')
    await turnTo('Keepsakes')
    const keepsakes = within(showing())
    expect(keepsakes.getByText('3 of 32 found')).toBeTruthy()
    expect(keepsakes.getByRole('button', { name: 'A year with Nib' }).querySelector('svg')?.getAttribute('aria-label')).toMatch(/^Rings in a tree stump, /)
    expect(keepsakes.getByRole('button', { name: 'A rarity completed' }).querySelector('svg')?.getAttribute('aria-label')).toMatch(/^A rosette, /)
    expect(keepsakes.getByRole('button', { name: 'World Book Day' }).querySelector('svg')?.getAttribute('aria-label')).toMatch(/^A book with a bookmark, /)
    const page = () => within(screen.getAllByRole('dialog').at(-1)!)
    await userEvent.click(keepsakes.getByRole('button', { name: 'A year with Nib' }))
    expect(page().getByText(`A year from your first stamp or your oldest writing, on ${longDate(new Date(2026, 3, 23))}.`)).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(keepsakes.getByRole('button', { name: 'A rarity completed' }))
    expect(page().getByText(`Every mythic stamp found, the last on ${longDate(new Date(2026, 10, 3))}.`)).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(keepsakes.getByRole('button', { name: 'World Book Day' }))
    expect(page().getByText(`For the books, and everyone who reads them. Kept on ${longDate(new Date(2025, 3, 23))}.`)).toBeTruthy()
  })
})

describe('A holiday’s stamp', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('comes in the day’s pack, as well as its one, with the holiday’s prompt', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-31T10:00:00') })
    coinsCollected()
    await act(async () => void render(<App />))
    stillMotion()
    expect(within(await arrives()).getByText('Today’s pack · Halloween')).toBeTruthy()
    const pack = await openPack()
    const stamps = pack.getAllByRole('img')
    expect(stamps).toHaveLength(2)
    expect(stamps[0].getAttribute('aria-label')).toBe('A jack-o’-lantern, Oct 31')
    expect(pack.getByText('Halloween')).toBeTruthy()
    expect(pack.getByText('Write something that frightens you a little.')).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('nib-stamps')!)).toEqual(['2026-10-31'])
    expect(book()).toHaveLength(1)
  })

  it('and a keepsake day’s pack holds its own, kept with the keepsakes', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2027-04-23T10:00:00') })
    coinsCollected()
    await act(async () => void render(<App />))
    stillMotion()
    expect(within(await arrives()).getByText('Today’s pack · World Book Day')).toBeTruthy()
    const pack = await openPack()
    const stamps = pack.getAllByRole('img')
    expect(stamps).toHaveLength(2)
    expect(stamps[0].getAttribute('aria-label')).toMatch(/^A book with a bookmark, /)
    expect(pack.getByText('World Book Day')).toBeTruthy()
    expect(pack.getByText('Keepsake')).toBeTruthy()
    expect(pack.getByText('Write about the book you’ve given away most.')).toBeTruthy()
  })
})

describe('Nib’s birthday', () => {
  afterEach(() => {
    vi.useRealTimers()
  })
  const present = () => screen.queryByRole('button', { name: 'A birthday present' })
  const twelfth = new Date(2027, 5, 12).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
  const birthdayCard = () => screen.queryByRole('dialog', { name: 'A birthday present' })

  it('brings a present on 12 June, for opening Nib, with confetti and a stamp to keep', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2027-06-12T10:00:00') })
    coinsCollected()
    await act(async () => void render(<App />))
    await later()
    await newNote()
    await userEvent.click(present()!)
    const card = within(birthdayCard()!)
    expect(card.getByText(`Today, ${twelfth}, is the birthday of the one who made Nib. To celebrate, a stamp you won’t find anywhere else, yours to keep.`)).toBeTruthy()
    const stamp = card.getByRole('img', { name: 'A birthday cake, Jun 12' })
    expect(stamp.getAttribute('data-rarity')).toBe('mythic')
    expect(document.querySelector('[data-confetti]')!.children.length).toBeGreaterThan(0)
    expect(present()).toBeNull()
    expect(JSON.parse(localStorage.getItem('nib-birthday')!)).toEqual([2027])

    // Kept in the Stampbook.
    await userEvent.click(card.getByRole('button', { name: 'Stampbook' }))
    expect(birthdayCard()).toBeNull()
    expect(within(screen.getByRole('dialog', { name: 'Stampbook' })).getByRole('button', { name: /^Keepsakes, 1 of 32 found, / })).toBeTruthy()

    // Opened, it doesn't come again that day.
    cleanup()
    await act(async () => void render(<App />))
    await later()
    await newNote()
    expect(present()).toBeNull()

    // The next 12 June it does, to celebrate again.
    cleanup()
    vi.setSystemTime(new Date('2028-06-12T10:00:00'))
    coinsCollected()
    await act(async () => void render(<App />))
    await later()
    await newNote()
    await userEvent.click(present()!)
    expect(within(birthdayCard()!).getByText(/you’re here to celebrate again\. Your cake stamp, from 2027, is in the Stampbook, with the keepsakes\.$/)).toBeTruthy()
    expect(JSON.parse(localStorage.getItem('nib-birthday')!)).toEqual([2027, 2028])
  })

  it('isn’t there the day before, and lets no confetti fall with Motion turned down', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2027-06-11T10:00:00') })
    coinsCollected()
    await act(async () => void render(<App />))
    await later()
    await newNote()
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(present()).toBeNull()
    cleanup()
    vi.setSystemTime(new Date('2027-06-12T10:00:00'))
    coinsCollected()
    await act(async () => void render(<App />))
    await later()
    await newNote()
    document.documentElement.dataset.motion = 'none'
    onTestFinished(() => void delete document.documentElement.dataset.motion)
    await userEvent.click(present()!)
    expect(birthdayCard()).not.toBeNull()
    expect(document.querySelector('[data-confetti]')).toBeNull()
    await userEvent.keyboard('{Escape}')
    expect(birthdayCard()).toBeNull()
  })
})

describe('In December', () => {
  // Only the date is the 5th of December; timers run as ever.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-12-05T10:00:00') })
    coinsCollected()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('a day’s pack opens its door, and the latest one missed, and leads to the calendar, where today’s door swings open', async () => {
    localStorage.setItem('nib-stamps', JSON.stringify(['2026-12-01', '2026-12-02']))
    await act(async () => void render(<App />))
    stillMotion()
    expect(within(await arrives()).getByText('Today’s pack · Door 5')).toBeTruthy()
    // Three in it, and it says so: it said one more where three came.
    expect(within(await arrives()).getByText('Tap it to open: the day’s own stamp, a door you missed, one more, and it might be rare.')).toBeTruthy()
    const pack = await openPack()
    expect(pack.getByText('Door 5')).toBeTruthy()
    expect(pack.getByText('Door 4, missed')).toBeTruthy()
    expect(
      pack
        .getAllByRole('img')
        .slice(0, 2)
        .map((stamp) => stamp.getAttribute('aria-label')),
    ).toEqual([expect.stringMatching(/^A mitten, /), expect.stringMatching(/^A Christmas tree, /)])
    expect(JSON.parse(localStorage.getItem('nib-stamps')!)).toEqual(['2026-12-01', '2026-12-02', '2026-12-04', '2026-12-05'])
    // Kept, for the door's page: opened on the 5th, not its own day.
    expect(JSON.parse(localStorage.getItem('nib-doors-late')!)).toEqual({ '2026-12-04': '2026-12-05' })
    expect(pack.queryByRole('button', { name: 'Stampbook' })).toBeNull()
    await userEvent.click(pack.getByRole('button', { name: 'Christmas calendar' }))
    const calendar = screen.getByRole('dialog', { name: 'Christmas calendar' })
    expect(within(calendar).getByText(/doors open/).textContent).toMatch(/^4 of 24 doors open\. Today’s door is open\./)
    expect([...calendar.querySelectorAll('.nib-door[data-fresh] .nib-door-panel')].map((door) => door.textContent)).toEqual(['5'])
  })

  it('has the Christmas calendar in Commands, its doors as they stand', async () => {
    localStorage.setItem('nib-stamps', JSON.stringify(['2026-12-01', '2026-12-02', '2026-12-04']))
    await act(async () => void render(<App />))
    await later()
    await newNote()
    await command('Christmas calendar')
    const calendar = within(screen.getByRole('dialog', { name: 'Christmas calendar' }))
    expect(calendar.getByText(/doors open/).textContent).toBe('3 of 24 doors open. Today’s pack opens door 5. Each day’s pack in December also opens the latest door you’ve missed.')
    const doors = calendar.getAllByRole('button', { name: /^Door \d+, / }).map((door) => door.getAttribute('aria-label'))
    expect(doors).toHaveLength(24)
    expect(doors.slice(0, 6)).toEqual(['Door 1, open', 'Door 2, open', 'Door 3, missed', 'Door 4, open', 'Door 5, opens with today’s pack', 'Door 6, still to come'])
    expect(calendar.getAllByRole('img', { name: /, Dec|Dec \d|\d Dec/ }).map((stamp) => stamp.getAttribute('aria-label')!.split(',')[0])).toEqual(['A snowflake', 'A bright star', 'A Christmas tree'])
    expect(document.activeElement?.closest('[role="dialog"]')?.getAttribute('aria-label')).toBe('Christmas calendar')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('stands its doors on a winter scene, each in its stamp’s pattern and today’s tied with a ribbon, and opens each to a page', async () => {
    localStorage.setItem('nib-stamps', JSON.stringify(['2026-12-01', '2026-12-02', '2026-12-04']))
    localStorage.setItem('nib-doors-late', JSON.stringify({ '2026-12-02': '2026-12-04' }))
    await act(async () => void render(<App />))
    await later()
    await newNote()
    await command('Christmas calendar')
    const dialog = screen.getByRole('dialog', { name: 'Christmas calendar' })
    const calendar = within(dialog)
    expect(dialog.querySelector('[data-scene]')).not.toBeNull()
    expect([...dialog.querySelectorAll('[data-ribbon]')].map((ribbon) => ribbon.closest('button')!.getAttribute('aria-label'))).toEqual(['Door 5, opens with today’s pack'])
    expect(calendar.getByRole('button', { name: 'Door 6, still to come' }).querySelector('pattern')).not.toBeNull()

    const page = () => within(screen.getAllByRole('dialog').at(-1)!)
    const on = (date: number) => new Date(2026, 11, date).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
    await userEvent.click(calendar.getByRole('button', { name: 'Door 2, open' }))
    expect(page().getByText(`Door 2 · ${on(2)}`)).toBeTruthy()
    expect(page().getByText('A bright star')).toBeTruthy()
    expect(page().getByText(`Opened on ${on(4)}, with that day’s pack.`)).toBeTruthy()
    expect(page().getByText(WINTER_PROMPTS[1])).toBeTruthy()
    expect(page().getByRole('img').getAttribute('aria-label')).toMatch(/^A bright star, /)
    await userEvent.keyboard('{Escape}')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Door 2, open')

    await userEvent.click(calendar.getByRole('button', { name: 'Door 1, open' }))
    expect(page().getByText(`Opened on ${on(1)}.`)).toBeTruthy()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(calendar.getByRole('button', { name: 'Door 3, missed' }))
    expect(page().getByText('Missed')).toBeTruthy()
    expect(page().getByText('Each day’s pack in December opens the latest door missed.')).toBeTruthy()
    expect(page().queryByText(WINTER_PROMPTS[2])).toBeNull()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(calendar.getByRole('button', { name: 'Door 5, opens with today’s pack' }))
    expect(page().getByText('Today’s door')).toBeTruthy()
    expect(page().getByText('Today’s pack opens it.')).toBeTruthy()
    expect(page().getByText(WINTER_PROMPTS[4])).toBeTruthy()
    expect(page().queryByRole('img')).toBeNull()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(calendar.getByRole('button', { name: 'Door 6, still to come' }))
    expect(page().getByText(`It opens on ${on(6)}, with that day’s pack.`)).toBeTruthy()
    expect(page().queryByText(WINTER_PROMPTS[5])).toBeNull()
    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()

    // A door's page from the Stampbook's keepsakes, too.
    await command('Stampbook')
    const stampbook = within(screen.getByRole('dialog', { name: 'Stampbook' }))
    await userEvent.click(stampbook.getByRole('button', { name: /^Keepsakes, / }))
    await userEvent.click(stampbook.getByRole('button', { name: 'Door 2' }))
    expect(page().getByText(`Opened on ${on(4)}, with that day’s pack.`)).toBeTruthy()
  })

  it('isn’t in Commands outside December', async () => {
    vi.setSystemTime(new Date('2026-11-30T10:00:00'))
    // The 5th's coins, from before each, would be a day later than this one: nothing would come.
    localStorage.removeItem('nib-trades')
    coinsCollected()
    await act(async () => void render(<App />))
    await later()
    await newNote()
    await userEvent.keyboard('{Meta>}k{/Meta}')
    expect(screen.queryByRole('button', { name: /^Christmas calendar/ })).toBeNull()
  })

  it('has a present waiting after Christmas for a December with a door opened: the gold stamp, snow, and a look back', async () => {
    vi.setSystemTime(new Date('2026-12-26T10:00:00'))
    coinsCollected()
    localStorage.setItem('nib-stamps', JSON.stringify(['2026-12-03', '2026-12-10']))
    localStorage.setItem('nib-goal-calendar', JSON.stringify({ '2026-12-03': 120, '2026-12-10': 300 }))
    await act(async () => void render(<App />))
    await later()
    await newNote()
    await userEvent.click(screen.getByRole('button', { name: 'A Christmas present' }))
    const card = within(screen.getByRole('dialog', { name: 'Happy Christmas' }))
    expect(card.getByRole('img').getAttribute('aria-label')).toMatch(/^A gold star for Christmas Day, /)
    expect(card.getByText(/^You wrote/).textContent).toBe('You wrote 420 words on 2 days, and opened 2 of 24 doors.')
    expect(document.querySelector('[data-snow]')!.children.length).toBeGreaterThan(0)
    // Given: Christmas Day's stamp is in the album, and the present is opened for good.
    expect(JSON.parse(localStorage.getItem('nib-stamps')!)).toEqual(['2026-12-03', '2026-12-10', '2026-12-25'])
    expect(screen.queryByRole('button', { name: 'A Christmas present' })).toBeNull()
    // And Winter, to keep: tried on here.
    await userEvent.click(card.getByRole('button', { name: 'Try Winter' }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('winter'))
    expect(card.queryByRole('button', { name: 'Try Winter' })).toBeNull()
    await userEvent.click(card.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('[data-snow]')).toBeNull()
    cleanup()
    await act(async () => void render(<App />))
    await later()
    await newNote()
    expect(screen.queryByRole('button', { name: 'A Christmas present' })).toBeNull()
  })

  it('opened on the day itself, still leaves the day’s pack to open', async () => {
    vi.setSystemTime(new Date('2026-12-25T10:00:00'))
    coinsCollected()
    localStorage.setItem('nib-stamps', JSON.stringify(['2026-12-03']))
    await act(async () => void render(<App />))
    await later()
    await newNote()
    await userEvent.click(screen.getByRole('button', { name: 'A Christmas present' }))
    await userEvent.click(within(card()!).getByRole('button', { name: 'Close' }))
    expect(waitingPack()).not.toBeNull()
  })

  it('has no present before the 25th, nor for a December without a door', async () => {
    vi.setSystemTime(new Date('2026-12-24T10:00:00'))
    coinsCollected()
    localStorage.setItem('nib-stamps', JSON.stringify(['2026-12-03']))
    await act(async () => void render(<App />))
    await later()
    await newNote()
    expect(screen.queryByRole('button', { name: 'A Christmas present' })).toBeNull()
    cleanup()
    vi.setSystemTime(new Date('2026-12-26T10:00:00'))
    coinsCollected()
    localStorage.setItem('nib-stamps', JSON.stringify(['2026-11-30']))
    await act(async () => void render(<App />))
    await later()
    await newNote()
    expect(screen.queryByRole('button', { name: 'A Christmas present' })).toBeNull()
  })

  it('lets no snow fall with Motion turned down, and leads to the calendar', async () => {
    vi.setSystemTime(new Date('2026-12-25T10:00:00'))
    coinsCollected()
    localStorage.setItem('nib-stamps', JSON.stringify(['2026-12-03']))
    await act(async () => void render(<App />))
    await later()
    await newNote()
    // Customize → Motion: None, as lib/look's applyLook puts it on the page.
    document.documentElement.dataset.motion = 'none'
    onTestFinished(() => void delete document.documentElement.dataset.motion)
    await userEvent.click(screen.getByRole('button', { name: 'A Christmas present' }))
    expect(card()).not.toBeNull()
    expect(document.querySelector('[data-snow]')).toBeNull()
    expect(within(card()!).getByText(/^You opened/).textContent).toBe('You opened 1 of 24 doors.')
    await userEvent.click(within(card()!).getByRole('button', { name: 'Christmas calendar' }))
    expect(card()).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Christmas calendar' })).toBeTruthy()
  })

  it('has Winter among the themes only once a present has given it, and keeps it after', async () => {
    vi.setSystemTime(new Date('2026-12-26T10:00:00'))
    coinsCollected()
    const themes = async () => {
      await userEvent.click(within(document.querySelector<HTMLElement>('.nib-library')!).getByRole('button', { name: 'Settings' }))
      const names = within(await screen.findByRole('radiogroup', { name: 'Themes' }))
        .getAllByRole('radio')
        .map((theme) => theme.textContent)
      await userEvent.click(screen.getByRole('button', { name: 'Done' }))
      return names
    }
    const searched = async () => {
      await userEvent.keyboard('{Meta>}k{/Meta}')
      await userEvent.keyboard('Winter')
      const found = screen.queryByRole('button', { name: /^Appearance: Winter/ })
      await userEvent.keyboard('{Escape}')
      return found !== null
    }
    await act(async () => void render(<App />))
    await later()
    expect(await themes()).not.toContain('Winter')
    expect(await searched()).toBe(false)
    cleanup()
    // A present opened, last Christmas: Winter, all year.
    localStorage.setItem('nib-christmas', JSON.stringify([2026]))
    vi.setSystemTime(new Date('2027-03-01T10:00:00'))
    coinsCollected()
    await act(async () => void render(<App />))
    await later()
    expect(await themes()).toContain('Winter')
    expect(await searched()).toBe(true)
  })
})

const card = () => screen.queryByRole('dialog', { name: 'Happy Christmas' })
