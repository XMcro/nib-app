// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The file store as the app has it (lib/files): real files, in the app's
 * Library folder, through Capacitor's Filesystem, which is stood in for here.
 */
vi.mock('./platform', async (importOriginal) => ({ ...(await importOriginal<typeof import('./platform')>()), nativeApp: true }))
const disk = vi.hoisted(() => ({ files: new Map<string, string>(), folders: new Set<string>(), calls: [] as string[] }))
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Library: 'LIBRARY', Cache: 'CACHE' },
  Filesystem: {
    writeFile: vi.fn(async ({ path, data, directory, recursive }: { path: string; data: string; directory: string; recursive?: boolean }) => {
      disk.calls.push(`write ${directory} ${path} ${recursive ? 'recursive' : ''}`.trim())
      disk.files.set(path, data)
    }),
    appendFile: vi.fn(async ({ path, data, directory }: { path: string; data: string; directory: string }) => {
      disk.calls.push(`append ${directory} ${path}`)
      disk.files.set(path, disk.files.get(path)! + '|' + data)
    }),
    rename: vi.fn(async ({ from, to, directory, toDirectory }: { from: string; to: string; directory: string; toDirectory: string }) => {
      disk.calls.push(`rename ${directory} ${from} -> ${toDirectory} ${to}`)
      disk.files.set(to, disk.files.get(from)!)
      disk.files.delete(from)
    }),
    stat: vi.fn(async ({ path, directory }: { path: string; directory: string }) => {
      disk.calls.push(`stat ${path}`)
      if (!disk.files.has(directory === 'CACHE' ? `CACHE:${path}` : path)) throw new Error('File does not exist')
      return {}
    }),
    getUri: vi.fn(async ({ path, directory }: { path: string; directory: string }) => ({ uri: directory === 'CACHE' ? `file:///app/Library/Caches/${path}` : `file:///app/Library/${path}` })),
    // What's in Caches is kept apart, under `CACHE:`.
    mkdir: vi.fn(async ({ path, directory }: { path: string; directory: string }) => {
      if (disk.folders.has(`${directory}:${path}`)) throw new Error('Directory already exists')
      disk.folders.add(`${directory}:${path}`)
    }),
    copy: vi.fn(async ({ from, directory, to, toDirectory }: { from: string; directory: string; to: string; toDirectory: string }) => {
      disk.calls.push(`copy ${directory} ${from} -> ${toDirectory} ${to}`)
      if (!disk.files.has(from)) throw new Error('File does not exist')
      if (!disk.folders.has(`${toDirectory}:${to.slice(0, to.lastIndexOf('/'))}`)) throw new Error('No such folder')
      disk.files.set(`${toDirectory}:${to}`, disk.files.get(from)!)
    }),
    rmdir: vi.fn(async ({ path, directory }: { path: string; directory: string }) => {
      disk.calls.push(`rmdir ${directory} ${path}`)
      disk.folders.delete(`${directory}:${path}`)
      for (const name of [...disk.files.keys()]) if (name.startsWith(`${directory}:${path}/`)) disk.files.delete(name)
    }),
    readdir: vi.fn(async ({ path, directory }: { path: string; directory: string }) => {
      disk.calls.push(`readdir ${directory} ${path}`)
      const inside = [...disk.files.keys()].filter((name) => name.startsWith(`${path}/`))
      if (inside.length === 0) throw new Error('Folder does not exist')
      return { files: inside.map((name) => ({ name: name.slice(path.length + 1), type: 'file', size: disk.files.get(name)!.length })) }
    }),
    deleteFile: vi.fn(async ({ path }: { path: string }) => {
      disk.calls.push(`delete ${path}`)
      if (!disk.files.delete(path)) throw new Error('File does not exist')
    }),
  },
}))
vi.mock('@capacitor/core', async (importOriginal) => {
  const real = await importOriginal<typeof import('@capacitor/core')>()
  return { ...real, Capacitor: { ...real.Capacitor, convertFileSrc: (uri: string) => uri.replace('file://', 'capacitor://localhost/_capacitor_file_') } }
})

const { fileUrl, forgetFile, hasFile, keepFile, listFiles, namedFile, readFile } = await import('./files')

beforeEach(() => {
  disk.files.clear()
  disk.folders.clear()
  disk.calls.length = 0
})

