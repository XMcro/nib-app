import { afterEach, describe, expect, it } from 'vitest'
import { renderDocument } from './render'
import './reader.css'

/**
 * A table in a shared draft keeps its columns readable on a phone, whatever
 * is in a cell. Needs layout, so a browser.
 */

afterEach(() => document.body.replaceChildren())

const cell = (type: 'tableHeader' | 'tableCell', text: string) => ({ type, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

describe('a table in a shared draft', () => {
  // As in the editor (src/index.css): a word too long to break, a pasted
  // address most often, held its column open to its full length, and the
  // table ran off the side of a phone with the other columns squeezed.
  it('breaks a word too long for its column rather than starving the others', () => {
    const address = 'https://example.com/a/very/long/path/that/has/no/spaces/anywhere/in/it/at/all?with=a&query=string'
    const article = document.createElement('article')
    article.className = 'draft page'
    article.style.width = '335px' // a phone's column, inside the page's padding
    document.body.append(article)
    renderDocument(
      {
        type: 'doc',
        content: [
          {
            type: 'table',
            content: [
              { type: 'tableRow', content: [cell('tableHeader', 'Item'), cell('tableHeader', 'Cost'), cell('tableHeader', 'Notes')] },
              { type: 'tableRow', content: [cell('tableCell', address), cell('tableCell', '9'), cell('tableCell', 'Paid in March, with the rest due once the work is done.')] },
            ],
          },
        ],
      },
      article,
    )
    const table = article.querySelector('table')!
    expect(table.scrollWidth).toBeLessThanOrEqual(table.clientWidth)
    const rows = [...table.querySelectorAll('tr')].map((row) => row.getBoundingClientRect().height)
    expect(Math.max(...rows)).toBeLessThan(300)
  })
})
