// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Revision } from '../db/db'
import { HistoryPanel } from './HistoryPanel'

const HOUR = 3_600_000
const DAY = 24 * HOUR

// Pinned to local midday. `relativeTime` says "yesterday" rather than "4h ago"
// once the offset crosses local midnight, so against a real clock these
// assertions failed every night between 00:00 and roughly 05:00.
const NOON = new Date(2026, 0, 15, 12, 0, 0).getTime()

beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOON)
})
afterEach(() => {
  vi.restoreAllMocks()
})

const revision = (id: string, text: string, agoMs: number): Revision => ({
  id,
  itemId: 'doc',
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  createdAt: Date.now() - agoMs,
})

const versions = () => within(screen.getByRole('list', { name: 'Versions' })).getAllByRole('listitem')

function setup(revisions: Revision[], keepsAll = true) {
  const handlers = { onBack: vi.fn(), onRestore: vi.fn(), onBringBack: vi.fn(), onPlus: vi.fn() }
  render(<HistoryPanel revisions={revisions} keepsAll={keepsAll} {...handlers} />)
  return handlers
}

describe('HistoryPanel', () => {
  it('says when a document has no history yet', () => {
    setup([])
    expect(screen.getByText('No earlier versions yet.')).toBeTruthy()
  })

  it('labels the newest revision Current and dates the rest', () => {
    setup([revision('r1', 'now', 0), revision('r2', 'before', 2 * HOUR)])
    expect(screen.getByText('Current')).toBeTruthy()
    expect(screen.getByText('2h ago')).toBeTruthy()
  })

  it('lets a read-only document’s versions be read, and none of them brought back', async () => {
    const handlers = { onBack: vi.fn(), onRestore: vi.fn(), onBringBack: vi.fn(), onPlus: vi.fn() }
    render(<HistoryPanel revisions={[revision('r1', 'The boats came in early.', 0), revision('r2', 'The boats came in late.', 2 * HOUR)]} keepsAll {...handlers} readOnly />)
    await userEvent.click(screen.getByText('2h ago'))
    expect(screen.getByText('late').tagName).toBe('DEL')
    expect(screen.queryByRole('button', { name: /Restore this whole version/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Bring back/ })).toBeNull()
  })

  it('compares a version, once opened, with the newest', async () => {
    setup([revision('r1', 'The boats came in early.', 0), revision('r2', 'The boats came in late.', 2 * HOUR)])
    expect(screen.queryByText('late')).toBeNull()

    await userEvent.click(screen.getByText('2h ago'))
    expect(screen.getByRole('heading').textContent).toBe('Today, 10:00 AM → Current')
    expect(screen.getByText('late').tagName).toBe('DEL')
    expect(screen.getByText('early').tagName).toBe('INS')

    await userEvent.click(screen.getByText('← Back'))
    expect(screen.getByText('Current')).toBeTruthy()
    expect(screen.queryByText('late')).toBeNull()
  })

  it('compares with the text as stored, when it is given', async () => {
    const handlers = { onBack: vi.fn(), onRestore: vi.fn(), onBringBack: vi.fn(), onPlus: vi.fn() }
    const now = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The boats came in at dawn.' }] }] }
    render(<HistoryPanel revisions={[revision('r1', 'The boats came in early.', 0), revision('r2', 'The boats came in late.', 2 * HOUR)]} now={now} keepsAll {...handlers} />)
    await userEvent.click(screen.getByText('2h ago'))
    expect(screen.getByText('late').tagName).toBe('DEL')
    expect(screen.getByText('at dawn').tagName).toBe('INS')
  })

  it('offers nothing to compare for the version already on screen', () => {
    setup([revision('r1', 'current text', 0), revision('r2', 'older text', 2 * HOUR)])
    expect(screen.getByText('Current').closest('button')).toBeNull()
    expect(screen.getByText('2h ago').closest('button')).toBeTruthy()
  })

  it('restores the version being compared', async () => {
    const older = revision('r2', 'older text', 2 * HOUR)
    const { onRestore } = setup([revision('r1', 'current text', 0), older])
    await userEvent.click(screen.getByText('2h ago'))
    await userEvent.click(screen.getByText('Restore this whole version'))
    expect(onRestore).toHaveBeenCalledWith(older)
  })

  describe('without Plus', () => {
    it('counts the older ones by their times, read or not', () => {
      const now = Date.now()
      const handlers = { onBack: vi.fn(), onRestore: vi.fn(), onBringBack: vi.fn(), onPlus: vi.fn() }
      render(<HistoryPanel revisions={[revision('r1', 'now', 0)]} times={[now, now - 7 * DAY, now - 40 * DAY, now - 60 * DAY]} keepsAll={false} {...handlers} />)
      expect(screen.getByText('2 older versions, from before the last 30 days')).toBeTruthy()
    })

    it('shows the last 30 days, and counts what is older', () => {
      setup([revision('r1', 'now', 0), revision('r2', 'last week', 7 * DAY), revision('r3', 'old', 40 * DAY), revision('r4', 'older', 60 * DAY)], false)
      expect(screen.getByText('Current')).toBeTruthy()
      expect(screen.getByText('last week')).toBeTruthy()
      expect(versions()).toHaveLength(2)
      expect(screen.getByText('2 older versions, from before the last 30 days')).toBeTruthy()
    })

    it('leads the older versions to Nib Plus', async () => {
      const { onPlus } = setup([revision('r1', 'now', 0), revision('r2', 'old', 40 * DAY)], false)
      await userEvent.click(screen.getByText('1 older version, from before the last 30 days'))
      expect(onPlus).toHaveBeenCalledWith('1 older version is kept. Nib Plus shows every version, not just the last 30 days.')
    })

    it('still shows the text on screen when it was last changed long ago', () => {
      setup([revision('r1', 'untouched', 90 * DAY), revision('r2', 'before', 100 * DAY)], false)
      expect(screen.getByText('Current')).toBeTruthy()
      expect(screen.getByText(/1 older version/)).toBeTruthy()
    })

    it('says nothing about Plus while everything is within the 30 days', () => {
      setup([revision('r1', 'now', 0), revision('r2', 'before', 29 * DAY)], false)
      expect(screen.queryByText(/Plus/)).toBeNull()
    })
  })

  it('shows every version with Plus', () => {
    setup([revision('r1', 'now', 0), revision('r2', 'old', 40 * DAY), revision('r3', 'older', 400 * DAY)])
    expect(versions()).toHaveLength(3)
    expect(screen.queryByText(/Plus/)).toBeNull()
  })

  it('brings a paragraph back from the version being compared, with the text it was compared with', async () => {
    const older = revision('r2', 'The boats came in late.', 2 * HOUR)
    const newest = revision('r1', 'The boats came in early.', 0)
    const { onBringBack } = setup([newest, older])
    await userEvent.click(screen.getByText('2h ago'))
    await userEvent.click(screen.getByRole('button', { name: /^Bring back/ }))
    expect(onBringBack).toHaveBeenCalledWith(older, newest.body, older.body)
  })

  it('compares an empty version: everything since is added', async () => {
    setup([revision('r1', 'Written since.', 0), revision('r2', '', 2 * HOUR)])
    await userEvent.click(screen.getByText('2h ago'))
    expect(screen.getByText('Written since.').tagName).toBe('INS')
  })
})

