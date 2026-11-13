// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSONContent } from '@tiptap/react'
import { Comparison } from './Comparison'

const text = (value: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text: value, ...(marks ? { marks } : {}) })
const para = (value: string): JSONContent => ({ type: 'paragraph', content: [text(value)] })
const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })
const list = (...items: string[]): JSONContent => ({ type: 'bulletList', content: items.map((item) => ({ type: 'listItem', content: [para(item)] })) })

function show(then: JSONContent, now: JSONContent) {
  const handlers = { onBack: vi.fn(), onRestore: vi.fn(), onBringBack: vi.fn() }
  render(<Comparison then={then} now={now} at={Date.now() - 3_600_000} {...handlers} />)
  return handlers
}

const SEASON = ['One.', 'Two.', 'Three.', 'Four.', 'Five.', 'Six.'].map(para)

describe('Comparison', () => {
  it('shows only what changed, the paragraphs between folded until asked for', async () => {
    const now = [...SEASON]
    now[4] = para('Five, and a half.')
    show(doc(...SEASON), doc(...now))
    const folds = screen.getAllByRole('button', { expanded: false })
    expect(folds.map((fold) => fold.textContent)).toEqual(['⋯ 4 paragraphs unchanged', '⋯ 1 paragraph unchanged'])
    expect(screen.queryByText('Two.')).toBeNull()
    expect(screen.getByText(', and a half').tagName).toBe('INS')

    await userEvent.click(folds[0])
    expect(screen.getByText('Two.')).toBeTruthy()
    expect(screen.queryByText('Six.')).toBeNull()
    await userEvent.click(folds[0])
    expect(screen.queryByText('Two.')).toBeNull()
  })

  it('sets a callout’s lines off, as a quotation’s are', () => {
    const box = (value: string): JSONContent => ({ type: 'callout', attrs: { kind: 'tip', collapsed: false }, content: [para(value)] })
    show(doc(box('Inside.'), para('Plain.')), doc(box('Inside.'), para('Plain, now.')))
    const fold = screen.getAllByRole('button', { expanded: false }).find((one) => one.textContent?.includes('unchanged'))
    if (fold) fold.click()
    return screen.findByText('Inside.').then((line) => expect(line.closest('.border-l-2')).not.toBeNull())
  })

  it('strikes through a paragraph taken out, and marks one put in', () => {
    const [one, two, three] = SEASON
    show(doc(one, two, three), doc(one, three, para('Added since.')))
    expect(screen.getByText('Two.').tagName).toBe('DEL')
    expect(screen.getByText('Added since.').tagName).toBe('INS')
  })

  it('names each change for a screen reader', () => {
    show(doc(para('late')), doc(para('early')))
    expect(screen.getByText('late').closest('p')!.textContent).toBe('Removed: lateAdded: early')
  })

  it('offers nothing that would change a read-only document', () => {
    const handlers = { onBack: vi.fn(), onRestore: vi.fn(), onBringBack: vi.fn() }
    render(<Comparison then={doc(para('The boats came in early.'))} now={doc(para('The boats came in late.'))} at={Date.now() - 3_600_000} {...handlers} readOnly />)
    expect(screen.queryByRole('button', { name: /Restore this whole version/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Bring back/ })).toBeNull()
  })

  it('says when only the formatting changed', () => {
    show(doc(para('The boats came in.')), doc({ type: 'paragraph', content: [text('The '), text('boats', [{ type: 'bold' }]), text(' came in.')] }))
    expect(screen.getByText('The boats came in.')).toBeTruthy()
    expect(screen.getByText('Formatting only')).toBeTruthy()
  })

  it('shows a list item as one', () => {
    show(doc(list('one', 'two')), doc(list('one', 'two!')))
    const item = screen.getByText('!').closest('p')!
    expect(item.textContent).toBe('•twoAdded: !')
  })

  it('says so when no words changed', () => {
    show(doc(...SEASON), doc(SEASON[0], { type: 'paragraph' }, ...SEASON.slice(1)))
    expect(screen.getByText('No changes to the words since then.')).toBeTruthy()
  })

  it('offers to bring back a paragraph changed or removed, not one added since', async () => {
    const [one, two, three] = SEASON
    const then = doc(one, two, three)
    const { onBringBack } = show(then, doc(para('One, and more.'), three, para('Added since.')))
    const offers = screen.getAllByRole('button', { name: /^Bring back/ })
    expect(offers.map((offer) => offer.getAttribute('aria-label'))).toEqual(['Bring back “One.”', 'Bring back “Two.”'])

    await userEvent.click(offers[1])
    expect(onBringBack).toHaveBeenCalledWith(doc(para('One, and more.'), two, three, para('Added since.')))
  })

  it('leaves a paragraph removed from a table to restoring the whole version', () => {
    const table = (...rows: string[][]): JSONContent => ({
      type: 'table',
      content: rows.map((cells) => ({ type: 'tableRow', content: cells.map((cell) => ({ type: 'tableCell', content: [para(cell)] })) })),
    })
    show(doc(table(['a', 'b'], ['c', 'd'])), doc(table(['a', 'b!'])))
    expect(screen.getAllByRole('button', { name: /^Bring back/ }).map((offer) => offer.getAttribute('aria-label'))).toEqual(['Bring back “b”'])
  })

  it('goes back, and restores the whole version', async () => {
    const { onBack, onRestore } = show(doc(para('late')), doc(para('early')))
    await userEvent.click(screen.getByText('Restore this whole version'))
    expect(onRestore).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByText('← Back'))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
