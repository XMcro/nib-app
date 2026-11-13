import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy } from './csp'
import { isFileId, MAX_FILE } from './fileRef'
import { fileUrl, forgetFile, hasFile, keepFile, listFiles, namedFile, readFile } from './files'

/** The file store as a browser has it (lib/files): the app's own side, files in its Library folder, is seen on a device. */

const bytesAt = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer())

describe('a file kept on this device', () => {
  it('is found again by the id it was given, byte for byte, at an address the page may show a picture from', async () => {
    const bytes = Uint8Array.from({ length: 3000 }, (_, at) => at % 251)
    const id = await keepFile(new Blob([bytes], { type: 'image/png' }))
    expect(isFileId(id)).toBe(true)
    const url = await fileUrl(id)
    expect(await bytesAt(url!)).toEqual(bytes)
    expect(await fileUrl(id)).toBe(url)
    // The built page's policy lets a picture come from its own origin or a `data:` address, and nowhere else: not a `blob:`
    // one, which is what a browser would give for a file and what broke every original shown in one.
    const policy = await contentSecurityPolicy('<html><head><meta charset="UTF-8" /></head></html>')
    const allowed = /img-src ([^;]+)/.exec(policy)![1].split(' ')
    expect(allowed).toEqual(["'self'", 'data:'])
    expect(allowed).toContain(`${new URL(url!).protocol}`)
    // Each its own id.
    expect(await keepFile(new Blob([bytes]))).not.toBe(id)
  })

  it('isn’t kept when it’s empty, or over what one file may be', async () => {
    expect(await keepFile(new Blob([]))).toBeNull()
    expect(await keepFile(new Blob([new Uint8Array(MAX_FILE + 1)]))).toBeNull()
    expect(isFileId(await keepFile(new Blob([new Uint8Array(MAX_FILE)])))).toBe(true)
  })

  it('has no address for a file that isn’t here, nor for anything that isn’t an id of its own', async () => {
    expect(await fileUrl('7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d')).toBeNull()
    for (const not of ['', '../index', 'https://example.com/a.png', 'files/x', 42, null, undefined, { id: 'x' }]) expect(await fileUrl(not)).toBeNull()
  })

  it('is read back whole, for what’s made from it; and not at all when it isn’t here, or isn’t an id of its own', async () => {
    const bytes = Uint8Array.from({ length: 3000 }, (_, at) => at % 241)
    const id = (await keepFile(new Blob([bytes], { type: 'image/png' })))!
    expect(new Uint8Array(await (await readFile(id))!.arrayBuffer())).toEqual(bytes)
    expect(await readFile('7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d')).toBeNull()
    for (const not of ['', '../index', 'files/x', 42, null, undefined]) expect(await readFile(not)).toBeNull()
    await forgetFile(id)
    expect(await readFile(id)).toBeNull()
  })

  it('is kept under the id it already has when it comes from the server, and found by whoever asked before it came', async () => {
    const id = '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d'
    await forgetFile(id)
    // Asked for, and not here yet.
    expect(await fileUrl(id)).toBeNull()
    const bytes = Uint8Array.from({ length: 2000 }, (_, at) => at % 239)
    expect(await keepFile(new Blob([bytes], { type: 'image/png' }), id)).toBe(id)
    expect(await bytesAt((await fileUrl(id))!)).toEqual(bytes)
    // Never under a name that isn't an id of its own.
    for (const not of ['', '../index', 'files/x']) expect(await keepFile(new Blob([bytes]), not)).toBeNull()
    await forgetFile(id)
  })

  it('is listed with every other kept here, by its id and its size, till it’s forgotten', async () => {
    for (const file of await listFiles()) await forgetFile(file.id)
    expect(await listFiles()).toEqual([])
    const one = (await keepFile(new Blob([new Uint8Array(3000)])))!
    const two = (await keepFile(new Blob([new Uint8Array(500)])))!
    expect((await listFiles()).sort((a, b) => b.size - a.size)).toEqual([{ id: one, size: 3000 }, { id: two, size: 500 }])
    await forgetFile(one)
    expect(await listFiles()).toEqual([{ id: two, size: 500 }])
  })

  it('says whether it’s here without reading it, and is played from a `data:` address under its own kind', async () => {
    const bytes = Uint8Array.from({ length: 1200 }, (_, at) => at % 199)
    const id = (await keepFile(new Blob([bytes], { type: 'audio/mp4' })))!
    expect(await hasFile(id)).toBe(true)
    const named = (await namedFile(id, 'Voice memo.m4a'))!
    expect(named.uri).toBeNull()
    expect(named.url.startsWith('data:audio/mp4;base64,')).toBe(true)
    expect(await bytesAt(named.url)).toEqual(bytes)
    await forgetFile(id)
    expect(await hasFile(id)).toBe(false)
    expect(await namedFile(id, 'Voice memo.m4a')).toBeNull()
  })

  it('is gone once forgotten', async () => {
    const id = (await keepFile(new Blob(['a file'])))!
    expect(await fileUrl(id)).not.toBeNull()
    await forgetFile(id)
    expect(await fileUrl(id)).toBeNull()
    // And forgetting what isn't there, or isn't an id, is nothing.
    await forgetFile(id)
    await forgetFile('../index')
  })
})
