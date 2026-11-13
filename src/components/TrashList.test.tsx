// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Item } from '../db/db'
import { TrashList } from './TrashList'

const trashed = (id: string, text: string, kind: Item['kind'] = 'note'): Item => ({
  id,
  kind,
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  version: 1,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  deletedAt: Date.now(),
})

function setup(items: Item[]) {
  const handlers = {
    onBack: vi.fn(),
    onRestore: vi.fn(),
    onPurge: vi.fn(),
    onPurgeAll: vi.fn(),
  }
  render(<TrashList items={items} {...handlers} />)
  return handlers
}

describe('TrashList', () => {
  it('says when the trash is empty and offers nothing to empty', () => {
    setup([])
    expect(screen.getByText('Trash is empty.')).toBeTruthy()
    expect(screen.queryByText('Empty trash')).toBeNull()
  })

  it('lists trashed items with the tab they came from', () => {
    setup([trashed('a', 'gone note'), trashed('b', 'gone page', 'page')])
    expect(screen.getByText('gone note')).toBeTruthy()
    expect(screen.getByText('Page')).toBeTruthy()
  })

  it('restores in one click, because restoring is safe', async () => {
    const { onRestore } = setup([trashed('a', 'gone note')])
    await userEvent.click(screen.getByText('Restore'))
    expect(onRestore).toHaveBeenCalledWith('a')
  })

  it('never purges an item on the first click', async () => {
    const { onPurge } = setup([trashed('a', 'gone note')])
    await userEvent.click(screen.getByText('Delete'))
    expect(onPurge).not.toHaveBeenCalled()
    expect(screen.getByText('Delete for good?')).toBeTruthy()

    await userEvent.click(screen.getByText('Delete for good?'))
    expect(onPurge).toHaveBeenCalledWith('a')
  })

  it('never empties the trash on the first click', async () => {
    const { onPurgeAll } = setup([trashed('a', 'gone note')])
    await userEvent.click(screen.getByText('Empty trash'))
    expect(onPurgeAll).not.toHaveBeenCalled()

    await userEvent.click(screen.getByText('Empty for good?'))
    expect(onPurgeAll).toHaveBeenCalledOnce()
  })

  it('arms only the row you clicked', async () => {
    setup([trashed('a', 'first'), trashed('b', 'second')])
    await userEvent.click(screen.getAllByText('Delete')[0])
    expect(screen.getAllByText('Delete')).toHaveLength(1)
    expect(screen.getAllByText('Delete for good?')).toHaveLength(1)
  })

  it('goes back to the list', async () => {
    const { onBack } = setup([])
    await userEvent.click(screen.getByText('← Back'))
    expect(onBack).toHaveBeenCalledOnce()
  })
})
