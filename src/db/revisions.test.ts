// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { db } from './db'
import * as revisions from './revisions'

const body = (value: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }],
})

const MINUTE = 60_000
const START = new Date('2026-08-07T09:00:00Z').getTime()

beforeEach(() => db.revisions.clear())

describe('record', () => {
  it('keeps the first revision of a document', async () => {
    await revisions.record('doc', body('one'), { now: START })
    const all = await revisions.list('doc')
    expect(all).toHaveLength(1)
    expect(all[0].body).toEqual(body('one'))
  })

  it('folds rapid edits into one revision instead of one per save', async () => {
    await revisions.record('doc', body('a'), { now: START })
    await revisions.record('doc', body('ab'), { now: START + 1_000 })
    await revisions.record('doc', body('abc'), { now: START + 2_000 })

    const all = await revisions.list('doc')
    expect(all).toHaveLength(1)
    expect(all[0].body).toEqual(body('abc'))
  })

  it('keeps the window anchored so it actually expires', async () => {
    // Folding must not push the timestamp forward, or a long session would
    // never produce a second revision.
    await revisions.record('doc', body('a'), { now: START })
    await revisions.record('doc', body('b'), { now: START + 4 * MINUTE })
    expect(await revisions.list('doc')).toHaveLength(1)

    await revisions.record('doc', body('c'), { now: START + 6 * MINUTE })
    expect(await revisions.list('doc')).toHaveLength(2)
  })

  it('opens a new revision once the window has passed', async () => {
    await revisions.record('doc', body('one'), { now: START })
    await revisions.record('doc', body('two'), { now: START + 10 * MINUTE })

    const all = await revisions.list('doc')
    expect(all.map((r) => r.body)).toEqual([body('two'), body('one')])
  })

  // A device whose clock runs fast stamps its revisions in the future, and
  // every save here until that time came was folded into one of them.
  it('opens a new revision rather than fold into one stamped in the future', async () => {
    await db.revisions.add({ id: 'ahead', itemId: 'doc', body: body('from a fast clock'), createdAt: START + 60 * MINUTE })
    await revisions.record('doc', body('written here'), { now: START })
    // And not a new one per save after it, either.
    await revisions.record('doc', body('written here, and more'), { now: START + 1_000 })

    const all = await revisions.list('doc')
    expect(all.map((revision) => revision.body)).toEqual([body('from a fast clock'), body('written here, and more')])
  })

  it('lists newest first', async () => {
    for (let i = 0; i < 3; i++) {
      await revisions.record('doc', body(`v${i}`), { now: START + i * 10 * MINUTE })
    }
    expect((await revisions.list('doc')).map((r) => r.body)).toEqual([
      body('v2'),
      body('v1'),
      body('v0'),
    ])
  })

  it('keeps documents separate', async () => {
    await revisions.record('a', body('from a'), { now: START })
    await revisions.record('b', body('from b'), { now: START })
    expect(await revisions.list('a')).toHaveLength(1)
    expect((await revisions.list('b'))[0].body).toEqual(body('from b'))
  })
})

describe('force', () => {
  it('starts a new revision even inside the fold window', async () => {
    await revisions.record('doc', body('draft'), { now: START })
    await revisions.record('doc', body('changed'), { now: START + 1_000, force: true })
    expect(await revisions.list('doc')).toHaveLength(2)
  })
})

describe('duplicates', () => {
  it('does not store the same text twice in a row', async () => {
    await revisions.record('doc', body('same'), { now: START })
    await revisions.record('doc', body('same'), { now: START + 10 * MINUTE })
    await revisions.record('doc', body('same'), { now: START + 20 * MINUTE, force: true })
    expect(await revisions.list('doc')).toHaveLength(1)
  })

  it('still records text that returns after a change', async () => {
    await revisions.record('doc', body('a'), { now: START })
    await revisions.record('doc', body('b'), { now: START + 10 * MINUTE })
    await revisions.record('doc', body('a'), { now: START + 20 * MINUTE })
    expect((await revisions.list('doc')).map((r) => r.body)).toEqual([
      body('a'),
      body('b'),
      body('a'),
    ])
  })
})

describe('keeping', () => {
  // Without Plus, History shows the last 30 days (HistoryPanel); what's older
  // is kept here, for Plus to show again.
  it('never trims, however many versions or however old', async () => {
    for (let i = 0; i < 150; i++) {
      await revisions.record('doc', body(`v${i}`), { now: START + i * 24 * 60 * MINUTE })
    }
    const all = await revisions.list('doc')
    expect(all).toHaveLength(150)
    expect(all.at(-1)!.body).toEqual(body('v0'))
  })
})

describe('reading less', () => {
  it('reads a page of the newest versions, and the time of every one', async () => {
    for (let n = 0; n < 5; n++) await revisions.record('a', body(`v${n}`), { now: START + n, force: true })
    expect((await revisions.latest('a', 2)).map((version) => version.createdAt)).toEqual([START + 4, START + 3])
    expect(await revisions.times('a')).toEqual([START + 4, START + 3, START + 2, START + 1, START])
  })
})

describe('removeFor', () => {
  it('doesn’t read the versions’ text to delete them', async () => {
    await revisions.record('b', body('drop'), { now: START })
    const reads = vi.spyOn(db.revisions, 'get')
    const whole = vi.spyOn(Object.getPrototypeOf(db.revisions.toCollection()), 'toArray')
    await revisions.removeFor('b')
    expect(whole).not.toHaveBeenCalled()
    expect(reads).not.toHaveBeenCalled()
    whole.mockRestore()
    reads.mockRestore()
    expect(await revisions.list('b')).toHaveLength(0)
  })

  it('drops every revision of a document and leaves others alone', async () => {
    await revisions.record('a', body('keep'), { now: START })
    await revisions.record('b', body('drop'), { now: START })
    await revisions.removeFor('b')

    expect(await revisions.list('b')).toHaveLength(0)
    expect(await revisions.list('a')).toHaveLength(1)
  })
})
