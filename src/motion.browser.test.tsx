// The Playwright provider's types, for cdp()'s send (reduced motion below).
/// <reference types="@vitest/browser-playwright" />
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cdp, page } from 'vitest/browser'
import './index.css'

/**
 * The motion pack ported from Docs/Nib-animated.html. jsdom computes no styles
 * from a stylesheet, so none of this can be checked there — a broken selector
 * or a mistyped token would simply mean nothing animates, silently.
 */

function mount(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  return host.firstElementChild as HTMLElement
}

const styleOf = (element: Element) => getComputedStyle(element)

// The pack's own sizes are a wide window's.
beforeEach(() => page.viewport(1280, 800))
afterEach(() => document.body.replaceChildren())

describe('motion tokens', () => {
  // The whole system scales from one number, which is what makes it possible
  // to slow everything down at once to look at it.
  it('scales every duration from --m', () => {
    document.documentElement.style.setProperty('--m', '4')
    const library = mount('<div class="nib-library"></div>')
    expect(styleOf(library).transitionDuration).toContain('0.88s')
    document.documentElement.style.removeProperty('--m')
  })
})

describe('the animations the pack specifies', () => {
  // Always mounted over the text, so the list is where it was left.
  it('fades the library away, swelling a little, rather than unmounting it', () => {
    const open = styleOf(mount('<div class="nib-library" data-open="true"></div>'))
    expect(open.opacity).toBe('1')
    expect(open.visibility).toBe('visible')
    // Not a transform while open: it would hold the fixed New button and the held card.
    expect(open.transform).toBe('none')

    const shut = styleOf(mount('<div class="nib-library" data-open="false"></div>'))
    expect(shut.opacity).toBe('0')
    expect(shut.visibility).toBe('hidden')
    expect(shut.transform).not.toBe('none')
    // Hidden only once it has faded.
    expect(shut.transitionDelay).toBe('0s, 0s, 0.22s')
  })

  it('lifts the chrome out of the way in focus mode', () => {
    const shown = mount('<div class="nib-chrome" data-hidden="false"></div>')
    expect(styleOf(shown).opacity).toBe('1')

    const hidden = mount('<div class="nib-chrome" data-hidden="true"></div>')
    expect(styleOf(hidden).opacity).toBe('0')
    expect(styleOf(hidden).transform).not.toBe('none')
  })

  it('moves the theme knob one segment per index', () => {
    const at = (k: number) =>
      styleOf(mount(`<span class="nib-segknob" data-k="${k}" style="width:30px"></span>`)).transform

    expect(at(0)).toBe('none')
    expect(at(1)).not.toBe('none')
    expect(at(1)).not.toBe(at(2))
  })

  it('pops the palette in over a fading backdrop', () => {
    expect(styleOf(mount('<div class="nib-pop"></div>')).animationName).not.toBe('none')
    expect(styleOf(mount('<div class="nib-overlay"></div>')).animationName).not.toBe('none')
  })

})

