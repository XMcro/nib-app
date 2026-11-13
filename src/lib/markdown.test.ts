import { describe, expect, it } from 'vitest'
import { toMarkdown } from './markdown'

const doc = (...content: unknown[]) => ({ type: 'doc', content }) as never
const text = (value: string, marks?: unknown[]) => ({ type: 'text', text: value, marks })
const para = (...children: unknown[]) => ({ type: 'paragraph', content: children })
const heading = (level: number, value: string) => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
})

describe('toMarkdown', () => {
  it('writes a callout as the alert GitHub and Obsidian read', () => {
    const callout = (attrs: object, ...content: object[]) => doc({ type: 'callout', attrs, content })
    expect(toMarkdown(callout({ kind: 'warning', collapsed: false }, para(text('Mind the step'))))).toBe('> [!WARNING]\n> Mind the step')
    expect(toMarkdown(callout({ kind: 'tip', collapsed: true }, para(text('First')), para(text('Second'))))).toBe('> [!TIP]-\n> First\n> \n> Second')
    expect(toMarkdown(callout({ kind: 'nonsense"' }, para(text('x'))))).toBe('> [!NOTE]\n> x')
  })

  it('writes headings at their level', () => {
    expect(toMarkdown(doc(heading(1, 'One'), heading(3, 'Three'), heading(6, 'Six')))).toBe('# One\n\n### Three\n\n###### Six')
  })

  it('wraps each mark', () => {
    expect(toMarkdown(doc(para(text('a', [{ type: 'bold' }]))))).toBe('**a**')
    expect(toMarkdown(doc(para(text('a', [{ type: 'italic' }]))))).toBe('*a*')
    expect(toMarkdown(doc(para(text('a', [{ type: 'strike' }]))))).toBe('~~a~~')
    expect(toMarkdown(doc(para(text('a', [{ type: 'code' }]))))).toBe('`a`')
  })

  it('leaves notes to self behind, keeping the words they are on', () => {
    const note = { type: 'noteToSelf', attrs: { id: 'n1', text: 'Check the tide times.' } }
    expect(toMarkdown(doc(para(text('The ferry leaves '), text('at seven', [note, { type: 'bold' }]))))).toBe('The ferry leaves **at seven**')
  })

  it('writes links with their href', () => {
    const linked = doc(para(text('site', [{ type: 'link', attrs: { href: 'https://x.dev' } }])))
    expect(toMarkdown(linked)).toBe('[site](https://x.dev)')
  })

  // A mark named after one of Object's own properties, or a heading at level
  // 1e10, threw, and one such note made "Export everything" fail.
  it('writes past a mark it doesn’t know and a heading level out of range', () => {
    const odd = doc(para(text('a', [{ type: 'hasOwnProperty' }, { type: 'constructor' }])), heading(1e10, 'Big'), heading(-3, 'Small'))
    expect(toMarkdown(odd)).toBe('a\n\n###### Big\n\n# Small')
  })

  // The editor refuses these; Markdown export wrote them out as links.
  it('writes a link the editor wouldn’t allow as its words alone', () => {
    const odd = doc(para(text('share', [{ type: 'link', attrs: { href: 'file://attacker.example/x' } }]), text(' '), text('run', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])))
    expect(toMarkdown(odd)).toBe('share run')
  })

  it('nests marks outward from the text', () => {
    const both = doc(para(text('a', [{ type: 'bold' }, { type: 'italic' }])))
    expect(toMarkdown(both)).toBe('***a***')
  })

  it('prefixes every line of a blockquote', () => {
    const quoted = doc({ type: 'blockquote', content: [para(text('one')), para(text('two'))] })
    expect(toMarkdown(quoted)).toBe('> one\n> \n> two')
  })

  it('writes bullet lists', () => {
    const list = doc({
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [para(text('first'))] },
        { type: 'listItem', content: [para(text('second'))] },
      ],
    })
    expect(toMarkdown(list)).toBe('- first\n- second')
  })

  it('numbers ordered lists, honouring start', () => {
    const list = (start?: number) => ({
      type: 'orderedList',
      attrs: start ? { start } : undefined,
      content: [
        { type: 'listItem', content: [para(text('one'))] },
        { type: 'listItem', content: [para(text('two'))] },
      ],
    })
    expect(toMarkdown(doc(list()))).toBe('1. one\n2. two')
    expect(toMarkdown(doc(list(5)))).toBe('5. one\n6. two')
  })

  it('writes checklists with their checked state', () => {
    const tasks = doc({
      type: 'taskList',
      content: [
        { type: 'taskItem', attrs: { checked: true }, content: [para(text('done'))] },
        { type: 'taskItem', attrs: { checked: false }, content: [para(text('todo'))] },
      ],
    })
    expect(toMarkdown(tasks)).toBe('- [x] done\n- [ ] todo')
  })

  it('fences code blocks, carrying the language when set', () => {
    const block = (language?: string) => ({
      type: 'codeBlock',
      attrs: language ? { language } : undefined,
      content: [text('const a = 1')],
    })
    expect(toMarkdown(doc(block()))).toBe('```\nconst a = 1\n```')
    expect(toMarkdown(doc(block('ts')))).toBe('```ts\nconst a = 1\n```')
  })

  it('leaves code block content unformatted', () => {
    const block = {
      type: 'codeBlock',
      content: [text('**not bold** and *not italic*')],
    }
    expect(toMarkdown(doc(block))).toBe('```\n**not bold** and *not italic*\n```')
  })

  it('turns hard breaks into a markdown line break', () => {
    const broken = doc(para(text('a'), { type: 'hardBreak' }, text('b')))
    expect(toMarkdown(broken)).toBe('a  \nb')
  })

  it('separates blocks with a blank line and trims the result', () => {
    expect(toMarkdown(doc(para(text('a')), para(text('b'))))).toBe('a\n\nb')
  })

  it('survives an empty document', () => {
    expect(toMarkdown(doc())).toBe('')
  })
})

// An image is an atom with no `text` to fall through to, exactly like a
// footnote. Without a case for it the picture leaves the document on export —
// and export is the only backup this app has.
describe('toMarkdown, images', () => {
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const image = (attrs: Record<string, unknown>) => ({ type: 'image', attrs })

  it('writes an image as Markdown', () => {
    expect(toMarkdown(doc(para(image({ src: PNG, alt: 'a cat' }))))).toBe(`![a cat](${PNG})`)
  })

  // Markdown has no way to say how wide: the picture goes out as any other, as an aligned line goes out as any line.
  it('writes a picture the writer sized as any picture', () => {
    expect(toMarkdown(doc(para(image({ src: PNG, alt: 'a cat', size: 'medium' }))))).toBe(`![a cat](${PNG})`)
  })

  it('leaves the data URI byte-identical', () => {
    const written = toMarkdown(doc(para(image({ src: PNG, alt: '' }))))
    expect(written.slice(written.indexOf('(') + 1, -1)).toBe(PNG)
  })

  it('escapes the alt text', () => {
    const written = toMarkdown(doc(para(image({ src: PNG, alt: 'a]b*c -x' }))))
    expect(written.startsWith('![a\\]b\\*c -x](')).toBe(true)
  })

  // The guard: before the branch existed this whole document serialised to ''.
  it('does not lose a document that is only a picture', () => {
    expect(toMarkdown(doc(para(image({ src: PNG, alt: '' }))))).not.toBe('')
  })

  it('keeps the text either side of an image', () => {
    const mixed = doc(para(text('before '), image({ src: PNG, alt: 'x' }), text(' after')))
    expect(toMarkdown(mixed)).toBe(`before ![x](${PNG}) after`)
  })
})
