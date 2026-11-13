// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { foldsOf, keepFolds } from './folds'

beforeEach(() => localStorage.clear())

describe('the folds this device keeps', () => {
  it('are a document’s own, and none for one with no id yet', () => {
    keepFolds('a', ['2 Tides'])
    keepFolds('b', ['1 Harbour', '2 Ferries'])
    expect(foldsOf('a')).toEqual(['2 Tides'])
    expect(foldsOf('b')).toEqual(['1 Harbour', '2 Ferries'])
    expect(foldsOf('c')).toEqual([])
    expect(foldsOf(null)).toEqual([])
  })

  it('go when a document has none left', () => {
    keepFolds('a', ['2 Tides'])
    keepFolds('a', [])
    expect(localStorage.getItem('nib-folds')).toBe('{}')
  })

  it('are kept for two hundred documents, the ones longest left alone going first', () => {
    for (let n = 0; n < 200; n++) keepFolds(`doc-${n}`, ['2 Tides'])
    keepFolds('doc-0', ['2 Ferries'])
    keepFolds('one more', ['2 Tides'])
    expect(foldsOf('doc-0')).toEqual(['2 Ferries'])
    expect(foldsOf('doc-1')).toEqual([])
    expect(foldsOf('doc-2')).toEqual(['2 Tides'])
    expect(Object.keys(JSON.parse(localStorage.getItem('nib-folds')!))).toHaveLength(200)
  })

  it('read as none when what is stored is not theirs', () => {
    for (const stored of ['nonsense', '[]', '{"a":"2 Tides"}', '{"a":[1]}']) {
      localStorage.setItem('nib-folds', stored)
      expect(foldsOf('a')).toEqual([])
    }
  })
})