describe('a file kept by the app', () => {
  it('is written a piece at a time under another name, in the app’s Library folder, and renamed when whole', async () => {
    // A megabyte and a bit: three pieces.
    const id = (await keepFile(new Blob([new Uint8Array(1024 * 1024 + 10)])))!
    expect(disk.calls).toEqual([
      `write LIBRARY files/${id}.part recursive`,
      `append LIBRARY files/${id}.part`,
      `append LIBRARY files/${id}.part`,
      `rename LIBRARY files/${id}.part -> LIBRARY files/${id}`,
    ])
    // All of it, in order, as base64 a piece at a time; and nothing left under the other name.
    const pieces = disk.files.get(`files/${id}`)!.split('|').map((piece) => atob(piece).length)
    expect(pieces).toEqual([512 * 1024, 512 * 1024, 10])
    expect([...disk.files.keys()]).toEqual([`files/${id}`])
  })

  it('is shown from the address the app serves its own files at, once it’s there whole', async () => {
    const id = (await keepFile(new Blob(['a picture'])))!
    expect(await fileUrl(id)).toBe(`capacitor://localhost/_capacitor_file_/app/Library/files/${id}`)
    // One whose writing was cut short has only its other name, and no address.
    disk.files.set('files/7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d.part', 'half')
    expect(await fileUrl('7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d')).toBeNull()
  })

  it('is read back from that address, as the page reads it, and not through the bridge; and not at all when it isn’t there', async () => {
    const id = (await keepFile(new Blob(['a picture'])))!
    const asked: string[] = []
    const fetched = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      asked.push(String(url))
      return new Response('a picture')
    })
    expect(await (await readFile(id))!.text()).toBe('a picture')
    expect(asked).toEqual([`capacitor://localhost/_capacitor_file_/app/Library/files/${id}`])
    // One that isn't on this device is never asked for; one the app won't serve is none.
    expect(await readFile('7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d')).toBeNull()
    expect(asked).toHaveLength(1)
    fetched.mockResolvedValueOnce(new Response('Not found', { status: 404 }))
    expect(await readFile(id)).toBeNull()
    fetched.mockRejectedValueOnce(new TypeError('Load failed'))
    expect(await readFile(id)).toBeNull()
    fetched.mockRestore()
  })

  it('is listed with the others in the app’s folder, and not one half-written or anything else found there', async () => {
    // No folder till the first is kept.
    expect(await listFiles()).toEqual([])
    const id = (await keepFile(new Blob(['a picture'])))!
    disk.files.set('files/7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d.part', 'half')
    disk.files.set('files/.DS_Store', 'x')
    expect(await listFiles()).toEqual([{ id, size: disk.files.get(`files/${id}`)!.length }])
    expect(disk.calls.filter((call) => call.startsWith('readdir'))).toEqual(['readdir LIBRARY files', 'readdir LIBRARY files'])
  })

  it('is opened from a copy under its own name, in Caches, made once: the viewer and the player go by a name to know what a file is', async () => {
    const id = (await keepFile(new Blob(['a recording'])))!
    expect(await hasFile(id)).toBe(true)
    const named = (await namedFile(id, 'Voice memo.m4a'))!
    expect(named).toEqual({
      uri: `file:///app/Library/Caches/opened/${id}/Voice memo.m4a`,
      url: `capacitor://localhost/_capacitor_file_/app/Library/Caches/opened/${id}/Voice memo.m4a`,
    })
    expect(disk.files.get(`CACHE:opened/${id}/Voice memo.m4a`)).toBe(disk.files.get(`files/${id}`))
    expect(await namedFile(id, 'Voice memo.m4a')).toEqual(named)
    expect(disk.calls.filter((call) => call.startsWith('copy'))).toEqual([`copy LIBRARY files/${id} -> CACHE opened/${id}/Voice memo.m4a`])
    // Never a hidden file, nor one outside its own folder.
    expect((await namedFile(id, '.env'))!.uri).toBe(`file:///app/Library/Caches/opened/${id}/env`)
    expect((await namedFile(id, '../../index'))!.uri).toBe(`file:///app/Library/Caches/opened/${id}/index`)
    expect((await namedFile(id, '...'))!.uri).toBe(`file:///app/Library/Caches/opened/${id}/file`)
  })

  it('isn’t opened when it isn’t on this device, nor asked of the app under anything but an id of its own', async () => {
    expect(await hasFile('7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d')).toBe(false)
    expect(await namedFile('7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d', 'report.pdf')).toBeNull()
    disk.calls.length = 0
    for (const not of ['../index', 'files/x', '', 42, null]) {
      expect(await hasFile(not)).toBe(false)
      expect(await namedFile(not, 'report.pdf')).toBeNull()
    }
    expect(disk.calls).toEqual([])
    // One whose copy can't be made isn't opened, and says nothing worse.
    const id = (await keepFile(new Blob(['a picture'])))!
    const { Filesystem } = await import('@capacitor/filesystem')
    vi.mocked(Filesystem.copy).mockRejectedValueOnce(new Error('No space left'))
    expect(await namedFile(id, 'report.pdf')).toBeNull()
  })

  it('takes the copy it was opened from with it when it’s forgotten', async () => {
    const [one, two] = [(await keepFile(new Blob(['one'])))!, (await keepFile(new Blob(['two'])))!]
    await namedFile(one, 'one.pdf')
    await namedFile(two, 'two.pdf')
    await forgetFile(one)
    expect([...disk.files.keys()].sort()).toEqual([`CACHE:opened/${two}/two.pdf`, `files/${two}`].sort())
    // A folder that's there already, for a copy that isn't, is no reason not to make it.
    expect((await namedFile(two, 'two again.pdf'))!.uri).toBe(`file:///app/Library/Caches/opened/${two}/two again.pdf`)
  })

  it('says it couldn’t be kept when the app can’t write it, and leaves nothing shown', async () => {
    const { Filesystem } = await import('@capacitor/filesystem')
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(Filesystem.appendFile).mockRejectedValueOnce(new Error('No space left'))
    expect(await keepFile(new Blob([new Uint8Array(600 * 1024)]))).toBeNull()
    // Nor the half of it that was written.
    expect([...disk.files.keys()]).toEqual([])
    warned.mockRestore()
  })

  it('never asks the app for a path that isn’t an id of its own', async () => {
    disk.files.set('index', 'the library’s own file')
    for (const not of ['../index', '../../Documents/mirror/index.json', 'files/x', '', 42, null]) {
      expect(await fileUrl(not)).toBeNull()
      expect(await readFile(not)).toBeNull()
      await forgetFile(not as string)
    }
    expect(disk.calls).toEqual([])
    expect(disk.files.has('index')).toBe(true)
  })

  it('is deleted when forgotten, and forgetting one that’s gone is nothing', async () => {
    const id = (await keepFile(new Blob(['a picture'])))!
    await forgetFile(id)
    expect(await fileUrl(id)).toBeNull()
    await forgetFile(id)
  })
})
