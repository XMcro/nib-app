import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import '../index.css'
import { toMarkdown } from '../lib/markdown'
import { toHtml } from '../lib/documentExport'
import { nibExtensions } from './extensions'

/**
 * Sketches on the page. Nib no longer draws them, but one made in an earlier
 * build still shows as its picture, keeps its drawing in the document, and
 * never puts that drawing in the DOM or an export.
 */


/** A real PNG `width` pixels wide, as the canvas would hand back. */
function png(width: number, height = 20): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')!
  context.fillStyle = '#111'
  context.fillRect(2, 2, width - 4, 4)
  return canvas.toDataURL('image/png')
}

const DRAWING = 'd3JpdHRlbiB3aXRoIGEgcGVuY2ls'
let editor: Editor | undefined

function open(content: JSONContent | string = '<p>before after</p>') {
  const element = document.createElement('div')
  element.className = 'nib-editor'
  document.body.append(element)
  editor = new Editor({ element, extensions: nibExtensions(true), content })
  return editor
}

const sketchDoc = (src: string, drawing: string | null = DRAWING): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src, alt: 'Sketch', drawing } }] }],
})
const images = () => {
  const found: JSONContent[] = []
  const walk = (node: JSONContent) => {
    if (node.type === 'image') found.push(node)
    node.content?.forEach(walk)
  }
  walk(editor!.getJSON())
  return found
}

afterEach(() => {
  cleanup()
  editor?.destroy()
  editor = undefined
  document.documentElement.classList.remove('dark')
  document.body.replaceChildren()
})

describe('a sketch on the page', () => {
  it('is marked data-sketch and shown at the size it was drawn, half its pixels', () => {
    open(sketchDoc(png(400)))
    const image = document.querySelector('img:not(.ProseMirror-separator)')!
    expect(image.hasAttribute('data-sketch')).toBe(true)
    expect(image.getAttribute('width')).toBe('200')
  })

  it('never puts its drawing in the DOM', () => {
    open(sketchDoc(png(40)))
    expect(document.body.innerHTML).not.toContain(DRAWING)
  })

  it('is not a sketch without a drawing: an ordinary picture gets neither mark', () => {
    open(sketchDoc(png(40), null))
    const image = document.querySelector('img:not(.ProseMirror-separator)')!
    expect(image.hasAttribute('data-sketch')).toBe(false)
    expect(image.hasAttribute('width')).toBe(false)
  })

  it('never takes a drawing from imported HTML', () => {
    open(`<p><img src="${png(40)}" data-drawing="${DRAWING}" drawing="${DRAWING}"></p>`)
    expect(images()[0].attrs?.drawing).toBeNull()
  })

  it('turns to light ink in the dark theme, and leaves photographs alone', () => {
    open({ type: 'doc', content: [{ type: 'paragraph', content: [sketchDoc(png(40)).content![0].content![0], { type: 'image', attrs: { src: png(40) } }] }] })
    document.documentElement.classList.add('dark')
    const [sketch, photo] = [...document.querySelectorAll('img:not(.ProseMirror-separator)')]
    expect(getComputedStyle(sketch).filter).toContain('invert(1)')
    expect(getComputedStyle(photo).filter).toBe('none')
  })

  it('exports as its picture only: Markdown and HTML carry no drawing', () => {
    const src = png(40)
    const body = sketchDoc(src)
    expect(toMarkdown(body)).toBe(`![Sketch](${src})`)
    const html = toHtml({ id: 'x', kind: 'page', body, version: 1, createdAt: 1, updatedAt: 1 })
    expect(html).toContain('data-sketch')
    expect(html).not.toContain(DRAWING)
  })
})
