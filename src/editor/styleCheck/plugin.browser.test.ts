import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { DOMSerializer } from '@tiptap/pm/model'
import { nibExtensions } from '../extensions'
import { toHtml } from '../../lib/documentExport'
import { checks, DEBOUNCE_MS, reasonAt, styleCheck, styleCheckKey, suggestions, withRules } from './plugin'
import { RULES } from './rules'

/**
 * The style check on a live editor. The underlines are drawn, never written:
 * the document, its HTML, an export and a copy are all exactly as before.
 */

const ALL = new Set(RULES.map((rule) => rule.id))
let editor: Editor | undefined

function mount(content: string) {
  const element = document.createElement('div')
  document.body.append(element)
  editor = new Editor({ element, extensions: nibExtensions(true), content })
  return editor
}

/** Until every changed paragraph has been checked. */
async function settled(target: Editor) {
  await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 50))
  for (let i = 0; i < 200 && styleCheckKey.getState(target.state)?.dirty.length; i++) await new Promise((resolve) => setTimeout(resolve, 10))
}

const flagged = () => [...document.querySelectorAll<HTMLElement>('.nib-style')].map((span) => span.textContent)

afterEach(() => {
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
})

describe('the style check plugin', () => {
  it('underlines what the rules flag, with the reason on hover', async () => {
    const live = mount('<p>It was very quickly written.</p><h2>Very headings are left alone</h2><pre><code>really code</code></pre>')
    live.registerPlugin(styleCheck(ALL))
    await settled(live)
    expect(flagged()).toEqual(expect.arrayContaining(['very', 'quickly']))
    expect(flagged().join(' ')).not.toMatch(/Very headings|really code/)
    const span = [...document.querySelectorAll<HTMLElement>('.nib-style')].find((each) => each.textContent === 'quickly')!
    expect(span.title).toBe('Adverb: a stronger verb might do the work of “quickly”.')
    expect(reasonAt(live.state, live.state.doc.textContent.indexOf('quickly') + 2)).toMatch(/^Adverb/)
  })

  it('counts each flag once, though overlaps cut it into pieces', async () => {
    // "very", "quickly", and the passive "was very quickly written" around both: three flags, five pieces.
    const live = mount('<p>It was very quickly written.</p><p>Plain words here.</p>')
    live.registerPlugin(styleCheck(ALL))
    await settled(live)
    expect(flagged().length).toBeGreaterThan(3)
    expect(suggestions(live.state)).toBe(3)
  })

  it('without Plus, counts the same flags and draws none of them', async () => {
    const live = mount('<p>It was very quickly written.</p>')
    live.registerPlugin(styleCheck(ALL, { underline: false }))
    await settled(live)
    expect(suggestions(live.state)).toBe(3)
    expect(flagged()).toEqual([])
    expect(reasonAt(live.state, live.state.doc.textContent.indexOf('quickly') + 2)).toBeNull()
  })

  it('never touches the document, its HTML, an export, or what’s copied', async () => {
    const live = mount('<p>It was very quickly written, at the end of the day.</p>')
    const json = JSON.stringify(live.getJSON())
    const html = live.getHTML()
    live.registerPlugin(styleCheck(ALL))
    await settled(live)
    expect(flagged().length).toBeGreaterThan(0)
    expect(JSON.stringify(live.getJSON())).toBe(json)
    expect(live.getHTML()).toBe(html)
    expect(toHtml({ id: 'x', kind: 'page', body: live.getJSON(), version: 1, createdAt: 0, updatedAt: 0 })).not.toContain('nib-style')
    const copied = document.createElement('div')
    copied.append(DOMSerializer.fromSchema(live.schema).serializeFragment(live.state.doc.slice(0, live.state.doc.content.size).content))
    expect(copied.innerHTML).not.toContain('nib-style')
    expect(live.view.serializeForClipboard(live.state.doc.slice(0, live.state.doc.content.size)).dom.innerHTML).not.toContain('nib-style')
  })

  it('checks again only the paragraph that changed, a moment after typing', async () => {
    const live = mount(`${'<p>A plain line of writing here.</p>'.repeat(30)}<p id="last">The end.</p>`)
    live.registerPlugin(styleCheck(ALL))
    await settled(live)
    expect(flagged()).toEqual([])

    const before = checks.count
    live.commands.focus('end')
    live.commands.insertContent(' It went really well.')
    await settled(live)
    expect(checks.count - before).toBe(1)
    expect(flagged()).toEqual(['really'])
  })

  it('runs again with new rules when one is switched off', async () => {
    const live = mount('<p>It was very quickly written.</p>')
    live.registerPlugin(styleCheck(ALL))
    await settled(live)
    live.view.dispatch(live.state.tr.setMeta(styleCheckKey, withRules(new Set(['adverb'] as const))))
    await settled(live)
    expect(flagged()).toEqual(['quickly'])
  })

  it('leaves nothing behind when it’s turned off', async () => {
    const live = mount('<p>It was very quickly written.</p>')
    live.registerPlugin(styleCheck(ALL))
    await settled(live)
    live.unregisterPlugin(styleCheckKey)
    expect(flagged()).toEqual([])
  })
})
