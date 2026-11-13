import { acceptCode, clipOf, CHOICES, firstChoice, offered, type Choice, type Parts, type Sent } from './clip'
import './popup.css'

/**
 * The extension's popup. The first time, it asks for the clipper code, copied
 * in Nib (Settings, Sync). After that it reads the page in front (Page.js,
 * the script Safari's share sheet runs), offers what there is to keep of it,
 * and hands the clip to the background to seal and send. "Pick parts of the
 * page" puts the picker into the page and closes.
 */
declare const NibPage: { read(document: Document): Parts }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const show = (view: 'setup' | 'clip') => {
  $('setup').hidden = view !== 'setup'
  $('clip').hidden = view !== 'clip'
}
const say = (text: string) => ($('said').textContent = text)

async function setup(why = '') {
  show('setup')
  $('setup-said').textContent = why
  const field = $<HTMLTextAreaElement>('code')
  field.focus()
  $('keep-code').onclick = async () => {
    const code = field.value.trim()
    if (!acceptCode(code)) {
      $('setup-said').textContent = 'That isn’t a clipper code. In Nib, open Settings, then Sync, and choose “Copy the code for Nib’s browser extension”.'
      return
    }
    await chrome.storage.local.set({ code })
    field.value = ''
    void clip()
  }
}

async function clip() {
  const { code } = await chrome.storage.local.get('code')
  if (typeof code !== 'string' || !acceptCode(code)) return setup()
  show('clip')
  say('')
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  // What the browser says of the tab, until the page says more; a page the extension can't read (the browser's own, a store's) has only this.
  let parts: Parts = { title: tab?.title ?? '', url: tab?.url ?? '', html: '', selection: '', article: '', visible: '' }
  let read = false
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ['page.js'] })
    const [answer] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: () => NibPage.read(document) })
    if (answer?.result) {
      parts = answer.result
      read = true
    }
  } catch {
    // Left as the tab's title and address.
  }
  const title = $<HTMLInputElement>('title')
  const note = $<HTMLTextAreaElement>('note')
  const save = $<HTMLButtonElement>('save')
  const pick = $<HTMLButtonElement>('pick')
  title.value = parts.title
  $('address').textContent = parts.url
  const web = /^https?:\/\//i.test(parts.url)
  save.disabled = !web
  pick.hidden = !read
  if (!web) say('Nib keeps pages from the web. This isn’t one.')

  const choices = $('choices')
  choices.replaceChildren()
  let chosen: Choice = firstChoice(parts)
  for (const choice of offered(parts)) {
    const label = document.createElement('label')
    const radio = document.createElement('input')
    radio.type = 'radio'
    radio.name = 'keep'
    radio.value = choice
    radio.checked = choice === chosen
    radio.onchange = () => (chosen = choice)
    label.append(radio, CHOICES.find(([known]) => known === choice)![1])
    choices.append(label)
  }

  save.onclick = async () => {
    save.disabled = true
    say('Saving…')
    const sent = (await chrome.runtime.sendMessage({ type: 'clip', post: clipOf(parts, chosen, title.value, note.value) }).catch(() => undefined)) as Sent | undefined
    if (sent?.ok) return say('Saved. It’ll be in Nib the next time it syncs.')
    say(sent?.why ?? 'Couldn’t save it.')
    save.disabled = false
  }
  pick.onclick = async () => {
    await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ['picker.js'] })
    window.close()
  }
  $('other-code').onclick = async () => {
    await chrome.storage.local.remove('code')
    void setup()
  }
}

void clip()
