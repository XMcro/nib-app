import { afterEach, describe, expect, it, vi } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import type { ShareRef } from '../db/db'
import { asShares, newShare, open, revealCheck, revealToken, seal, withPassword } from './crypto'
import { createShare, freeShareHolder, liveShare, readNotes, revokeShare, ShareError, shareStatus, shareUrl, snapshot } from './index'

const PNG = 'data:image/png;base64,iVBORw0KGgo='
const ref = (overrides: Partial<ShareRef> = {}): ShareRef => ({ ...newShare(), createdAt: 1, expiresAt: Date.now() + 86_400_000, ...overrides })

afterEach(() => vi.unstubAllGlobals())

describe('share records from outside', () => {
  it('keep only well-formed ones', () => {
    const good = ref()
    expect(asShares([good, { ...good, slug: 'short' }, { ...good, key: 'x' }, null, 'junk'])).toEqual([good])
    expect(asShares('not a list')).toBeUndefined()
    expect(asShares([])).toEqual([])
  })

  it('keep a password only when it is a short string', () => {
    const good = ref()
    expect(asShares([{ ...good, password: 'tide' }])).toEqual([{ ...good, password: 'tide' }])
    expect(asShares([{ ...good, password: 42 }, { ...good, password: '' }, { ...good, password: 'x'.repeat(201) }])).toEqual([good, good, good])
  })

  it('keep the free mark only when it is true', () => {
    const good = asShares([{ slug: 'S'.repeat(22), key: 'K'.repeat(43), owner: 'O'.repeat(43), createdAt: 1, expiresAt: 2 }])![0]
    expect(asShares([{ ...good, free: true }])).toEqual([{ ...good, free: true }])
    expect(asShares([{ ...good, free: 'yes' }, { ...good, free: false }])).toEqual([good, good])
    // And one to be read once.
    expect(asShares([{ ...good, once: true }])).toEqual([{ ...good, once: true }])
    expect(asShares([{ ...good, once: 'yes' }, { ...good, once: false }])).toEqual([good, good])
  })

  it('find the one document whose live link is the free one', () => {
    const share: ShareRef = { slug: 'S'.repeat(22), key: 'K'.repeat(43), owner: 'O'.repeat(43), createdAt: 1, expiresAt: 100 }
    const doc = (id: string, shares: ShareRef[]) => ({ id, kind: 'note' as const, body: { type: 'doc' }, version: 1, createdAt: 1, updatedAt: 1, shares })
    const documents = [doc('plus', [share]), doc('expired', [{ ...share, free: true, expiresAt: 5 }]), doc('free', [{ ...share, free: true }])]
    expect(freeShareHolder(documents, 10)?.id).toBe('free')
    expect(freeShareHolder(documents.slice(0, 2), 10)).toBeUndefined()
  })

  it('count only a share that hasn’t expired as live', () => {
    const old = ref({ expiresAt: 5 })
    const current = ref()
    expect(liveShare({ shares: [old, current] })).toEqual(current)
    expect(liveShare({ shares: [old] })).toBeUndefined()
  })
})

describe('the snapshot', () => {
  it('keeps pictures that pass the image rule, and a sketch’s picture without its drawing', () => {
    const body: JSONContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'image', attrs: { src: PNG, alt: 'sketch', drawing: 'AAAA' } },
            { type: 'image', attrs: { src: 'https://tracker.example/x.png' } },
          ],
        },
      ],
    }
    const shot = snapshot({ kind: 'page', body })
    expect(shot.v).toBe(1)
    expect(shot.body.content![0].content).toEqual([{ type: 'image', attrs: { src: PNG, alt: 'sketch', sketch: true } }])
    expect(JSON.stringify(shot)).not.toContain('AAAA')
  })
})

describe('a shared draft', () => {
  it('keeps the size a picture is shown at', () => {
    const sized = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: PNG, alt: '', size: 'small' } }] }] }
    expect(snapshot({ kind: 'page', body: sized }).body.content![0].content![0].attrs).toEqual({ src: PNG, alt: '', size: 'small' })
  })

  it('leaves notes to self behind, keeping the words they are on and their other marks', () => {
    const note = { type: 'noteToSelf', attrs: { id: 'n1', text: 'Check the tide times.' } }
    const body: JSONContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'at seven', marks: [{ type: 'bold' }, note] }, { type: 'text', text: ' sharp.', marks: [note] }] }],
    }
    const shot = snapshot({ kind: 'page', body })
    expect(shot.body.content![0].content).toEqual([{ type: 'text', text: 'at seven', marks: [{ type: 'bold' }] }, { type: 'text', text: ' sharp.' }])
    expect(JSON.stringify(shot)).not.toContain('tide')
  })
})

