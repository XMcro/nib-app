import { aboutOf, type Attached } from '../lib/attachment'
import { firstPage, OPEN_PROBLEMS, openAttached, playable } from '../lib/preview'

/**
 * An attachment's card in the editor (editor/Attachment): its name, with its
 * kind and size under it, and Open, which shows it in the system's own viewer
 * (lib/preview). One that isn't on this device is fetched when it's opened,
 * and not before. A recording that's here has a player in the card as well,
 * and a PDF that's here shows its first page, small, beside its name.
 */

/** The first page's picture, at most this many points a side. */
const PAGE = 96

function part<K extends keyof HTMLElementTagNameMap>(into: HTMLElement, tag: K, name: string): HTMLElementTagNameMap[K] {
  const made = into.appendChild(document.createElement(tag))
  made.className = `nib-attachment-${name}`
  return made
}

export function attachmentCard(attached: Attached): HTMLElement {
  const card = document.createElement('div')
  card.className = 'nib-attachment'
  card.dataset.attachment = ''
  const page = part(card, 'img', 'page')
  page.alt = ''
  page.hidden = true
  const text = part(card, 'div', 'text')
  part(text, 'span', 'name').textContent = attached.name
  const about = part(text, 'span', 'about')
  about.textContent = aboutOf(attached)
  const { file, name } = attached
  // Gone without its file (a draft, an export, pasted back): its name is all there is.
  if (!file) return card

  const button = part(card, 'button', 'open')
  button.type = 'button'
  button.textContent = 'Open'
  const kind = file.type.toLowerCase()
  const player = kind.startsWith('audio/') ? part(card, 'audio', 'player') : null
  if (player) {
    player.controls = true
    player.hidden = true
  }
  /** What's shown of the file itself, which only one on this device has: a recording's player, a PDF's first page. */
  const showIt = () => {
    if (player?.hidden) {
      void playable(file, name).then((url) => {
        if (!url) return
        player.src = url
        player.hidden = false
      })
    }
    if (kind === 'application/pdf' && page.hidden) {
      void firstPage(file, name, PAGE).then((src) => {
        if (!src) return
        page.src = src
        page.hidden = false
      })
    }
  }
  showIt()
  // A press on Open isn't a press in the text: on an iPhone it put the cursor there all the same, and the keyboard came up as the viewer closed.
  button.addEventListener('mousedown', (event) => event.preventDefault())
  button.addEventListener('click', () => {
    button.disabled = true
    about.textContent = 'Opening…'
    void openAttached(file, name).then((went) => {
      button.disabled = false
      about.textContent = went === 'opened' ? aboutOf(attached) : OPEN_PROBLEMS[went]
      // Fetched to be opened, it's here now.
      if (went === 'opened') showIt()
    })
  })
  return card
}

/** What in a card is the card's own to handle: the editor leaves a press on these alone. */
export const cardsOwn = (event: Event) => event.target instanceof Element && event.target.closest('.nib-attachment-open, .nib-attachment-player') !== null
