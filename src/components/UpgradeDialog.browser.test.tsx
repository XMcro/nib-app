import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { cleanup, render, screen } from '@testing-library/react'
import type { PlusProduct } from '../lib/plus'
import '../index.css'

/**
 * The popup laid out for real, with Nib's own stylesheet: a sheet on a phone,
 * one column on an iPad held upright, two on a wide screen, and the way to
 * buy always on screen without scrolling.
 */

const store = vi.hoisted(() => ({ products: vi.fn(), purchase: vi.fn(), restore: vi.fn() }))
vi.mock('../lib/plus', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/plus')>()),
  store,
}))

const { UpgradeDialog } = await import('./UpgradeDialog')
const { PlusWelcome } = await import('./PlusWelcome')

const PRODUCTS: PlusProduct[] = [
  { id: 'app.nib.plus.monthly', displayName: 'Monthly', displayPrice: '$3.99', price: 3.99, currency: 'USD', period: 'month', trialDays: 14 },
  { id: 'app.nib.plus.yearly', displayName: 'Yearly', displayPrice: '$29.99', price: 29.99, currency: 'USD', period: 'year', trialDays: 14 },
]

const root = document.documentElement
const box = (element: Element) => element.getBoundingClientRect()
// The popup rises in; read where it settles.
const settled = () => document.getAnimations().forEach((animation) => animation.finish())

async function open(width: number, height: number) {
  await page.viewport(width, height)
  store.products.mockResolvedValue({ products: PRODUCTS })
  render(<UpgradeDialog onEntitlement={() => {}} onClose={() => {}} />)
  const buy = await screen.findByRole('button', { name: 'Try it free for 14 days' })
  settled()
  const dialog = screen.getByRole('dialog')
  // Never wider than the screen, and nothing inside wider than the popup.
  expect(box(dialog).left).toBeGreaterThanOrEqual(0)
  expect(box(dialog).right).toBeLessThanOrEqual(innerWidth)
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth)
  // The way to buy is on screen as it opens, whatever scrolls above it.
  expect(box(buy).bottom).toBeLessThanOrEqual(innerHeight)
  expect(box(buy).top).toBeGreaterThan(box(dialog).top)
  return { dialog, buy, side: screen.getByText('Make Nib entirely yours') }
}

afterEach(() => {
  cleanup()
  root.classList.remove('dark')
})

