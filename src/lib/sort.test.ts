import { describe, expect, it } from 'vitest'
import type { Item } from '../db/db'
import { sortItems } from './sort'

const item = (title: string, createdAt: number, updatedAt: number): Item => ({
  id: title,
  kind: 'note',
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: title }] }] },
  version: 1,
  createdAt,
  updatedAt,
})

// Created oldest-first, edited in the opposite order, titles in a third order.
const banana = item('banana', 1, 300)
const apple = item('Apple', 2, 200)
const cherry = item('cherry', 3, 100)
const all = [cherry, apple, banana]

describe('sortItems', () => {
  it('orders by most recently edited', () => {
    expect(sortItems(all, 'updated').map((i) => i.id)).toEqual(['banana', 'Apple', 'cherry'])
  })

  it('orders by most recently created', () => {
    expect(sortItems(all, 'created').map((i) => i.id)).toEqual(['cherry', 'Apple', 'banana'])
  })

  it('orders by title, ignoring case', () => {
    expect(sortItems(all, 'title').map((i) => i.id)).toEqual(['Apple', 'banana', 'cherry'])
  })

  it('does not mutate the input', () => {
    const original = [...all]
    sortItems(all, 'title')
    expect(all).toEqual(original)
  })

  it('floats pinned items to the top of any sort', () => {
    const pinned = { ...cherry, pinnedAt: 10 }
    const list = [banana, apple, pinned]
    expect(sortItems(list, 'updated').map((i) => i.id)).toEqual(['cherry', 'banana', 'Apple'])
    expect(sortItems(list, 'title').map((i) => i.id)).toEqual(['cherry', 'Apple', 'banana'])
  })

  it('orders pinned items by most recently pinned', () => {
    const first = { ...apple, pinnedAt: 10 }
    const second = { ...banana, pinnedAt: 20 }
    expect(sortItems([first, second, cherry], 'updated').map((i) => i.id)).toEqual([
      'banana',
      'Apple',
      'cherry',
    ])
  })

  it('handles empty and single-item lists', () => {
    expect(sortItems([], 'title')).toEqual([])
    expect(sortItems([apple], 'created').map((i) => i.id)).toEqual(['Apple'])
  })
})
