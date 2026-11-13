// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import type { Item } from '../db/db'
import { Library } from './Library'

/** The library's cards and footer (components/Library); its layout is checked in library.browser.test. */

const item = (id: string, text: string, extra: Partial<Item> = {}): Item => ({
  id,
  kind: 'note',
  body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  version: 1,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  ...extra,
})

const props = (extra: Partial<ComponentProps<typeof Library>> = {}): ComponentProps<typeof Library> => ({
  open: true,
  archived: 0,
  onOpenSettings: vi.fn(),
  kind: 'note',
  onKindChange: vi.fn(),
  query: '',
  onQueryChange: vi.fn(),
  searching: false,
  items: [],
  activeId: null,
  onSelect: vi.fn(),
  onDelete: vi.fn(),
  all: [],
  onTogglePin: vi.fn(),
  onNew: vi.fn(),
  sort: 'updated',
  onSortChange: vi.fn(),
  trash: [],
  onViewTrash: vi.fn(),
  onManage: vi.fn(),
  saveFailed: false,
  notice: null,
  onDismissNotice: vi.fn(),
  plus: false,
  sync: { status: { state: 'off' }, code: null, known: true, create: async () => '', join: async () => {}, turnOff: async () => {}, wipe: async () => {}, changeCode: async () => '', signing: async () => null, requireSigned: async () => {}, filesRoom: async () => null, manual: false, setManual: () => {}, syncNow: () => {}, refetch: async () => {}, inboxAddress: async () => undefined, newInboxAddress: async () => ({ address: '', clipper: '' }), endInbox: async () => {} },
  place: null,
  onPlaceChange: vi.fn(),
  library: { folders: [], categories: [] },
  run: vi.fn(),
  onExport: vi.fn(async () => {}),
  unlimited: true,
  onLimit: vi.fn(),
  ...extra,
})

describe('select mode', () => {
  it('is left when the library is put away', async () => {
    const one = item('a', 'One')
    const { rerender } = render(<Library {...props({ items: [one], all: [one] })} />)
    await userEvent.click(screen.getByRole('button', { name: 'Select' }))
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy()
    rerender(<Library {...props({ items: [one], all: [one], open: false })} />)
    rerender(<Library {...props({ items: [one], all: [one], open: true })} />)
    expect(screen.queryByRole('button', { name: 'Done' })).toBeNull()
  })
})

