// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { db } from '../db/db'
import * as items from '../db/items'
import { buildBackup, parseBackup, serializeBackup } from './backup'
import { filing, libraryOf } from './folders'
import { canSaveTemplate, FREE_TEMPLATES } from './templates'

const body = (text: string): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

beforeEach(async () => {
  await db.items.clear()
  await db.revisions.clear()
})

describe('a template', () => {
  it('is saved as a copy: the words and kind, none of the filing, reminder, expiry or shares, and the original as it was', async () => {
    const id = await items.create('page', body('Chapter: title, then the scene'), { folder: 'Novel', categories: [{ name: 'Draft', color: 'blue' }] })
    await items.setReminder(id, { at: 1794000000000 })
    await items.setExpiry(id, '2026-12-31')
    const before = (await items.get(id))!
    const made = (await items.get((await items.saveAsTemplate(id))!))!
    expect(made).toMatchObject({ kind: 'page', body: body('Chapter: title, then the scene'), template: true })
    for (const field of ['folder', 'categories', 'reminder', 'expires', 'shares', 'pinnedAt', 'deviceOnly'] as const) expect(made[field], field).toBeUndefined()
    expect(made.id).not.toBe(id)
    expect(await items.get(id)).toEqual(before)
  })

  it('stays on this device only when the original does, as a copy does', async () => {
    const id = await items.create('note', body('Kept here'), { deviceOnly: true })
    expect((await items.get((await items.saveAsTemplate(id))!))!.deviceOnly).toBe(true)
  })

  it('isn’t saved from a locked document, whose words are sealed to it', async () => {
    const id = await items.create('note', body(''))
    await db.items.update(id, { vault: { salt: 'A'.repeat(22), sealed: 'B'.repeat(40) } })
    expect(await items.saveAsTemplate(id)).toBeUndefined()
  })

  it('is apart from the lists, as the archive is, whatever else it is', async () => {
    const note = await items.create('note', body('A note'))
    const template = (await items.saveAsTemplate(note))!
    const pageTemplate = await items.create('page', body('A page template'), { template: true })
    await items.setArchived(pageTemplate, true)
    const { notes, pages, archived, templates } = items.sortOut(await items.listAll())
    expect(notes.map((item) => item.id)).toEqual([note])
    expect(pages).toEqual([])
    expect(archived).toEqual([])
    expect(templates.map((item) => item.id).sort()).toEqual([template, pageTemplate].sort())
  })

  it('is one in a backup too', async () => {
    const id = await items.create('note', body('Letter'), { template: true })
    const file = serializeBackup(buildBackup(await items.listAll(), [], {}, 1))
    expect(parseBackup(file).items.find((item) => item.id === id)?.template).toBe(true)
  })
})

describe('a document from a template', () => {
  it('has its words and kind, is filed as it’s told, and leaves the template as it was', async () => {
    const id = await items.create('page', body('Chapter'), { template: true })
    const before = (await items.get(id))!
    const made = (await items.get((await items.fromTemplate(id, { folder: 'Novel' }))!))!
    expect(made).toMatchObject({ kind: 'page', body: body('Chapter'), folder: 'Novel' })
    expect(made.template).toBeUndefined()
    expect(await items.get(id)).toEqual(before)
  })

  it('is only on this device if the template is', async () => {
    const id = await items.create('note', body('Kept here'), { template: true, deviceOnly: true })
    expect((await items.get((await items.fromTemplate(id))!))!.deviceOnly).toBe(true)
  })

  it('isn’t made from a locked template, or from what isn’t a template', async () => {
    const locked = await items.create('note', body(''), { template: true })
    await db.items.update(locked, { vault: { salt: 'A'.repeat(22), sealed: 'B'.repeat(40) } })
    expect(await items.fromTemplate(locked)).toBeUndefined()
    expect(await items.fromTemplate(await items.create('note', body('Plain')))).toBeUndefined()
  })

  it('written while the templates are shown, is a template itself, in no folder', () => {
    expect(filing({ templates: true }, libraryOf([]), 'Inbox')).toEqual({ template: true })
  })
})

describe('the free templates', () => {
  it('are three, and any number with Plus', () => {
    expect(FREE_TEMPLATES).toBe(3)
    expect(canSaveTemplate(2, false)).toBe(true)
    expect(canSaveTemplate(3, false)).toBe(false)
    expect(canSaveTemplate(30, true)).toBe(true)
  })
})