describe('a long history', () => {
  const handlers = { onBack: vi.fn(), onRestore: vi.fn(), onBringBack: vi.fn(), onPlus: vi.fn() }

  it('asks for more as the list nears the end of those read', () => {
    const onMore = vi.fn()
    const read = Array.from({ length: 40 }, (_, i) => revision(`r${i}`, `text ${i}`, i * HOUR))
    const now = Date.now()
    const { container } = render(<HistoryPanel revisions={read} times={Array.from({ length: 90 }, (_, i) => now - i * HOUR)} keepsAll onMore={onMore} {...handlers} />)
    const list = container.firstElementChild as HTMLElement
    Object.defineProperties(list, { scrollHeight: { value: 3000, configurable: true }, clientHeight: { value: 800, configurable: true }, scrollTop: { value: 1800, writable: true, configurable: true } })
    fireEvent.scroll(list)
    expect(onMore).toHaveBeenCalledOnce()
  })

  it('stops asking once all are read', () => {
    const onMore = vi.fn()
    const read = [revision('r0', 'now', 0), revision('r1', 'then', HOUR)]
    const { container } = render(<HistoryPanel revisions={read} keepsAll onMore={onMore} {...handlers} />)
    fireEvent.scroll(container.firstElementChild as HTMLElement)
    expect(onMore).not.toHaveBeenCalled()
  })
})