describe('a card', () => {
  it('says which card its buttons are for', () => {
    render(<Library {...props({ items: [item('a', 'Ask Mara'), item('b', 'Bread', { pinnedAt: 1 })] })} />)
    expect(screen.getByLabelText('Pin Ask Mara')).toBeTruthy()
    expect(screen.getByLabelText('Unpin Bread')).toBeTruthy()
    expect(screen.getByLabelText('Move Ask Mara to trash')).toBeTruthy()
  })

  it('shows each item by its first line, and opens the one clicked', async () => {
    const shown = props({ items: [item('a', 'Ask Mara'), item('b', 'Bread, corrected')] })
    render(<Library {...shown} />)
    expect(screen.getByText('Bread, corrected')).toBeTruthy()
    await userEvent.click(screen.getByText('Ask Mara'))
    expect(shown.onSelect).toHaveBeenCalledWith('a')
  })

  it('trashes in a single click, because trashing is undoable', async () => {
    const shown = props({ items: [item('a', 'Ask Mara')] })
    render(<Library {...shown} />)
    await userEvent.click(screen.getByLabelText(/^Move .* to trash$/))
    expect(shown.onDelete).toHaveBeenCalledWith('a')
    // The card underneath must not also open.
    expect(shown.onSelect).not.toHaveBeenCalled()
  })

  it('offers Pin on an unpinned item and Unpin on a pinned one', async () => {
    const shown = props({ items: [item('a', 'plain'), item('b', 'sticky', { pinnedAt: Date.now() })] })
    render(<Library {...shown} />)
    expect(screen.getByLabelText(/^Pin /)).toBeTruthy()
    await userEvent.click(screen.getByLabelText(/^Unpin /))
    expect(shown.onTogglePin).toHaveBeenCalledWith('b')
  })

  // A push pin, not a glyph: empty unpinned, filled pinned (index.css leans
  // the one and stands the other up, data-pinned).
  it('draws the pin as a push pin, empty unpinned and filled pinned', () => {
    render(<Library {...props({ items: [item('a', 'plain'), item('b', 'sticky', { pinnedAt: Date.now() })] })} />)
    const pin = screen.getByLabelText(/^Pin /)
    const unpin = screen.getByLabelText(/^Unpin /)
    expect(pin.textContent).toBe('')
    expect(pin.querySelectorAll('svg path')).toHaveLength(2)
    expect(pin.hasAttribute('data-pinned')).toBe(false)
    expect(unpin.hasAttribute('data-pinned')).toBe(true)
    expect(pin.querySelector('path')!.getAttribute('fill-opacity')).toBe('0')
    expect(unpin.querySelector('path')!.getAttribute('fill-opacity')).toBe('1')
  })

  // On a change only, not when a card is first drawn. That it comes off once
  // played is checked with real animations, in library.browser.test.
  it('presses the pin in when a card is pinned and pulls it out when unpinned', () => {
    const shown = props({ items: [item('a', 'plain')] })
    const { container, rerender } = render(<Library {...shown} />)
    const card = container.querySelector<HTMLElement>('[data-id="a"]')!
    expect(card.dataset.pinning).toBeUndefined()

    rerender(<Library {...shown} items={[item('a', 'plain', { pinnedAt: Date.now() })]} />)
    expect(card.dataset.pinning).toBe('in')
    rerender(<Library {...shown} items={[item('a', 'plain')]} />)
    expect(card.dataset.pinning).toBe('out')
  })

  it('names the tab a result came from only while searching', () => {
    const both = [item('a', 'a note'), item('b', 'a page', { kind: 'page' })]
    const { unmount } = render(<Library {...props({ items: both })} />)
    expect(screen.queryByText('Page')).toBeNull()
    unmount()
    render(<Library {...props({ items: both, searching: true })} />)
    expect(screen.getByText('Page')).toBeTruthy()
    expect(screen.getByText('Note')).toBeTruthy()
  })

  it('falls back to Untitled rather than showing a blank card', () => {
    render(<Library {...props({ items: [item('a', '   ')] })} />)
    expect(screen.getByText('Untitled')).toBeTruthy()
  })

  it('shows what follows the title, but nothing of a locked note, whose text is sealed', () => {
    const two = (id: string, extra: Partial<Item> = {}): Item => ({
      ...item(id, ''),
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A title' }] }, { type: 'paragraph', content: [{ type: 'text', text: 'What comes next' }] }] },
      ...extra,
    })
    const { unmount } = render(<Library {...props({ items: [two('a')] })} />)
    expect(screen.getByText('What comes next')).toBeTruthy()
    unmount()
    render(<Library {...props({ items: [two('a', { vault: { salt: 'A'.repeat(22), sealed: 'B'.repeat(40) } })] })} />)
    expect(screen.queryByText('What comes next')).toBeNull()
  })
})

describe('a locked note’s card, while the vault is shut', () => {
  it('shows no folder or categories; another note’s still does', () => {
    const filed = { folder: 'Lawyer', categories: [{ name: 'Custody', color: 'red' as const }] }
    render(<Library {...props({ items: [item('l', '', { ...filed, vault: { salt: 'A'.repeat(22), sealed: 'B'.repeat(40) } }), item('o', 'Open', { folder: 'Novel', categories: [{ name: 'Draft', color: 'blue' }] })] })} />)
    expect(screen.queryByText('Lawyer')).toBeNull()
    expect(screen.queryByLabelText('Custody')).toBeNull()
    expect(screen.getByText('Novel')).toBeTruthy()
    expect(screen.getByLabelText('Draft')).toBeTruthy()
  })
})

describe('the library’s footer', () => {
  it('shows the Plus badge in place of the lock once Plus is active', () => {
    const { rerender, container } = render(<Library {...props()} />)
    expect(container.querySelector('footer svg')).not.toBeNull()
    expect(screen.queryByAltText('Nib Plus')).toBeNull()
    rerender(<Library {...props({ plus: true })} />)
    expect(screen.getByAltText('Nib Plus')).toBeTruthy()
    expect(container.querySelector('footer svg')).toBeNull()
  })

  // The library covers the text, where App's notices show: one raised while
  // it's open, a backup that wouldn't restore, say, would go unseen.
  it('shows a notice in place of where the writing is kept, until dismissed', async () => {
    const shown = props({ notice: 'This is not a Nib backup.' })
    render(<Library {...shown} />)
    expect(screen.getByRole('status').textContent).toBe('This is not a Nib backup.')
    expect(screen.queryByText('Stored on this device')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(shown.onDismissNotice).toHaveBeenCalled()
  })
})
