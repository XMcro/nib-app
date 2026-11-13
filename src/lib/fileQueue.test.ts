// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { fileRemoved, fileSettled, filesGone, filesWaiting, removeFiles, sendFiles } from './fileQueue'

/** What sync has still to do with files, kept on this device between looks and between launches (lib/fileQueue). */

const A = '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d'
const B = '8c1f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1e'

beforeEach(() => localStorage.clear())

describe('the files sync has still to deal with', () => {
  it('keeps those to send, each once, till each is settled', () => {
    expect(filesWaiting()).toEqual([])
    sendFiles([A])
    sendFiles([A, B])
    sendFiles([])
    expect(filesWaiting()).toEqual([A, B])
    expect(JSON.parse(localStorage.getItem('nib-files-waiting')!)).toEqual([A, B])
    fileSettled(A)
    expect(filesWaiting()).toEqual([B])
  })

  it('keeps those to take off the server, which stop waiting to be sent', () => {
    sendFiles([A, B])
    removeFiles([A])
    expect(filesGone()).toEqual([A])
    expect(filesWaiting()).toEqual([B])
    fileRemoved(A)
    expect(filesGone()).toEqual([])
  })

  it('reads nothing that isn’t a file’s id, whatever the device’s storage holds', () => {
    localStorage.setItem('nib-files-waiting', JSON.stringify([A, '../index', 42, null]))
    localStorage.setItem('nib-files-gone', '{"not":"a list"')
    expect(filesWaiting()).toEqual([A])
    expect(filesGone()).toEqual([])
    localStorage.setItem('nib-files-gone', '{"not":"a list"}')
    expect(filesGone()).toEqual([])
    removeFiles([B])
    expect(filesGone()).toEqual([B])
  })
})
