import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import source from '../../ios/App/NibShare/Page.js?raw'
import { startPicking } from './picker'

/**
 * Picking parts of a page by pointing (clipper/picker), in a real page, with
 * the page's reader beside it as the extension puts it there (Page.js).
 */

type Sent = { title: string; url: string; page: string; part: string }
let stage: HTMLElement
let picking: ReturnType<typeof startPicking>

const over = (element: Element) => element.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
const click = (element: Element) => {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true })
  element.dispatchEvent(event)
  return event
}
const bar = () => picking!.root.querySelector('.bar') as HTMLElement
const said = () => bar().querySelector('[role=status]')!.textContent
const button = (name: string) => [...bar().querySelectorAll('button')].find((one) => one.textContent === name) as HTMLButtonElement
/** What's outlined, and how: each of the picker's boxes, by the element it's drawn around. */
const outlined = () =>
  [...picking!.root.querySelectorAll<HTMLElement>('.box')]
    .map((box) => {
      const at = box.getBoundingClientRect()
      const around = [...stage.querySelectorAll<HTMLElement>('[id]')].find((element) => {
        const place = element.getBoundingClientRect()
        return Math.abs(place.left - 3 - at.left) < 1 && Math.abs(place.top - 3 - at.top) < 1 && Math.abs(place.width + 6 - at.width) < 1 && Math.abs(place.height + 6 - at.height) < 1
      })
      return `${around?.id}: ${box.classList.contains('picked') ? 'picked' : 'pointed'}`
    })
    .sort()

beforeEach(() => {
  ;(window as unknown as { NibPage: unknown }).NibPage = new Function(`${source}; return NibPage`)()
  stage = document.body.appendChild(document.createElement('div'))
  stage.innerHTML = `
    <h2 id="heading">Spring tides</h2>
    <p id="first">High water comes <a id="link" href="/tables">twice</a> a day.</p>
    <div id="box"><p id="inner">Inside the box.</p><ul id="list"><li id="moon">New moon</li></ul></div>
    <p id="styled" style="color: teal">Already has a style.</p>
    <div id="frame"><img id="picture" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="A picture"></div>`
})
afterEach(() => {
  picking?.finish()
  stage.remove()
})

