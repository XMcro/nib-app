/**
 * Picking parts of a page by pointing at them: the popup puts this into the
 * page (after Page.js, whose `NibPage.cleaned` it reads what's picked with)
 * and closes. What's pointed at is outlined; a click picks it, or lets it go;
 * a small bar says how many are picked, and saves or cancels. Escape cancels.
 *
 * It sends what's picked to the extension's background to be sealed and sent
 * (clipper/background): a page's script is never given the clipper code, and
 * couldn't send across sites if it were.
 *
 * The page itself is never changed. The bar and the outlines are a layer of
 * the picker's own over it, in a closed shadow root the page's styles don't
 * reach: an outline is a box drawn where the element is, kept there as the
 * page scrolls. (Outlining the elements themselves left some with an empty
 * `style` in what was saved: Chromium writes one out late.)
 */
declare const NibPage: { cleaned(copy: Element): string }

const MARK = 'data-nib-picking'

export function startPicking(send: (post: { title: string; url: string; page: string; part: string }) => Promise<unknown> = (post) => chrome.runtime.sendMessage({ type: 'clip', post })) {
  if (document.documentElement.hasAttribute(MARK)) return
  document.documentElement.setAttribute(MARK, '')

  const picked = new Set<HTMLElement>()
  let over: HTMLElement | null = null
  let done = false

  // The layer: all of the screen, and nothing of it in the pointer's way but the bar.
  const host = document.createElement('div')
  host.setAttribute(MARK, 'layer')
  host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none'
  const root = host.attachShadow({ mode: 'closed' })
  const style = document.createElement('style')
  style.textContent =
    '.bar { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); pointer-events: auto; display: flex; gap: 10px; align-items: center; padding: 8px 10px 8px 14px; border-radius: 10px; background: #1a1a1a; color: #fff; font: 13px/1.4 system-ui, -apple-system, sans-serif; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3); max-width: min(92vw, 560px) }' +
    'button { font: inherit; border: 0; border-radius: 7px; padding: 5px 10px; cursor: pointer }' +
    '.save { background: #fff; color: #1a1a1a; font-weight: 600 } .save:disabled { opacity: 0.45; cursor: default } .cancel { background: transparent; color: #cfcfcf }' +
    '.box { position: absolute; box-sizing: border-box; border-radius: 3px } .pointed { border: 2px dashed #2f7de1 } .picked { border: 2px solid #2f7de1; background: rgba(47, 125, 225, 0.08) }'
  const boxes = document.createElement('div')
  const bar = document.createElement('div')
  bar.className = 'bar'
  bar.setAttribute('role', 'dialog')
  bar.setAttribute('aria-label', 'Save parts of this page to Nib')
  const said = document.createElement('span')
  said.setAttribute('role', 'status')
  const save = document.createElement('button')
  save.className = 'save'
  save.textContent = 'Save to Nib'
  const cancel = document.createElement('button')
  cancel.className = 'cancel'
  cancel.textContent = 'Cancel'
  bar.append(said, save, cancel)
  root.append(style, boxes, bar)
  document.documentElement.append(host)

  /** The outlines, where their elements are now: what's picked, and what's pointed at if it isn't. */
  const draw = () => {
    const outlined: [HTMLElement, string][] = [...picked].map((element) => [element, 'picked'])
    if (over && !picked.has(over)) outlined.push([over, 'pointed'])
    while (boxes.children.length > outlined.length) boxes.lastElementChild!.remove()
    while (boxes.children.length < outlined.length) boxes.append(document.createElement('div'))
    outlined.forEach(([element, how], at) => {
      const box = boxes.children[at] as HTMLElement
      const place = element.getBoundingClientRect()
      box.className = `box ${how}`
      box.style.cssText = `left: ${place.left - 3}px; top: ${place.top - 3}px; width: ${place.width + 6}px; height: ${place.height + 6}px`
    })
  }
  /** Kept where the elements are as the page scrolls or is set out again. */
  const follow = () => {
    if (done) return
    draw()
    requestAnimationFrame(follow)
  }
  const say = () => {
    said.textContent = picked.size === 0 ? 'Click the parts of the page to keep.' : picked.size === 1 ? '1 part picked.' : `${picked.size} parts picked.`
    save.disabled = picked.size === 0
  }

  /** What a point on the page picks: the block it's in, not the word or the link under it. */
  const blockAt = (target: EventTarget | null): HTMLElement | null => {
    let element = target instanceof HTMLElement ? target : target instanceof Element ? target.parentElement : null
    if (!element || element === host) return null
    while (element.parentElement && element !== document.body && getComputedStyle(element).display.startsWith('inline')) element = element.parentElement
    return element === document.documentElement || element === document.body ? null : element
  }

  const point = (event: Event) => {
    over = blockAt(event.target)
    draw()
  }
  const pick = (event: Event) => {
    if (event.composedPath().includes(host)) return
    // The page mustn't take the click for its own: a link pointed at is picked, not followed.
    event.preventDefault()
    event.stopImmediatePropagation()
    // Where the click is, is what's pointed at: a click can come with no move before it.
    over = blockAt(event.target)
    const block = over
    if (block) {
      const holder = [...picked].find((one) => one.contains(block))
      // Within what's picked already, itself or a part of it: that is let go. Otherwise it's picked, and what it holds that was picked is in it now.
      if (holder) picked.delete(holder)
      else {
        for (const one of [...picked]) if (block.contains(one)) picked.delete(one)
        picked.add(block)
      }
      say()
    }
    draw()
  }
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') finish()
  }

  function finish() {
    if (done) return
    done = true
    document.removeEventListener('mousemove', point, true)
    document.removeEventListener('click', pick, true)
    document.removeEventListener('keydown', key, true)
    host.remove()
    document.documentElement.removeAttribute(MARK)
  }

  save.addEventListener('click', () => {
    // As the page sets them out, whatever order they were picked in.
    const inOrder = [...picked].sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    const copy = document.createElement('div')
    for (const element of inOrder) copy.append(element.cloneNode(true))
    const page = NibPage.cleaned(copy)
    if (!page) {
      said.textContent = 'There are no words in what’s picked.'
      return
    }
    save.disabled = cancel.disabled = true
    said.textContent = 'Saving…'
    const failed = (why = 'Couldn’t save it.') => {
      said.textContent = why
      cancel.disabled = false
      cancel.textContent = 'Close'
    }
    void send({ title: document.title, url: document.URL, page, part: 'picked' }).then((answer) => {
      const sent = answer as { ok?: boolean; why?: string } | undefined
      if (!sent?.ok) return failed(sent?.why)
      said.textContent = 'Saved. It’ll be in Nib the next time it syncs.'
      save.remove()
      cancel.remove()
      setTimeout(finish, 1800)
    }, () => failed())
  })
  cancel.addEventListener('click', finish)
  document.addEventListener('mousemove', point, true)
  document.addEventListener('click', pick, true)
  document.addEventListener('keydown', key, true)
  say()
  follow()
  return { root, finish }
}