describe('the library’s own motion', () => {
  it('brings the cards in one after another, once each', () => {
    const delay = (i: number) => parseFloat(styleOf(mount(`<div class="nib-card" style="--i: ${i}"></div>`)).animationDelay)
    expect(styleOf(mount('<div class="nib-card" style="--i: 3"></div>')).animationName).not.toBe('none')
    expect(delay(3)).toBeGreaterThan(delay(0))
    // Capped: a long list doesn't wait for its last card.
    expect(delay(400)).toBe(delay(40))
    expect(styleOf(mount('<div class="nib-card" data-arrived=""></div>')).animationName).toBe('none')
  })

  it('fades a card left behind while its copy is carried, which tilts, then flies off when let go', () => {
    expect(parseFloat(styleOf(mount('<div class="nib-card" data-held="" data-arrived=""></div>')).opacity)).toBeLessThan(1)
    const held = styleOf(mount('<div class="nib-held"></div>'))
    expect(held.animationName).not.toBe('none')
    expect(held.transform).not.toBe('none')
    const landing = styleOf(mount('<div class="nib-held" data-landing="into"></div>'))
    expect(parseFloat(landing.transitionDuration)).toBeGreaterThan(0)
  })

  it('swells a chip under a held card, gulps one let go in it, and bursts one just made', () => {
    expect(styleOf(mount('<button class="nib-chip" data-over=""></button>')).transform).not.toBe('none')
    expect(styleOf(mount('<button class="nib-chip" data-landed=""></button>')).animationName).not.toBe('none')
    const fresh = mount('<button class="nib-chip" data-fresh=""></button>')
    expect(styleOf(fresh).animationName).not.toBe('none')
    expect(getComputedStyle(fresh, '::before').animationName).not.toBe('none')
    expect(styleOf(mount('<button class="nib-chip"></button>')).animationName).toBe('none')
    expect(styleOf(mount('<span class="nib-count" data-rolled=""></span>')).animationName).not.toBe('none')
    expect(styleOf(mount('<span class="nib-count"></span>')).animationName).toBe('none')
  })

  // Library's PinIcon in its button, on a card (data-pinning while it plays).
  const pinned = (on: boolean) => `<button class="nib-pin"${on ? ' data-pinned=""' : ''}><svg><path></path><path></path></svg></button>`
  const playing = (pinning: 'in' | 'out') => mount(`<div class="nib-card" data-arrived="" data-pinning="${pinning}"><button></button>${pinned(pinning === 'in')}</div>`)

  it('leans an unpinned card’s pin and stands a pinned one up', () => {
    expect(styleOf(mount(pinned(false)).querySelector('svg')!).transform).not.toBe('none')
    expect(styleOf(mount(pinned(true)).querySelector('svg')!).transform).toBe('none')
    expect(styleOf(mount('<div class="nib-card" data-arrived=""></div>')).animationName).toBe('none')
  })

  it('presses the pin in as its card is lifted to the top, a ring going out round its point', () => {
    const card = playing('in')
    const pin = card.querySelector('.nib-pin')!
    expect(styleOf(card).animationName).not.toBe('none')
    expect(styleOf(card.querySelector('button')!).animationName).not.toBe('none')
    expect(styleOf(pin.querySelector('svg')!).animationName).not.toBe('none')
    const [head, point] = pin.querySelectorAll('path')
    expect(styleOf(head).animationName).not.toBe('none')
    expect(styleOf(point).animationName).not.toBe('none')
    const ring = getComputedStyle(pin, '::after')
    expect(ring.animationName).not.toBe('none')
    // The card's own ends last: its end takes data-pinning off (Library's Card).
    const cardEnds = parseFloat(styleOf(card).animationDuration)
    expect(cardEnds).toBeGreaterThan(0)
    expect(parseFloat(ring.animationDelay) + parseFloat(ring.animationDuration)).toBeLessThanOrEqual(cardEnds)
    expect(parseFloat(styleOf(pin.querySelector('svg')!).animationDuration)).toBeLessThanOrEqual(cardEnds)
  })

  it('pulls it out, lighter, when unpinned, with no ring', () => {
    const card = playing('out')
    const pin = card.querySelector('.nib-pin')!
    expect(styleOf(card).animationName).not.toBe('none')
    expect(styleOf(card.querySelector('button')!).animationName).toBe('none')
    expect(styleOf(pin.querySelector('svg')!).animationName).not.toBe('none')
    expect(getComputedStyle(pin, '::after').animationName).toBe('none')
    expect(parseFloat(styleOf(pin.querySelector('svg')!).animationDuration)).toBeLessThanOrEqual(parseFloat(styleOf(card).animationDuration))
  })

  // The states, not the travel: pinned at once, no ring.
  it('gives someone who asks for less motion the pin, not the press', async () => {
    await cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    try {
      const card = playing('in')
      const pin = card.querySelector('.nib-pin')!
      expect(styleOf(card).animationDuration).toBe('0.001s')
      expect(styleOf(pin.querySelector('svg')!).animationDuration).toBe('0.001s')
      expect(styleOf(pin.querySelector('path')!).animationDuration).toBe('0.001s')
      expect(getComputedStyle(pin, '::after').display).toBe('none')
    } finally {
      await cdp().send('Emulation.setEmulatedMedia', { features: [] })
    }
  })

  it('balls up a trashed card under a shadow it keeps at any size, and jolts Trash', () => {
    const toss = styleOf(mount('<div class="nib-toss"></div>'))
    expect(toss.position).toBe('fixed')
    expect(toss.filter).toContain('drop-shadow')
    expect(styleOf(mount('<div class="nib-ball"></div>')).backgroundImage).not.toBe('none')
    expect(styleOf(mount('<span class="nib-bin" data-jolted=""></span>')).animationName).not.toBe('none')
    expect(styleOf(mount('<span class="nib-bin"></span>')).animationName).toBe('none')
  })

  it('tumbles the trash’s notes in, in turn, and shreds one into strips of paper', () => {
    const delay = (i: number) => parseFloat(styleOf(mount(`<div class="nib-trash-row" style="--i: ${i}"></div>`)).animationDelay)
    expect(styleOf(mount('<div class="nib-trash-row" style="--i: 1"></div>')).animationName).not.toBe('none')
    expect(delay(1)).toBeGreaterThan(delay(0))
    expect(styleOf(mount('<div class="nib-trash-row" data-arrived=""></div>')).animationName).toBe('none')
    expect(styleOf(mount('<div class="nib-shreds"></div>')).position).toBe('fixed')
    expect(styleOf(mount('<div class="nib-strip"></div>')).position).toBe('absolute')
  })

  it('slides the Notes and Pages pill', () => {
    expect(styleOf(mount('<span class="nib-kindknob" data-k="0" style="position: absolute; width: 100px"></span>')).transform).toBe('none')
    expect(styleOf(mount('<span class="nib-kindknob" data-k="1" style="position: absolute; width: 100px"></span>')).transform).toBe('matrix(1, 0, 0, 1, 100, 0)')
  })

  it('stills it all with Motion at None, the cards’ turns included', () => {
    document.documentElement.dataset.motion = 'none'
    const card = styleOf(mount('<div class="nib-card" style="--i: 5"></div>'))
    expect(card.animationDuration).toBe('0s')
    expect(card.animationDelay).toBe('0s')
    expect(styleOf(mount('<button class="nib-chip" data-landed=""></button>')).animationDuration).toBe('0s')
    const pinning = playing('in')
    expect(styleOf(pinning).animationDuration).toBe('0s')
    expect(styleOf(pinning.querySelector('svg')!).animationDuration).toBe('0s')
    expect(getComputedStyle(pinning.querySelector('.nib-pin')!, '::after').animationDelay).toBe('0s')
    delete document.documentElement.dataset.motion
  })
})