describe('picking parts of a page', () => {
  it('outlines what’s pointed at, the block and not the word or link under the pointer; picks it at a click, and lets it go at another', () => {
    picking = startPicking(async () => ({ ok: true }))
    expect(said()).toBe('Click the parts of the page to keep.')
    expect(button('Save to Nib').disabled).toBe(true)
    over(document.getElementById('link')!)
    expect(outlined()).toEqual(['first: pointed'])
    over(document.getElementById('heading')!)
    expect(outlined()).toEqual(['heading: pointed'])

    // A link pointed at is picked, not followed; and the page's own listeners don't hear the click.
    const heard = vi.fn()
    document.getElementById('link')!.addEventListener('click', heard)
    const event = click(document.getElementById('link')!)
    expect(event.defaultPrevented).toBe(true)
    expect(heard).not.toHaveBeenCalled()
    expect(outlined()).toEqual(['first: picked'])
    expect(said()).toBe('1 part picked.')
    expect(button('Save to Nib').disabled).toBe(false)

    click(document.getElementById('heading')!)
    expect(said()).toBe('2 parts picked.')
    click(document.getElementById('first')!)
    expect(outlined()).toEqual(['first: pointed', 'heading: picked'])
    expect(said()).toBe('1 part picked.')
  })

  it('takes what’s picked inside a part into that part when it’s picked, and lets the whole part go at a click inside it', () => {
    picking = startPicking(async () => ({ ok: true }))
    click(document.getElementById('inner')!)
    click(document.getElementById('moon')!)
    expect(said()).toBe('2 parts picked.')
    // The box itself: its padding has nothing under the pointer but the box.
    click(document.getElementById('box')!)
    expect(said()).toBe('1 part picked.')
    expect(outlined()).toEqual(['box: picked'])
    click(document.getElementById('moon')!)
    expect(said()).toBe('Click the parts of the page to keep.')
    expect(outlined()).toEqual(['moon: pointed'])
  })

  it('keeps its outlines where their elements are as the page moves under them', async () => {
    picking = startPicking(async () => ({ ok: true }))
    click(document.getElementById('heading')!)
    expect(outlined()).toEqual(['heading: picked'])
    stage.style.marginTop = '80px'
    await vi.waitFor(() => expect(outlined()).toEqual(['heading: picked']))
    stage.style.marginTop = ''
  })

  it('saves what’s picked as the page sets it out, read as the page’s reader reads it, the page left as it was', async () => {
    const sent: Sent[] = []
    picking = startPicking(async (post) => (sent.push(post), { ok: true }))
    const before = stage.innerHTML
    click(document.getElementById('list')!)
    click(document.getElementById('first')!)
    click(document.getElementById('styled')!)
    click(document.getElementById('heading')!)
    button('Save to Nib').click()
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({ title: document.title, url: document.URL, part: 'picked' })
    // In the page's order, not the order of picking; links whole; and nothing of the picker's in it.
    expect(sent[0].page).toBe(`<h2 id="heading">Spring tides</h2><p id="first">High water comes <a id="link" href="${location.origin}/tables">twice</a> a day.</p><ul id="list"><li id="moon">New moon</li></ul><p id="styled" style="color: teal">Already has a style.</p>`)
    expect(said()).toBe('Saved. It’ll be in Nib the next time it syncs.')
    expect(bar().querySelectorAll('button')).toHaveLength(0)
    // The page was never touched, picking or saving; and the picker is gone a moment later.
    expect(stage.innerHTML).toBe(before)
    await vi.waitFor(() => expect(document.querySelector('[data-nib-picking]')).toBeNull(), { timeout: 3000 })
  })

  it('says so when what’s picked has no words, and when it couldn’t be saved, and stays to be closed', async () => {
    let answer: unknown = { ok: false, why: 'The inbox is full. Open Nib so it takes in what’s waiting.' }
    picking = startPicking(async () => answer)
    click(document.getElementById('picture')!)
    button('Save to Nib').click()
    expect(said()).toBe('There are no words in what’s picked.')
    expect(outlined()).toEqual(['frame: picked'])

    click(document.getElementById('heading')!)
    button('Save to Nib').click()
    await vi.waitFor(() => expect(said()).toBe('The inbox is full. Open Nib so it takes in what’s waiting.'))
    expect(button('Close').disabled).toBe(false)
    button('Close').click()
    expect(document.querySelector('[data-nib-picking]')).toBeNull()

    // The background not answering at all is said too.
    answer = undefined
    picking = startPicking(async () => answer)
    click(document.getElementById('heading')!)
    button('Save to Nib').click()
    await vi.waitFor(() => expect(said()).toBe('Couldn’t save it.'))
    picking!.finish()
    picking = startPicking(async () => {
      throw new Error('no background')
    })
    click(document.getElementById('heading')!)
    button('Save to Nib').click()
    await vi.waitFor(() => expect(said()).toBe('Couldn’t save it.'))
  })

  it('is cancelled by its button or by Escape: the page as it was, its clicks its own again; and isn’t started twice', () => {
    const before = stage.innerHTML
    picking = startPicking(async () => ({ ok: true }))
    expect(startPicking(async () => ({ ok: true }))).toBeUndefined()
    expect(document.querySelectorAll('[data-nib-picking="layer"]')).toHaveLength(1)
    over(document.getElementById('heading')!)
    click(document.getElementById('first')!)
    // Nothing of the page is changed while it's being picked from, either.
    expect(stage.innerHTML).toBe(before)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(document.querySelector('[data-nib-picking]')).toBeNull()
    expect(stage.innerHTML).toBe(before)
    const heard = vi.fn()
    document.getElementById('link')!.addEventListener('click', heard)
    document.getElementById('link')!.addEventListener('click', (event) => event.preventDefault())
    expect(click(document.getElementById('link')!).defaultPrevented).toBe(true)
    expect(heard).toHaveBeenCalledTimes(1)

    picking = startPicking(async () => ({ ok: true }))
    click(document.getElementById('styled')!)
    button('Cancel').click()
    expect(stage.innerHTML).toBe(before)
    // Clicks on the bar itself pick nothing.
    picking = startPicking(async () => ({ ok: true }))
    click(bar())
    expect(said()).toBe('Click the parts of the page to keep.')
  })
})
