import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import '../index.css'
import { applyTheme, NAMED, type Theme } from '../lib/theme'
import { nibExtensions } from './extensions'
import { reading, showReading } from './reading'

/** The sentence being read aloud, on every theme: its words still easy to read, its wash seen on the page. */

/** [r, g, b, a] in 0–255 and 0–1, from rgb(), rgba() or color(srgb …), which is what color-mix() computes to. */
function parse(color: string): number[] {
  const numbers = color.match(/[\d.]+/g)!.map(Number)
  if (color.startsWith('color(')) return [...numbers.slice(0, 3).map((channel) => channel * 255), numbers[3] ?? 1]
  return [...numbers.slice(0, 3), numbers[3] ?? 1]
}
const over = (top: number[], under: number[]) => top.slice(0, 3).map((channel, i) => channel * top[3] + under[i] * (1 - top[3]))
const luminance = (rgb: number[]) => {
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: number[], b: number[]) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

let editor: Editor | undefined

afterEach(() => {
  editor?.destroy()
  editor = undefined
  document.body.replaceChildren()
  applyTheme('light')
})

describe('the sentence being read', () => {
  const THEMES: Theme[] = ['light', 'dark', ...NAMED.map((one) => one.id)]
  for (const theme of THEMES) {
    it(`reads clearly, and stands out from the page, on ${theme}`, () => {
      applyTheme(theme)
      const element = document.createElement('div')
      element.className = 'bg-paper text-ink'
      document.body.append(element)
      editor = new Editor({ element, extensions: nibExtensions(true), content: '<p>One goes. Two goes.</p>', editorProps: { attributes: { class: 'nib-editor' } } })
      editor.registerPlugin(reading())
      showReading(editor, { from: 1, to: 10 })

      const shown = document.querySelector('.nib-reading')!
      expect(shown.textContent).toBe('One goes.')
      const page = parse(getComputedStyle(element).backgroundColor)
      const wash = over(parse(getComputedStyle(shown).backgroundColor), page)
      expect(contrast(parse(getComputedStyle(shown).color), wash)).toBeGreaterThanOrEqual(4.5)
      expect(contrast(wash, page)).toBeGreaterThanOrEqual(1.15)
    })
  }
})