describe('the second palette', () => {
  it.each(['nib-float', 'nib-notice', 'nib-swap'])('gives .%s its arrival', (name) => {
    const style = styleOf(mount(`<div class="${name}"></div>`))
    expect(style.animationName).not.toBe('none')
    // Filling forwards would leave the element the containing block of
    // anything fixed inside it, for good.
    expect(style.animationFillMode).toBe('backwards')
  })

  it('scales with --m like the rest', () => {
    document.documentElement.style.setProperty('--m', '2')
    expect(styleOf(mount('<div class="nib-float"></div>')).animationDuration).toBe('0.36s')
    document.documentElement.style.removeProperty('--m')
  })

  it('drops the [[ picker from the caret where the others rise', () => {
    const rise = (html: string) => styleOf(mount(html)).getPropertyValue('--rise').trim()
    expect(rise('<div class="nib-float"></div>')).toBe('')
    expect(rise('<div class="nib-float nib-link-picker"></div>')).toBe('-4px')
  })

  // The strike is drawn in, so it is always there, in no colour until ticked.
  it('draws a ticked item’s line in rather than landing it', () => {
    const list = mount(`<div class="nib-editor"><ul data-type="taskList">
      <li data-checked="false"><label><input type="checkbox"></label><div><p>Open</p></div></li>
      <li data-checked="true"><label><input type="checkbox" checked></label><div><p>Done</p></div></li>
    </ul></div>`)
    const [open, done] = list.querySelectorAll<HTMLElement>('li > div')
    for (const element of [open, done]) element.style.transition = 'none'
    expect(styleOf(open).textDecorationLine).toBe('line-through')
    expect(styleOf(open).textDecorationColor).toBe('rgba(0, 0, 0, 0)')
    expect(styleOf(done).textDecorationColor).toBe(styleOf(done).color)
    expect(styleOf(done).color).not.toBe(styleOf(open).color)

    open.style.removeProperty('transition')
    expect(styleOf(open).transitionProperty).toContain('text-decoration-color')
  })
})

describe('Customize’s Motion', () => {
  // The pack fixed these three; they answer to --m now, so None reaches them.
  it('stills everything, the pack’s own durations included', () => {
    document.documentElement.dataset.motion = 'none'
    expect(styleOf(mount('<span class="nib-segknob"></span>')).transitionDuration).toBe('0s')
    expect(styleOf(mount('<div class="nib-pop"></div>')).animationDuration).toBe('0s')
    expect(styleOf(mount('<div class="nib-overlay"></div>')).animationDuration).toBe('0s')
    expect(styleOf(mount('<div class="nib-swap"></div>')).animationDuration).toBe('0s')
    delete document.documentElement.dataset.motion
  })

  it('leaves the pack’s timings as they were by default', () => {
    expect(styleOf(mount('<span class="nib-segknob"></span>')).transitionDuration).toBe('0.32s')
    expect(styleOf(mount('<div class="nib-pop"></div>')).animationDuration).toBe('0.22s')
    expect(styleOf(mount('<div class="nib-overlay"></div>')).animationDuration).toBe('0.16s')
  })
})