describe('talking to the server', () => {
  it('sends the document sealed, proves the owner with a token, and never sends the key', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ expiresAt: 42 }), { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    const body: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Chapter one' }] }] }
    const share = await createShare({ kind: 'page', body }, 30, 'the-jws', { now: 7 })
    expect(share).toMatchObject({ createdAt: 7, expiresAt: 42 })

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(/\/v1\/shares$/)
    expect((init.headers as Record<string, string>).Authorization).toBe(`Owner ${share.owner}`)
    const sent = JSON.parse(init.body as string)
    expect(sent).toMatchObject({ slug: share.slug, jws: 'the-jws', days: 30 })
    expect(JSON.stringify(sent)).not.toContain('Chapter one')
    expect(JSON.stringify(sent)).not.toContain(share.key)
    expect(await open(share.key, share.slug, 'doc', sent.doc)).toEqual(snapshot({ kind: 'page', body }))
  })

  it('without a receipt, asks for a free share: 7 days, marked free, no password', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ expiresAt: 42 }), { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    const share = await createShare({ kind: 'page', body: { type: 'doc' } }, 7, undefined, { now: 7 })
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    const sent = JSON.parse(String(init.body))
    expect(Object.keys(sent).sort()).toEqual(['days', 'doc', 'slug'])
    expect(sent.days).toBe(7)
    expect(share).toMatchObject({ free: true, expiresAt: 42, createdAt: 7 })
    expect(share.password).toBeUndefined()
  })

  // Junk from someone without the key used to stay on the server, out of
  // the owner's sight, taking up the draft's 200 places.
  it('opens readers’ notes, and deletes any that won’t open', async () => {
    const share = ref()
    const good = await seal(share.key, share.slug, 'note', { quote: 'the lamp', text: 'Lovely.', name: 'Sam' })
    const junk = await seal(newShare().key, share.slug, 'note', { text: 'spam' })
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? new Response(JSON.stringify({ deleted: true }))
        : new Response(JSON.stringify({ notes: [{ id: 1, at: 5, note: good }, { id: 2, at: 6, note: junk }], notesOn: true, expiresAt: 9 })),
    )
    vi.stubGlobal('fetch', fetch)
    expect(await readNotes(share)).toEqual({ notes: [{ id: 1, at: 5, quote: 'the lamp', text: 'Lovely.', name: 'Sam' }], notesOn: true, expiresAt: 9 })
    const deleted = fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE').map(([url]) => url)
    expect(deleted).toHaveLength(1)
    expect(deleted[0]).toMatch(new RegExp(`/v1/shares/${share.slug}/notes/2$`))
  })

  // One that opened but wasn't a note was neither shown nor deleted, so
  // anyone with the link could fill the draft's places out of sight.
  it('deletes a note that opens but isn’t a note', async () => {
    const share = ref()
    const good = await seal(share.key, share.slug, 'note', { text: 'Lovely.' })
    const empty = await seal(share.key, share.slug, 'note', {})
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? new Response(JSON.stringify({ deleted: true }))
        : new Response(JSON.stringify({ notes: [{ id: 1, at: 5, note: good }, { id: 3, at: 7, note: empty }], notesOn: true, expiresAt: 9 })),
    )
    vi.stubGlobal('fetch', fetch)
    expect((await readNotes(share)).notes).toEqual([{ id: 1, at: 5, text: 'Lovely.' }])
    const deleted = fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE').map(([url]) => url)
    expect(deleted).toEqual([expect.stringMatching(/\/notes\/3$/)])
  })

  // Not one opening means the key here is wrong, not that every reader is
  // a stranger: deleting them all would have lost every real note.
  it('deletes nothing when no note opens', async () => {
    const share = ref()
    const elsewhere = newShare().key
    const notes = await Promise.all([1, 2].map(async (id) => ({ id, at: id, note: await seal(elsewhere, share.slug, 'note', { text: `Note ${id}` }) })))
    const fetch = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'DELETE' ? new Response(JSON.stringify({ deleted: true })) : new Response(JSON.stringify({ notes, notesOn: true, expiresAt: 9 })),
    )
    vi.stubGlobal('fetch', fetch)
    expect((await readNotes(share)).notes).toEqual([])
    expect(fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE')).toEqual([])
  })

  // Security finding 5 of the 8 November audit: on a draft with no real notes, junk was never shown and never
  // went, and two hundred random notes told every reader it had all the notes it could take.
  describe('when no note opens', () => {
    const junkNotes = async (slug: string) => Promise.all([1, 2].map(async (id) => ({ id, at: id, note: await seal(newShare().key, slug, 'note', { text: 'spam' }) })))
    const stub = (notes: unknown, draft: () => Response) => {
      const fetch = vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') return new Response(JSON.stringify({ deleted: true }))
        return url.endsWith('/notes') ? new Response(JSON.stringify({ notes, notesOn: true, expiresAt: 9 })) : draft()
      })
      vi.stubGlobal('fetch', fetch)
      return fetch
    }
    const deletes = (fetch: ReturnType<typeof stub>) => fetch.mock.calls.filter(([, init]) => init?.method === 'DELETE').map(([url]) => url)

    it('deletes them once the draft opens with the key held here', async () => {
      const share = ref()
      const doc = await seal(share.key, share.slug, 'doc', { kind: 'note', body: { type: 'doc' } })
      const fetch = stub(await junkNotes(share.slug), () => new Response(JSON.stringify({ doc, expiresAt: 9, notesOn: true })))
      expect((await readNotes(share)).notes).toEqual([])
      expect(deletes(fetch).sort()).toEqual([expect.stringMatching(/\/notes\/1$/), expect.stringMatching(/\/notes\/2$/)])
      // Asked for as its owner, so the server doesn't count the app's own check as a reader opening the link.
      const [, asked] = fetch.mock.calls.find(([url]) => url.endsWith(`/v1/shares/${share.slug}`))!
      expect((asked!.headers as Record<string, string>).Authorization).toBe(`Owner ${share.owner}`)
    })

    it('proves a password’s key on the draft too', async () => {
      const share = ref({ password: 'tide tables' })
      const key = await withPassword(share.key, share.slug, share.password!)
      const doc = await seal(key, share.slug, 'doc', { kind: 'note', body: { type: 'doc' } })
      const fetch = stub(await junkNotes(share.slug), () => new Response(JSON.stringify({ doc, expiresAt: 9, notesOn: true })))
      await readNotes(share)
      expect(deletes(fetch)).toHaveLength(2)
    })

    it('deletes nothing if the draft won’t open with it: that key is the wrong one', async () => {
      const share = ref()
      const doc = await seal(newShare().key, share.slug, 'doc', { kind: 'note', body: { type: 'doc' } })
      const fetch = stub(await junkNotes(share.slug), () => new Response(JSON.stringify({ doc, expiresAt: 9, notesOn: true })))
      expect((await readNotes(share)).notes).toEqual([])
      expect(deletes(fetch)).toEqual([])
    })

    it('deletes nothing if the draft can’t be asked for', async () => {
      const share = ref()
      const fetch = stub(await junkNotes(share.slug), () => new Response('{"error":"Off."}', { status: 503 }))
      await readNotes(share)
      expect(deletes(fetch)).toEqual([])
    })

    it('doesn’t ask for the draft when there’s no note to judge', async () => {
      const share = ref()
      const fetch = stub([], () => new Response('{}'))
      await readNotes(share)
      expect(fetch).toHaveBeenCalledOnce()
    })
  })

  // Security finding 7 of the 8 November audit: any reader could pull a photo's location from the draft.
  it('sends a picture without its words about itself, and leaves the stored one as it was', () => {
    const exif = new TextEncoder().encode('Exif\0\0GPS 51.5')
    const photo = `data:image/jpeg;base64,${btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe1, 0, exif.length + 2, ...exif, 0xff, 0xd9))}`
    const body: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: photo } }] }] }
    const sent = JSON.stringify(snapshot({ kind: 'note', body }))
    expect(sent).toContain(btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xd9)))
    expect(sent).not.toContain(photo.slice(photo.indexOf(',') + 1))
    expect(JSON.stringify(body)).toContain(photo)
  })

  it('sends nothing of a picture’s original: which file it is on the writer’s devices stays there', () => {
    const full = { id: '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d', type: 'image/jpeg', size: 4000000 }
    const src = `data:image/gif;base64,${btoa('GIF89a')}`
    const body: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src, full } }] }] }
    expect(snapshot({ kind: 'note', body }).body.content![0].content).toEqual([{ type: 'image', attrs: { src } }])
  })

  // The red-team review of 2026-11-17: the token came from the link's key whatever else the draft needed, so anyone
  // with the link could have one with a password handed over, and so deleted, without the password.
  it('asks for one to be read once with a password by a token that takes the password to make', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ expiresAt: 42 }), { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    const made = await createShare({ kind: 'page', body: { type: 'doc' } }, 30, 'the-jws', { once: true, password: 'harbour lights' })
    const { reveal } = JSON.parse(String((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body))
    expect(reveal).toBe(await revealCheck(await revealToken(await withPassword(made.key, made.slug, 'harbour lights'), made.slug)))
    expect(reveal).not.toBe(await revealCheck(await revealToken(made.key, made.slug)))
  })

  it('asks for one to be read once only when told to, and only with a receipt', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ expiresAt: 42 }), { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    const sent = (call: number) => JSON.parse(String((fetch.mock.calls[call] as unknown as [string, RequestInit])[1].body))

    const made = await createShare({ kind: 'page', body: { type: 'doc' } }, 30, 'the-jws', { once: true })
    expect(made.once).toBe(true)
    expect(sent(0).once).toBe(true)
    // With the hash of the token its reader will show, from the link's key (the security review of 2026-11-13).
    expect(sent(0).reveal).toBe(await revealCheck(await revealToken(made.key, made.slug)))

    expect('once' in (await createShare({ kind: 'page', body: { type: 'doc' } }, 30, 'the-jws'))).toBe(false)
    expect('once' in sent(1)).toBe(false)
    expect('reveal' in sent(1)).toBe(false)

    // A free link is never one: the server would refuse it.
    const free = await createShare({ kind: 'page', body: { type: 'doc' } }, 7, undefined, { once: true })
    expect(free).toMatchObject({ free: true })
    expect('once' in free).toBe(false)
    expect('once' in sent(2)).toBe(false)
  })

  it('learns from the server, as its owner, whether one to be read once has been, and how many times a counted one was opened', async () => {
    const share = { slug: 'S'.repeat(22), owner: 'O'.repeat(43) }
    const answer = (body: object, status = 200) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))
    const fetch = vi.fn(async () => new Response(JSON.stringify({ notes: [], notesOn: true, expiresAt: 9, once: true, opened: true })))
    vi.stubGlobal('fetch', fetch)
    expect(await shareStatus(share)).toEqual({ read: true })
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toMatch(new RegExp(`/v1/shares/${share.slug}/notes$`))
    expect((init.headers as Record<string, string>).Authorization).toBe(`Owner ${share.owner}`)

    answer({ notes: [], notesOn: true, expiresAt: 9, once: true, opened: false })
    expect(await shareStatus(share)).toEqual({ read: false })
    answer({ notes: [], notesOn: true, expiresAt: 9, once: false, opened: false, opens: 3 })
    expect(await shareStatus(share)).toEqual({ read: false, opens: 3 })
    answer({ notes: [], notesOn: true, expiresAt: 9, once: false, opened: false, opens: 0 })
    expect(await shareStatus(share)).toEqual({ read: false, opens: 0 })
    // An older server says nothing of either, and a number has to be one.
    answer({ notes: [], notesOn: true, expiresAt: 9 })
    expect(await shareStatus(share)).toEqual({ read: false })
    answer({ notes: [], notesOn: true, expiresAt: 9, opens: '3' })
    expect(await shareStatus(share)).toEqual({ read: false })
    answer({ error: 'Not found.' }, 404)
    await expect(shareStatus(share)).rejects.toThrow(ShareError)
  })

  it('with a password, seals the draft and opens the notes with the password’s key, and never sends the password', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ expiresAt: 42 }), { status: 201 }))
    vi.stubGlobal('fetch', fetch)
    const body: JSONContent = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Chapter one' }] }] }
    const share = await createShare({ kind: 'page', body }, 30, 'the-jws', { password: 'tide tables' })
    expect(share.password).toBe('tide tables')
    vi.stubGlobal('location', { origin: 'https://nib.test' })
    expect(shareUrl(share)).toBe(`https://nib.test/d/${share.slug}#${share.key}.p`)

    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    const sent = JSON.parse(init.body as string)
    expect(JSON.stringify(sent)).not.toContain('tide tables')
    await expect(open(share.key, share.slug, 'doc', sent.doc)).rejects.toThrow()
    const sealKey = await withPassword(share.key, share.slug, 'tide tables')
    expect(await open(sealKey, share.slug, 'doc', sent.doc)).toEqual(snapshot({ kind: 'page', body }))

    const note = await seal(sealKey, share.slug, 'note', { text: 'Lovely.' })
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ notes: [{ id: 1, at: 5, note }], notesOn: true, expiresAt: 9 })))
    expect((await readNotes(share)).notes).toEqual([{ id: 1, at: 5, text: 'Lovely.' }])
  })

  it('counts revoking a share that’s already gone as done, and reports other failures', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"error":"No such share."}', { status: 404 }))
    await expect(revokeShare(ref())).resolves.toBeUndefined()
    vi.stubGlobal('fetch', async () => new Response('{"error":"Down."}', { status: 500 }))
    await expect(revokeShare(ref())).rejects.toBeInstanceOf(ShareError)
  })
})

describe('a shared screenplay', () => {
  it('says it is one, for the reader to set it out; nothing else does', () => {
    const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'INT. HOUSE - DAY' }] }] }
    expect(snapshot({ kind: 'page', body, screenplay: true }).screenplay).toBe(true)
    expect('screenplay' in snapshot({ kind: 'page', body })).toBe(false)
    expect('screenplay' in snapshot({ kind: 'note', body, screenplay: true })).toBe(false)
  })
})
