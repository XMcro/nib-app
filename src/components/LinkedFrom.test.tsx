// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { JSONContent } from '@tiptap/react'
import type { Item } from '../db/db'
import { LinkedFrom } from './LinkedFrom'

const linking = (id: string, title: string, updatedAt: number, to = 'ferry'): Item => ({
  id,
  kind: 'note',
  version: 1,
  createdAt: 1,
  updatedAt,
  body: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: `${title} ` }, { type: 'noteLink', attrs: { id: to, title: 'Ferry' } }] }],
  } as JSONContent,
})

afterEach(cleanup)

describe('Linked from', () => {
  it('is not there at all when nothing links here', () => {
    const { container } = render(<LinkedFrom id="ferry" items={[linking('a', 'Elsewhere', 1, 'other')]} onOpen={() => {}} />)
    expect(container.innerHTML).toBe('')
  })

  it('lists what links here, newest first, and opens one when chosen', () => {
    const onOpen = vi.fn()
    render(<LinkedFrom id="ferry" items={[linking('a', 'Monday', 1), linking('b', 'Friday', 5)]} onOpen={onOpen} />)
    expect(screen.getByRole('region', { name: 'Linked from' })).toBeTruthy()
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Friday Ferry', 'Monday Ferry'])
    fireEvent.click(screen.getByText('Monday Ferry'))
    expect(onOpen).toHaveBeenCalledWith('a')
  })

  it('keeps the list short, with the rest a tap away', () => {
    const many = Array.from({ length: 8 }, (_, i) => linking(`n${i}`, `Note ${i}`, i))
    render(<LinkedFrom id="ferry" items={many} onOpen={() => {}} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    fireEvent.click(screen.getByText('3 more'))
    expect(screen.getAllByRole('listitem')).toHaveLength(8)
  })
})