describe('the upgrade popup', () => {
  it('is a sheet from the bottom edge on a phone', async () => {
    const { dialog, side } = await open(390, 844)
    expect(box(dialog).width).toBe(390)
    expect(box(dialog).bottom).toBe(844)
    expect(side.checkVisibility()).toBe(false)
  })

  it('is one centred column on an iPad held upright', async () => {
    const { dialog, side } = await open(820, 1180)
    expect(box(dialog).width).toBe(520)
    expect(Math.round(box(dialog).left)).toBe(150)
    expect(side.checkVisibility()).toBe(false)
  })

  it('puts the looks beside the price on a wide screen, all of it in view', async () => {
    const { dialog, buy, side } = await open(1280, 800)
    expect(box(dialog).width).toBe(960)
    expect(side.checkVisibility()).toBe(true)
    expect(box(side).right).toBeLessThanOrEqual(box(buy).left)
    expect(box(dialog).top).toBeGreaterThanOrEqual(0)
    expect(box(dialog).bottom).toBeLessThanOrEqual(800)
  })

  // Its colours are Nib's own addition, so held to the same 4.5:1 as text anywhere.
  it.each(['light', 'dark'])('reads at 4.5:1 or more in %s', async (mode) => {
    if (mode === 'dark') root.classList.add('dark')
    await open(1280, 800)
    const rgb = (color: string) => color.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number)
    const luminance = (color: string) => {
      const [r, g, b] = rgb(color).map((v) => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const contrast = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
      return (hi + 0.05) / (lo + 0.05)
    }
    const color = (name: string) => {
      const probe = document.createElement('span')
      probe.style.color = `var(--color-${name})`
      document.body.append(probe)
      const value = getComputedStyle(probe).color
      probe.remove()
      return value
    }
    const buy = screen.getByRole('button', { name: 'Try it free for 14 days' })
    expect(contrast(getComputedStyle(buy).color, getComputedStyle(buy).backgroundColor), 'the button').toBeGreaterThanOrEqual(4.5)
    expect(contrast(color('plus-ink'), color('plus-wash')), 'blue text on the wash').toBeGreaterThanOrEqual(4.5)
    expect(contrast(color('plus-ink'), color('paper')), 'blue text on the page').toBeGreaterThanOrEqual(4.5)
    // The badge's graphite side, and the New on its glow.
    const graphite = 'rgb(24, 24, 28)'
    expect(contrast(getComputedStyle(screen.getByText('For iPhone, iPad and Mac')).color, graphite), 'grey text on the graphite').toBeGreaterThanOrEqual(4.5)
    for (const stop of ['rgb(101, 174, 254)', 'rgb(152, 125, 248)']) {
      expect(contrast(getComputedStyle(screen.getAllByText('New')[0]).color, stop), 'New on the glow').toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('the welcome', () => {
  afterEach(() => document.querySelectorAll('[data-plus-badge], [data-plus-landing]').forEach((badge) => badge.remove()))

  // Where the library's footer has it on a wide screen.
  function libraryBadge() {
    const badge = document.createElement('img')
    badge.dataset.plusBadge = ''
    badge.style.cssText = 'position: fixed; left: 24px; bottom: 18px; width: 14px; height: 14px'
    document.body.append(badge)
    return badge
  }

  it('lands the badge, flicks the ink and draws the line', async () => {
    render(<PlusWelcome onDone={() => {}} />)
    const welcome = screen.getByRole('status')
    const running = (element: Element) => element.getAnimations().some((animation) => animation.playState === 'running')
    const ink = [...welcome.querySelectorAll('.nib-welcome-drop')]
    expect(running(welcome.querySelector('img')!), 'the badge').toBe(true)
    expect(ink.length).toBeGreaterThan(0)
    expect(ink.every(running), 'the ink').toBe(true)
    expect(running(welcome.querySelector('svg path')!), 'the line').toBe(true)
  })

  it('then flies the badge down onto the library’s, which waits unseen till it lands', async () => {
    await page.viewport(1280, 800)
    const target = libraryBadge()
    const onDone = vi.fn()
    render(<PlusWelcome onDone={onDone} />)
    expect(getComputedStyle(target).visibility).toBe('hidden')
    const flier = screen.getByRole('status').querySelector('img')!
    screen.getByRole('status').click()
    const flight = flier.getAnimations().find((animation) => !(animation instanceof CSSAnimation))!
    flight.finish()
    const [landed, spot] = [box(flier), box(target)]
    expect(Math.abs(landed.left - spot.left)).toBeLessThan(1)
    expect(Math.abs(landed.top - spot.top)).toBeLessThan(1)
    expect(Math.abs(landed.width - spot.width)).toBeLessThan(1)
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    cleanup()
    expect(getComputedStyle(target).visibility).toBe('visible')
  })

  // Bought while writing, the library put away: in where Customize is, the
  // gear beside the text (App), fading as it goes in.
  it('flies into the gear instead, with the library put away', async () => {
    await page.viewport(1280, 800)
    const shut = document.createElement('div')
    shut.inert = true
    shut.append(libraryBadge())
    document.body.append(shut)
    const gear = document.createElement('button')
    gear.dataset.plusLanding = ''
    gear.style.cssText = 'position: fixed; right: 12px; top: 12px; width: 32px; height: 32px'
    document.body.append(gear)
    const onDone = vi.fn()
    render(<PlusWelcome onDone={onDone} />)
    const flier = screen.getByRole('status').querySelector('img')!
    screen.getByRole('status').click()
    const flight = flier.getAnimations().find((animation) => !(animation instanceof CSSAnimation))!
    flight.finish()
    const [landed, spot] = [box(flier), box(gear)]
    expect(Math.abs(landed.left + landed.width / 2 - (spot.left + spot.width / 2))).toBeLessThan(1)
    expect(Math.abs(landed.top + landed.height / 2 - (spot.top + spot.height / 2))).toBeLessThan(1)
    expect(getComputedStyle(flier).opacity).toBe('0')
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledOnce())
    shut.remove()
  })

  it('only fades when the library is shut', async () => {
    await page.viewport(1280, 800)
    const target = libraryBadge()
    const shut = document.createElement('div')
    shut.inert = true
    shut.append(target)
    document.body.append(shut)
    render(<PlusWelcome onDone={() => {}} />)
    const flier = screen.getByRole('status').querySelector('img')!
    screen.getByRole('status').click()
    expect(flier.getAnimations().filter((animation) => !(animation instanceof CSSAnimation))).toHaveLength(0)
    expect(screen.getByRole('status').getAnimations().some((animation) => !(animation instanceof CSSAnimation))).toBe(true)
    shut.remove()
  })

  it('with motion off, shows only where it ends', async () => {
    root.style.setProperty('--m', '0')
    render(<PlusWelcome onDone={() => {}} />)
    const drop = document.querySelector('.nib-welcome-drop')!
    const line = document.querySelector('.nib-welcome-stroke path')!
    expect(getComputedStyle(drop).opacity).toBe('0')
    expect(getComputedStyle(line).strokeDashoffset).toBe('0px')
    expect(getComputedStyle(screen.getByRole('status')).opacity).toBe('1')
    root.style.removeProperty('--m')
  })
})
