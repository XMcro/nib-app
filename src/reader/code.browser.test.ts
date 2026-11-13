import { afterEach, describe, expect, it, vi } from 'vitest'
import { MOST_COLOURED, READ_LIMIT_MS } from '../lib/codeReader'
import { renderDocument } from './render'
import './reader.css'

/** A shared draft's code, coloured in a real worker. The draft is a stranger's, so what it asks for is checked first. */

const code = (text: string, language?: unknown) => ({ type: 'codeBlock', attrs: { language }, content: [{ type: 'text', text }] })
function draw(...content: object[]) {
  const into = document.body.appendChild(document.createElement('article'))
  renderDocument({ type: 'doc', content }, into)
  return into
}
const words = (into: ParentNode, colour: string) => [...into.querySelectorAll(`.nib-code-${colour}`)].map((element) => element.textContent)

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
})

describe('code in a shared draft', () => {
  it('is drawn in its colours, every character as written', async () => {
    const source = 'const a = "<b>&" // not <i>\nreturn x < y && z;'
    const into = draw(code(source, 'javascript'))
    await vi.waitFor(() => expect(words(into, 'keyword')).toEqual(['const', 'return']), { timeout: 10_000 })
    expect(words(into, 'comment')).toEqual(['// not <i>'])
    expect(into.querySelector('code')!.textContent).toBe(source)
    expect(into.querySelector('script, b, i')).toBeNull()
  })

  it('stays as it is, read by nobody, with no language, one that isn’t a name, or too long', async () => {
    const read = vi.spyOn(Worker.prototype, 'postMessage')
    const long = 'const a\n'.repeat(MOST_COLOURED / 8 + 1)
    const into = draw(code('const a'), code('const a', 'x fixed inset-0'), code('const a', { toString: 'javascript' }), code(long, 'javascript'))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(read).not.toHaveBeenCalled()
    expect(into.querySelector('[class^="nib-code-"]')).toBeNull()
  })

  it('stays as it is with a language Nib has no grammar for, a name of Object’s included', async () => {
    const into = draw(code('const a', 'constructor'), code('const a', '__proto__'), code('const nextOne', 'javascript'))
    await vi.waitFor(() => expect(words(into, 'keyword')).toEqual(['const']), { timeout: 10_000 })
    expect(into.querySelectorAll('pre')[0].querySelector('span')).toBeNull()
  })

  // Last: three stopped reads end the colouring of the page, as they're meant to.
  it('stops after three reads that take too long, so a draft can’t keep a device busy', async () => {
    const read = vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(() => {})
    const stopped = vi.spyOn(Worker.prototype, 'terminate')
    const into = draw(...['a', 'b', 'c', 'd', 'e'].map((name) => code(`const ${name}`, 'javascript')))
    await vi.waitFor(() => expect(stopped).toHaveBeenCalledTimes(3), { timeout: 10_000 })
    await new Promise((resolve) => setTimeout(resolve, READ_LIMIT_MS * 2))
    expect(read).toHaveBeenCalledTimes(3)
    expect(into.querySelector('[class^="nib-code-"]')).toBeNull()
  })
})
