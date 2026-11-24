// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const folder = vi.hoisted(() => ({
  kept: {} as { name?: string; lost?: boolean },
  choose: vi.fn(),
  forget: vi.fn(async () => {}),
  backUp: vi.fn(),
  which: vi.fn(),
}))
vi.mock('../lib/backupFolder', async (actual) => ({
  ...(await actual<typeof import('../lib/backupFolder')>()),
  folderPlugin: { folder: async () => folder.kept, choose: folder.choose, forget: folder.forget },
  backUp: folder.backUp,
  setWhichFolders: folder.which,
}))

const { BackupFolderPanel } = await import('./BackupFolderPanel')

const AT = new Date(2026, 10, 21, 9, 30).getTime()
beforeEach(() => {
  folder.kept = {}
  for (const mock of [folder.choose, folder.forget, folder.backUp, folder.which]) mock.mockClear()
  localStorage.clear()
})
afterEach(cleanup)

describe('Settings → Backup to a folder', () => {
  it('has a folder chosen, and backs up to it at once, saying how it went', async () => {
    folder.choose.mockResolvedValue({ name: 'Backups' })
    folder.backUp.mockResolvedValue({ at: AT, day: '2026-11-21', written: 12, removed: 1 })
    render(<BackupFolderPanel folders={[]} onBack={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Choose a folder' }))
    expect(folder.backUp).toHaveBeenCalledOnce()
    expect(await screen.findByText('Writing to Backups')).toBeTruthy()
    expect(screen.getByText(/12 files written, 1 taken away\.$/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back up now' })).toBeTruthy()
  })

  it('says when the folder can’t be found, and lets it be chosen again', async () => {
    folder.kept = { lost: true }
    render(<BackupFolderPanel folders={[]} onBack={vi.fn()} />)
    expect(await screen.findByText(/can’t find the folder/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Choose a folder' })).toBeTruthy()
  })

  it('stops, letting the folder go', async () => {
    folder.kept = { name: 'Backups' }
    render(<BackupFolderPanel folders={[]} onBack={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Stop backing up' }))
    expect(folder.forget).toHaveBeenCalledOnce()
    expect(await screen.findByRole('button', { name: 'Choose a folder' })).toBeTruthy()
  })

  it('sends all the writing, or only the folders ticked', async () => {
    render(<BackupFolderPanel folders={['Novel', 'Novel/Part One', 'Kitchen']} onBack={vi.fn()} />)
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'All your writing' }).checked).toBe(true)
    expect(screen.queryByRole('group', { name: 'Folders' })).toBeNull()
    await userEvent.click(screen.getByRole('radio', { name: 'Only these folders' }))
    expect(folder.which).toHaveBeenLastCalledWith([])
    await userEvent.click(screen.getByRole('checkbox', { name: 'Novel › Part One' }))
    expect(folder.which).toHaveBeenLastCalledWith(['Novel/Part One'])
    await userEvent.click(screen.getByRole('radio', { name: 'All your writing' }))
    expect(folder.which).toHaveBeenLastCalledWith(null)
  })
})
