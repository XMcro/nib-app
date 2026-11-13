// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as items from '../db/items'
import { BACKUP_KIND } from '../lib/backup'
import { ErrorBoundary } from './ErrorBoundary'

function Broken(): never {
  throw new RangeError('Invalid time value')
}

describe('when Nib can’t show something', () => {
  // Without it, a time a Date can't hold, stored, left a blank window on every launch.
  it('says the writing is still here, and saves a backup of it from the database', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await items.create('note', { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Still here' }] }] })
    const save = vi.fn(async (_content: string, _filename: string, _type: string) => {})
    render(
      <ErrorBoundary save={save}>
        <Broken />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('heading', { name: 'Nib couldn’t show this' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Save a backup' }))
    await waitFor(() => expect(save).toHaveBeenCalledOnce())
    const [content, filename, type] = save.mock.calls[0]
    expect(JSON.parse(content)).toMatchObject({ kind: BACKUP_KIND })
    expect(content).toContain('Still here')
    expect(filename).toMatch(/\.json$/)
    expect(type).toBe('application/json;charset=utf-8')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('says so when the backup can’t be saved', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary save={async () => Promise.reject(new Error('no room'))}>
        <Broken />
      </ErrorBoundary>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save a backup' }))
    expect((await screen.findByRole('status')).textContent).toBe('Couldn’t save a backup.')
  })
})
