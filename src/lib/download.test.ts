import { beforeEach, describe, expect, it, vi } from 'vitest'

// The Mac app: a file is saved with the Save dialog (ios/App/App/NibSavePlugin.swift), not shared.
const saver = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('@capacitor/core', async (importOriginal) => ({ ...(await importOriginal<typeof import('@capacitor/core')>()), registerPlugin: () => saver }))
vi.mock('./platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('./platform')>()), macApp: true }))

const { SaveRefused, share } = await import('./download')

beforeEach(() => saver.save.mockReset())

describe('saving on the Mac', () => {
  it('saves, or lets the writer cancel, without complaint', async () => {
    saver.save.mockResolvedValueOnce({ saved: true }).mockResolvedValueOnce({ saved: false })
    await expect(share('file:///exports/nib-backup.json')).resolves.toBeUndefined()
    await expect(share('file:///exports/nib-backup.json')).resolves.toBeUndefined()
  })

  // Seen on a Mac, 2026-11-12: with the Desktop in iCloud Drive, macOS wouldn't let Nib write its backup there.
  it('tells a folder that wouldn’t take the file from anything else going wrong', async () => {
    saver.save.mockRejectedValueOnce(Object.assign(new Error('Operation not permitted'), { code: 'refused' }))
    await expect(share('file:///exports/nib-backup.json')).rejects.toBeInstanceOf(SaveRefused)
    saver.save.mockRejectedValueOnce(new Error('Already saving.'))
    await expect(share('file:///exports/nib-backup.json')).rejects.not.toBeInstanceOf(SaveRefused)
  })
})
