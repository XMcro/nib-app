import { beforeEach, describe, expect, it, vi } from 'vitest'

// Capacitor's Filesystem, reduced to the app's Caches folder: a map of path to
// contents, with folders implied by the paths, addressed either relative to
// Caches or by the file:// URI writeFile hands back.
const CACHES = 'file:///caches/'
const files = vi.hoisted(() => new Map<string, string>())
const at = (path: string) => (path.startsWith('file://') ? path.slice('file:///caches/'.length) : path)
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    writeFile: async ({ path, data }: { path: string; data: string }) => {
      files.set(path, data)
      return { uri: `file:///caches/${path}` }
    },
    deleteFile: async ({ path }: { path: string }) => {
      if (!files.delete(at(path))) throw new Error('File does not exist')
    },
    rmdir: async ({ path }: { path: string }) => {
      const inside = [...files.keys()].filter((name) => name.startsWith(`${path}/`))
      if (!inside.length) throw new Error('Directory does not exist')
      for (const name of inside) files.delete(name)
    },
    readdir: async ({ path }: { path: string }) => {
      const names = new Map<string, 'file' | 'directory'>()
      for (const name of files.keys()) {
        if (path && !name.startsWith(`${path}/`)) continue
        const [first, ...rest] = (path ? name.slice(path.length + 1) : name).split('/')
        names.set(first, rest.length ? 'directory' : 'file')
      }
      return { files: [...names].map(([name, type]) => ({ name, type })) }
    },
  },
}))

const { handOverFile, sweepExports, writeExport } = await import('./exportFile')

beforeEach(() => files.clear())

describe('exports in Caches', () => {
  it('are written to a folder of their own', async () => {
    const uri = await writeExport('Chapter one.md', '# Chapter one')
    expect(uri).toBe(`${CACHES}exports/Chapter one.md`)
    expect(files.get('exports/Chapter one.md')).toBe('# Chapter one')
  })

  it('go once handed over, whether that worked or not', async () => {
    const shared = await writeExport('Shared.md', 'text')
    const hand = vi.fn(async () => {})
    await handOverFile(shared, hand)
    expect(hand).toHaveBeenCalledWith(shared)
    expect(files.size).toBe(0)

    const failed = await writeExport('Failed.md', 'text')
    await expect(handOverFile(failed, async () => Promise.reject(new Error('no sheet')))).rejects.toThrow('no sheet')
    expect(files.size).toBe(0)
  })

  it('left over, and those earlier versions kept loose in Caches, are swept at launch', async () => {
    for (const name of [
      'exports/Crashed before it went.md',
      'nib-export-2026-10-01.md',
      'nib-backup-2026-10-01.json',
      'Chapter one.pdf',
      'Chapter one.docx',
      'Chapter one.html',
      'WebKit/NetworkCache/blob',
      'settings.json',
      'notes.md',
    ]) {
      files.set(name, 'x')
    }
    await sweepExports()
    expect([...files.keys()].sort()).toEqual(['WebKit/NetworkCache/blob', 'notes.md', 'settings.json'])
  })

  it('sweep quietly when there is nothing to sweep', async () => {
    await expect(sweepExports()).resolves.toBeUndefined()
  })
})
