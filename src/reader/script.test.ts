// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fromFountain } from '../lib/fountain'
import { renderScript } from './script'

describe('a shared screenplay in the reader', () => {
  const draw = (script: string) => {
    const article = document.createElement('article')
    renderScript(fromFountain(script), article)
    return article
  }

  it('sets out each element as its own paragraph, the title page first, two speaking at once side by side', () => {
    const article = draw('Title: The Keeper\nAuthor: Ana Lee\n\nINT. HOUSE - DAY #4#\n\nThe *door* opens.\n\nMARA\n(quietly)\nHello.\n\nTOM ^\nHi.\n\nCUT TO:')
    expect([...article.querySelectorAll('.title-page p')].filter((p) => p.textContent).map((p) => [p.className, p.textContent])).toEqual([
      ['align-center', 'The Keeper'],
      ['align-center', 'Ana Lee'],
    ])
    expect([...article.querySelectorAll(':scope > p, .dual p')].map((p) => [p.className, p.textContent])).toEqual([
      ['sp-scene', '44INT. HOUSE - DAY'],
      ['sp-action', 'The door opens.'],
      ['sp-character', 'MARA'],
      ['sp-parenthetical', '(quietly)'],
      ['sp-dialogue', 'Hello.'],
      ['sp-character', 'TOM'],
      ['sp-dialogue', 'Hi.'],
      ['sp-transition', 'CUT TO:'],
    ])
    expect(article.querySelector('.sp-action')!.innerHTML).toBe('The <i>door</i> opens.')
    expect(article.querySelectorAll('.dual > div')).toHaveLength(2)
  })

  it('puts every word in as text', () => {
    const article = draw('<img src=x onerror="alert(1)">\n\n<b>BOLD</b>')
    expect(article.querySelector('img, b')).toBeNull()
    expect(article.textContent).toContain('<img src=x onerror="alert(1)">')
  })

  it('throws on a body it can’t read, for the page to draw as any draft', () => {
    expect(() => renderScript({ type: 'doc', content: 'not a list' }, document.createElement('article'))).toThrow()
  })
})
