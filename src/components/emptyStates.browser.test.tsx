import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import '../index.css'
import { applyTheme } from '../lib/theme'
import { Library } from './Library'
import { TrashList } from './TrashList'

/** Grey that ignored the theme: about 1.8:1 on Gruvbox Light, and a near-black field on every named dark theme. */

afterEach(() => {
  cleanup()
  applyTheme('light')
})

/** What a colour token comes to on the page. */
function resolved(property: 'color' | 'backgroundColor', token: string) {
  const probe = document.body.appendChild(document.createElement('div'))
  probe.style[property] = `var(${token})`
  const value = getComputedStyle(probe)[property]
  probe.remove()
  return value
}

describe('what’s drawn in the theme’s own colours', () => {
  it('the words of an empty list', () => {
    applyTheme('gruvbox-light')
    render(<TrashList items={[]} onBack={vi.fn()} onRestore={vi.fn()} onPurge={vi.fn()} onPurgeAll={vi.fn()} />)
    const words = screen.getByText('Trash is empty.')
    expect(getComputedStyle(words).color).toBe(resolved('color', '--color-muted'))
  })

  it('the search field, on a named dark theme', async () => {
    await page.viewport(1280, 800)
    applyTheme('midnight-blue')
    const props = { open: true, onOpenSettings: vi.fn(), kind: 'note', onKindChange: vi.fn(), query: '', onQueryChange: vi.fn(), searching: false, items: [], activeId: null, onSelect: vi.fn(), onDelete: vi.fn(), onTogglePin: vi.fn(), onNew: vi.fn(), sort: 'updated', onSortChange: vi.fn(), trash: [], onViewTrash: vi.fn(), onManage: vi.fn(), saveFailed: false, notice: null, onDismissNotice: vi.fn(), plus: false, sync: { code: null, status: { state: 'off' } }, place: null, onPlaceChange: vi.fn(), library: { folders: [], categories: [] }, run: vi.fn(), unlimited: true, onLimit: vi.fn() } as unknown as ComponentProps<typeof Library>
    render(<Library {...props} />)
    expect(getComputedStyle(screen.getByLabelText('Search')).backgroundColor).toBe(resolved('backgroundColor', '--color-paper'))
  })
})
