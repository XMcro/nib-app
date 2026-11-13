// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { shortcut } from '../lib/platform'
import { Library } from './Library'

// The Mac app, by what lib/platform reads to know it is: ⌘N there makes a note whatever the library is showing, and ⇧⌘N a page (AppDelegate's menu).
vi.mock('@capacitor/core', async (original) => ({ ...(await original<typeof import('@capacitor/core')>()), Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios', isPluginAvailable: () => false } }))
vi.hoisted(() => {
  ;(window as { nibPlatform?: string }).nibPlatform = 'mac'
})

const props = (kind: 'note' | 'page') =>
  ({
    open: true,
    onOpenSettings: vi.fn(),
    kind,
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
    sync: { code: null, status: { state: 'inactive' } },
    place: null,
    onPlaceChange: vi.fn(),
    library: { folders: [], categories: [] },
    run: vi.fn(),
    onExport: vi.fn(async () => {}),
    unlimited: false,
    onLimit: vi.fn(),
  }) as unknown as ComponentProps<typeof Library>

describe('an empty library on the Mac names the shortcut that makes what it shows', () => {
  it('⌘N on Notes', () => {
    render(<Library {...props('note')} />)
    expect(screen.getByText(`${shortcut('N')}  new note`, { collapseWhitespace: false })).toBeTruthy()
  })

  it('⇧⌘N on Pages, as ⌘N makes a note there', () => {
    render(<Library {...props('page')} />)
    expect(screen.getByText(`${shortcut('N', { shift: true })}  new page`, { collapseWhitespace: false })).toBeTruthy()
  })
})
