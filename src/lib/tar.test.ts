import { describe, expect, it } from 'vitest'
import { tarEntries } from './tar'
import { tarOf } from './tarOf'

const text = (bytes: Uint8Array, { start, size }: { start: number; size: number }) => new TextDecoder().decode(bytes.subarray(start, start + size))
const listed = (bytes: Uint8Array) => tarEntries(bytes, 100).map((entry) => [entry.name, text(bytes, entry)])

describe('reading a tar', () => {
  it('lists its files, each by name with where its bytes are: none of them copied', () => {
    const bytes = tarOf([{ name: 'a.md', data: 'First' }, { name: 'resources/b.png', data: new Uint8Array(700).fill(7) }, { name: 'c.md', data: '' }, { name: 'd.md', data: 'x'.repeat(512) }])
    const entries = tarEntries(bytes, 100)
    expect(entries.map((entry) => [entry.name, entry.size])).toEqual([['a.md', 5], ['resources/b.png', 700], ['c.md', 0], ['d.md', 512]])
    expect(text(bytes, entries[0])).toBe('First')
    expect(bytes.subarray(entries[1].start, entries[1].start + 700).every((byte) => byte === 7)).toBe(true)
    expect(text(bytes, entries[3])).toBe('x'.repeat(512))
  })

  it('lists only files: not a folder, a link, or anything else a tar can hold', () => {
    expect(listed(tarOf([{ name: 'Takeout/', type: '5' }, { name: 'Takeout/a.json', data: '{}' }, { name: 'link', type: '2' }, { name: 'old-style', data: 'kept', type: '\0' }]))).toEqual([['Takeout/a.json', '{}'], ['old-style', 'kept']])
  })

  it('takes a file’s name from the record before it, where a writer put one: pax’s path, as Takeout writes, or GNU’s long name', () => {
    const long = `Takeout/Google Notizen/${'ä'.repeat(60)}.json`
    expect(listed(tarOf([{ name: 'Takeout/Google Notizen/cut-short', data: '{"a":1}', pax: { mtime: '1711987187.155', path: long } }, { name: 'Takeout/plain.json', data: '{}', pax: { mtime: '1711987187.155' } }, { name: 'cut', data: 'gnu', longName: 'a/very/long/name.md' }, { name: 'after.md', data: 'own' }]))).toEqual([
      [long, '{"a":1}'],
      ['Takeout/plain.json', '{}'],
      ['a/very/long/name.md', 'gnu'],
      ['after.md', 'own'],
    ])
  })

  it('reads a record that is no record as none, without going round for ever on a length of nothing', () => {
    for (const data of ['0 path=evil.md\n', '-5 path=evil.md\n', '999 path=evil.md\n', 'no lengths here', '12 path=evil.md\n', '28 mtime=1711987187.1550000\n0 path=evil.md\n', '']) {
      expect(listed(tarOf([{ name: 'pax', type: 'x', data }, { name: 'own.md', data: 'kept' }]))).toEqual([['own.md', 'kept']])
    }
    // And one that is, after one that gives no path, is still read.
    expect(listed(tarOf([{ name: 'pax', type: 'x', data: '28 mtime=1711987187.1550000\n17 path=given.md\n' }, { name: 'own.md', data: 'kept' }]))).toEqual([['given.md', 'kept']])
  })

  it('puts a long name’s first part before it, as ustar splits one', () => {
    expect(listed(tarOf([{ name: 'note.md', data: 'x', prefix: 'a/deep/folder' }]))).toEqual([['a/deep/folder/note.md', 'x']])
  })

  it('stops at the tar’s end, whatever follows it', () => {
    const bytes = tarOf([{ name: 'a.md', data: 'A' }])
    const padded = new Uint8Array(bytes.length + 4096)
    padded.set(bytes)
    padded.set(tarOf([{ name: 'hidden.md', data: 'B' }]), bytes.length)
    expect(listed(padded)).toEqual([['a.md', 'A']])
    // One cut off before its end marker is read as far as it goes.
    expect(listed(bytes.subarray(0, 1024))).toEqual([['a.md', 'A']])
  })

  it('refuses what isn’t a tar, one whose file runs past its end, a size it can’t read, and more files than asked for', () => {
    expect(() => tarEntries(new TextEncoder().encode('Just some words, not an archive.'.repeat(40)), 100)).toThrow()
    expect(() => tarEntries(new Uint8Array(0), 100)).toThrow()
    const bytes = tarOf([{ name: 'a.md', data: 'x'.repeat(2000) }])
    expect(() => tarEntries(bytes.subarray(0, 1536), 100)).toThrow()
    // A size written the other way some tars write one past 8 GB, in binary, in a header that adds up.
    const binary = tarOf([{ name: 'a.md', data: 'A' }])
    binary[124] = 0x80
    binary.set(new TextEncoder().encode('        '), 148)
    binary.set(new TextEncoder().encode(`${binary.subarray(0, 512).reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0')}\0 `), 148)
    expect(() => tarEntries(binary, 100)).toThrow()
    // A header changed after its sum was taken.
    const changed = tarOf([{ name: 'a.md', data: 'A' }])
    changed[0] = 'b'.charCodeAt(0)
    expect(() => tarEntries(changed, 100)).toThrow()
    const many = tarOf(Array.from({ length: 4 }, (_, i) => ({ name: `${i}.md`, data: 'x' })))
    expect(tarEntries(many, 4)).toHaveLength(4)
    expect(() => tarEntries(many, 3)).toThrow(RangeError)
  })

  it('counts every record toward the most asked for, so a tar of nothing but folders is not walked for ever', () => {
    const folders = tarOf(Array.from({ length: 50 }, (_, i) => ({ name: `d${i}/`, type: '5' })))
    expect(() => tarEntries(folders, 10)).toThrow(RangeError)
  })
})
