// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSONContent } from '@tiptap/react'
import type { Vault } from './db/db'
import { base64url } from '../worker/base64'

// ProseMirror needs layout, which jsdom does not have, so the editor is stubbed
// at its props contract: a textarea that reports the same JSON shape App reads.
/** Blocks the stand-in editor writes after what's typed: an attachment, where a test is about one. */
const typed = vi.hoisted(() => ({ after: [] as JSONContent[] }))
vi.mock('./editor/Editor', () => {
  const read = (body?: JSONContent) => body?.content?.[0]?.content?.[0]?.text ?? ''
  const write = (text: string): JSONContent => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }, ...typed.after],
  })
  return {
    Editor: ({
      initialBody,
      onChange,
      onBlur,
    }: {
      initialBody?: JSONContent
      onChange: (body: JSONContent) => void
      onBlur?: () => void
    }) => (
      // The real editor's class: App asks it whether the caret is in the text.
      <textarea
        data-testid="editor"
        className="ProseMirror"
        defaultValue={read(initialBody)}
        onChange={(event) => onChange(write(event.target.value))}
        onBlur={() => onBlur?.()}
      />
    ),
  }
})

// Passed straight through, only to hand the tests App's "sync applied these" callback.
const synced = vi.hoisted(() => ({ applied: null as ((ids: string[], copies: number) => void) | null }))
vi.mock('./sync', async (importOriginal) => {
  const real = await importOriginal<typeof import('./sync')>()
  return {
    ...real,
    useSync: (...args: Parameters<typeof real.useSync>) => {
      synced.applied = args[1]
      return real.useSync(...args)
    },
  }
})

// Plus off, as in a browser, unless a test turns it on: what moved to Plus is tested with it (Phase 10).
const plusOn = vi.hoisted(() => ({ active: false }))
vi.mock('./lib/plus', async (importOriginal) => {
  const real = await importOriginal<typeof import('./lib/plus')>()
  return {
    ...real,
    usePlus: (): ReturnType<typeof real.usePlus> => {
      const [entitlement, set, known] = real.usePlus()
      return plusOn.active ? [{ ...entitlement, active: true }, set, true] : [entitlement, set, known]
    },
  }
})

const { App } = await import('./App')
const { db } = await import('./db/db')
const items = await import('./db/items')
const revisions = await import('./db/revisions')
const vault = await import('./lib/vault')
const { takeBackup } = await import('./lib/backup')
const { readFolderSettings, replaceFolderSettings } = await import('./lib/folderSettings')
const { COALESCE_MS } = revisions

const textOf = (body: JSONContent) => body.content?.[0]?.content?.[0]?.text ?? ''
const bodyOf = (text: string): JSONContent => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

// Mirrors lib/platform, so the palette shortcut matches whatever this run looks like.
const MOD = /Mac|iP(hone|ad|od)/.test(navigator.userAgent) ? 'Meta' : 'Control'

/** Bodies of every stored item, ordered for a stable assertion. */
async function stored() {
  return (await db.items.toArray()).map((item) => textOf(item.body)).sort()
}

/** Nib leaving the screen, as the system says so. */
function hide() {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
  act(() => void document.dispatchEvent(new Event('visibilitychange')))
}

beforeEach(async () => {
  plusOn.active = false
  await db.items.clear()
  await db.revisions.clear()
  replaceFolderSettings({})
})

describe('App draft identity', () => {
  // The save is debounced, so starting a second draft before it fires used to
  // let the first draft's create adopt the *new* blank editor, and the next
  // keystroke overwrote the first note in place.
  it('keeps a draft interrupted by New as its own record', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByTestId('editor'), 'ALPHA')
    await user.click(screen.getByRole('button', { name: /New note/ }))
    await waitFor(async () => expect(await db.items.count()).toBe(1))

    await user.type(screen.getByTestId('editor'), 'BETA')
    await waitFor(async () => expect(await stored()).toEqual(['ALPHA', 'BETA']), {
      timeout: 3000,
    })
  })

  it('keeps a note interrupted by the Pages tab out of the page draft', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByTestId('editor'), 'ALPHA')
    await user.click(screen.getByRole('tab', { name: 'Pages' }))
    await waitFor(async () => expect(await db.items.count()).toBe(1))

    await user.type(screen.getByTestId('editor'), 'BETA')
    await waitFor(async () => expect(await stored()).toEqual(['ALPHA', 'BETA']), {
      timeout: 3000,
    })

    const kinds = (await db.items.toArray()).map((item) => `${item.kind}:${textOf(item.body)}`)
    expect(kinds.sort()).toEqual(['note:ALPHA', 'page:BETA'])
  })

  // The revision that holds the clobbered text is the last copy of it, and the
  // coalesce window would otherwise overwrite that too.
  it('leaves the interrupted draft its own revision', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByTestId('editor'), 'ALPHA')
    await user.click(screen.getByRole('button', { name: /New note/ }))
    await waitFor(async () => expect(await db.items.count()).toBe(1))
    await user.type(screen.getByTestId('editor'), 'BETA')
    await waitFor(async () => expect(await db.items.count()).toBe(2), { timeout: 3000 })

    const bodies = (await db.revisions.toArray()).map((revision) => textOf(revision.body))
    expect(bodies.sort()).toEqual(['ALPHA', 'BETA'])
  })
})

describe('App version tracking', () => {
  // versionRef used to be read inside the queued write, so a document switch
  // that landed first handed the write the *incoming* document's version. Every
  // ordinary switch after an unflushed edit then looked like another tab had
  // raced, and burned two of the free revision slots on a conflict that
  // never happened — pruning real history out.
  it('does not mistake switching documents for another tab', async () => {
    await items.create('note', bodyOf('ALPHA'))
    const beta = await items.create('note', bodyOf('BETA'))

    const user = userEvent.setup()
    render(<App />)

    await user.click(await screen.findByText('ALPHA'))
    await waitFor(() =>
      expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('ALPHA'),
    )
    await user.type(screen.getByTestId('editor'), '-EDIT')

    await user.click(screen.getByText('BETA'))
    // Without this the keystroke below lands before the remount and the test
    // passes vacuously.
    await waitFor(() =>
      expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('BETA'),
    )
    await user.type(screen.getByTestId('editor'), '!')

    await waitFor(async () => expect((await revisions.list(beta)).map((entry) => textOf(entry.body))).toEqual(['BETA!']))
    expect(textOf((await items.get(beta))!.body)).toBe('BETA!')
  })
})

describe('App conflict notice', () => {
  /**
   * Stands in for a second tab: a bare update with no expectedVersion is
   * exactly the call another tab's seeded write makes. Wrapped in act() so the
   * live-query re-render stays inside React's batch.
   */
  async function otherTabWrites(id: string, text: string) {
    await act(async () => {
      await items.update(id, bodyOf(text))
    })
  }

  async function openAndEdit(user: ReturnType<typeof userEvent.setup>, title: string) {
    await user.click(await screen.findByText(title))
    await waitFor(() =>
      expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe(title),
    )
  }

  it('tells the writer when another tab got there first', async () => {
    const id = await items.create('note', bodyOf('MINE'))
    const user = userEvent.setup()
    render(<App />)
    await openAndEdit(user, 'MINE')

    await otherTabWrites(id, 'THEIRS')
    await user.type(screen.getByTestId('editor'), '!')

    expect(await screen.findByText(/Also edited elsewhere/)).toBeTruthy()
    // The writer's own text is what survived.
    await waitFor(async () => expect(textOf((await items.get(id))!.body)).toBe('MINE!'))
  })

  it('says nothing when no one else has written', async () => {
    await items.create('note', bodyOf('MINE'))
    const user = userEvent.setup()
    render(<App />)
    await openAndEdit(user, 'MINE')

    await user.type(screen.getByTestId('editor'), '!')
    await waitFor(async () => expect(await db.revisions.count()).toBeGreaterThan(0))
    expect(screen.queryByText(/Also edited elsewhere/)).toBeNull()
  })

  it('"Keep mine" dismisses it and changes nothing', async () => {
    const id = await items.create('note', bodyOf('MINE'))
    const user = userEvent.setup()
    render(<App />)
    await openAndEdit(user, 'MINE')

    await otherTabWrites(id, 'THEIRS')
    await user.type(screen.getByTestId('editor'), '!')
    await screen.findByText(/Also edited elsewhere/)

    await user.click(screen.getByText('Keep mine'))
    expect(screen.queryByText(/Also edited elsewhere/)).toBeNull()
    expect(textOf((await items.get(id))!.body)).toBe('MINE!')
  })

  it('"See the other version" opens history on the text that was overwritten', async () => {
    const id = await items.create('note', bodyOf('MINE'))
    const user = userEvent.setup()
    render(<App />)
    await openAndEdit(user, 'MINE')

    await otherTabWrites(id, 'THEIRS')
    await user.type(screen.getByTestId('editor'), '!')
    await screen.findByText(/Also edited elsewhere/)

    await user.click(screen.getByText('See the other version'))
    expect(await screen.findByText('History')).toBeTruthy()

    // "Current" offers nothing to compare, so the other tab's text has to be
    // the first version below it — which is what the explicit revision stamps
    // guarantee.
    await user.click(within(screen.getByRole('list', { name: 'Versions' })).getAllByRole('button')[0])
    // Without Plus, as it was, to restore whole (compared with now is Plus's, Phase 10).
    expect((await screen.findByText('THEIRS')).tagName).toBe('P')
    expect(screen.getByText('Restore this whole version')).toBeTruthy()
  })
})

// Moved to Plus 2026-11-20, for everyone (Phase 10): in a browser, where Plus isn't sold, the row is there only with it.
describe('App notes to self and TKs', () => {
  it('lists them from Commands with Plus, and not without', async () => {
    await items.create('note', bodyOf('A NOTE'))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('A NOTE'))
    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await screen.findByText('Version history')
    expect(screen.queryByText('Notes to self and TKs')).toBeNull()
    await user.keyboard('{Escape}')
    cleanup()

    plusOn.active = true
    render(<App />)
    await user.click(await screen.findByText('A NOTE'))
    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    expect(await screen.findByText('Notes to self and TKs')).toBeTruthy()
  })
})

describe('App re-selecting the open document', () => {
  // Long enough for the select, and any remount, to have landed.
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)))

  // Opening it again from the library is the normal way back. Moving the version
  // without remounting left the old text on screen with a version check that
  // now passed, so the next keystroke overwrote the other tab's edit unseen.
  it('shows another tab’s edit rather than writing over it', async () => {
    const id = await items.create('note', bodyOf('MINE'))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('MINE'))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('MINE'))

    await act(async () => {
      await items.update(id, bodyOf('THEIRS'))
    })
    // Back to the library, put away (and not drawn) while the text had the window.
    await user.click(screen.getByRole('button', { name: 'Notes' }))
    await user.click(await screen.findByText('THEIRS'))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('THEIRS'))

    await user.type(screen.getByTestId('editor'), '!')
    await waitFor(async () => expect(textOf((await items.get(id))!.body)).toBe('THEIRS!'))
  })

  // Every save moves the version, so keying by it alone remounted the editor
  // here: the caret jumped to the end and undo history was lost.
  it('keeps the same editor when nothing changed elsewhere', async () => {
    const id = await items.create('note', bodyOf('MINE'))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('MINE'))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('MINE'))
    const editor = screen.getByTestId('editor')
    await user.type(editor, '!')
    await waitFor(async () => expect(textOf((await items.get(id))!.body)).toBe('MINE!'))

    await user.click(screen.getByRole('button', { name: 'Notes' }))
    await user.click(await screen.findByText('MINE!'))
    await settle()
    expect(screen.getByTestId('editor')).toBe(editor)
  })

  // A tap, as on an iPad, leaves the editor focused, so nothing is saved on
  // blur: the row was read before the pending write landed.
  it('opens a draft with the words typed just before its row was tapped', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByTestId('editor'), 'Hello')
    await waitFor(async () => expect(await db.items.count()).toBe(1))
    const [{ id }] = await db.items.toArray()

    await user.type(screen.getByTestId('editor'), ' world')
    fireEvent.click(await screen.findByText('Hello'))
    await settle()
    expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('Hello world')

    await user.type(screen.getByTestId('editor'), '!')
    await waitFor(async () => expect(textOf((await items.get(id))!.body)).toBe('Hello world!'))
  })
})

describe('App note locked on another device', () => {
  afterEach(() => {
    vault.closeVault()
    typed.after = []
  })

  const editor = () => screen.getByTestId<HTMLTextAreaElement>('editor')
  const copiesHere = async () => (await db.items.toArray()).filter((item) => item.id !== 'mine' && vault.isLocked(item))
  const opened = async (id: string) => textOf((await vault.unseal(id, (await items.get(id))!.vault!))!)

  async function openMine(user: ReturnType<typeof userEvent.setup>, title = 'MINE') {
    render(<App />)
    await user.click(await screen.findByText(title))
    await waitFor(() => expect(editor().value).toBe('MINE'))
  }

  /** Sync bringing in what another device did to the note: a new seal, and a version that moved. */
  async function arrives(sealed: Vault) {
    await act(async () => {
      await db.items.update('mine', { vault: sealed, body: vault.LOCKED_BODY, version: (await items.get('mine'))!.version + 1 })
    })
  }

  // The lock wins, as in sync: what was typed here, into the note as it was
  // before the lock, is the edit it beats. It used to fail every save as
  // "Can't save to this device", and was gone once the writer left the note.
  it('keeps what was typed into a note locked elsewhere as a separate locked note', { timeout: 20_000 }, async () => {
    await items.create('note', bodyOf('MINE'), { id: 'mine' })
    const user = userEvent.setup()
    await openMine(user)
    await vault.openVault('harbour lights', [])
    const theirs = await vault.seal('mine', bodyOf('MINE'))
    vault.closeVault()
    await arrives(theirs)

    await user.type(editor(), '!')
    expect(await screen.findByText('This note was locked on another device. What you typed is kept as a separate locked note.')).toBeTruthy()
    expect(screen.queryByText(/Can’t save to this device/)).toBeNull()
    expect(await screen.findByText('This is locked in the vault.')).toBeTruthy()
    const [copy] = await copiesHere()
    expect(JSON.stringify(copy)).not.toContain('MINE')
    expect(await vault.unbox(copy.id, (copy.unsealed as { box: string }).box)).toEqual(bodyOf('MINE!'))
    expect((await items.get('mine'))!.vault).toEqual(theirs)

    await user.click(screen.getByRole('button', { name: 'Open the vault' }))
    await user.type(await screen.findByLabelText('Passcode'), 'harbour lights')
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(editor().value).toBe('MINE'), { timeout: 15_000 })
    expect(await opened(copy.id)).toBe('MINE!')
  })

  it('says where what was attached went: a note of its own, since the locked one can’t hold it', { timeout: 20_000 }, async () => {
    await items.create('note', bodyOf('MINE'), { id: 'mine' })
    const user = userEvent.setup()
    await openMine(user)
    await vault.openVault('harbour lights', [])
    const theirs = await vault.seal('mine', bodyOf('MINE'))
    vault.closeVault()
    await arrives(theirs)

    const attachment = { type: 'attachment', attrs: { file: { id: '7b0f6f0e-3c1d-4c0a-9d43-0a4f5a3b2c1d', type: 'application/pdf', size: 2000 }, name: 'report.pdf' } }
    typed.after = [attachment]
    await user.type(editor(), '!')
    expect(await screen.findByText('This note was locked on another device. What you typed is kept as a separate locked note, and its attachments in a note of their own.')).toBeTruthy()
    const others = (await db.items.toArray()).filter((item) => item.id !== 'mine')
    expect(others).toHaveLength(2)
    const files = others.find((item) => !item.unsealed)!
    expect(files.body.content!.at(-2)).toEqual(attachment)
    expect(vault.isLocked(files)).toBe(false)
  })

  it('does the same with the vault open here, rather than sealing over the other edit', async () => {
    await items.create('note', bodyOf('MINE'), { id: 'mine' })
    await vault.openVault('harbour lights', [])
    const user = userEvent.setup()
    await openMine(user)
    await arrives(await vault.seal('mine', bodyOf('THEIRS')))

    await user.type(editor(), '!')
    expect(await screen.findByText(/What you typed is kept as a separate locked note/)).toBeTruthy()
    await waitFor(() => expect(editor().value).toBe('THEIRS'))
    expect(await opened('mine')).toBe('THEIRS')
    const [copy] = await copiesHere()
    await waitFor(async () => expect(await opened(copy.id)).toBe('MINE!'))
  })

  // Open and locked here, with the caret in it, sync leaves the editor alone
  // and the next save writes over the other device's edit. A locked note has
  // no history to keep it in, so it went, and the notice pointed at History.
  it('keeps the other device’s edit as a copy when typing here writes over it', async () => {
    await items.create('note', bodyOf('MINE'), { id: 'mine' })
    await vault.openVault('harbour lights', [])
    await items.lock('mine', bodyOf('MINE'))
    const user = userEvent.setup()
    await openMine(user)
    await arrives(await vault.seal('mine', bodyOf('THEIRS')))

    await user.type(editor(), '!')
    expect(await screen.findByText(/The other edit is kept as a separate locked note/)).toBeTruthy()
    expect(screen.queryByText(/Also edited elsewhere/)).toBeNull()
    await waitFor(async () => expect(await opened('mine')).toBe('MINE!'))
    const [copy] = await copiesHere()
    await waitFor(async () => expect(await opened(copy.id)).toBe('THEIRS'))
  })

  describe('after its passcode changed elsewhere', () => {
    /** Locked here under one passcode, and the seals another device's new passcode would make. */
    async function lockedTwice(...texts: string[]) {
      await items.create('note', bodyOf('MINE'), { id: 'mine' })
      await vault.openVault('harbour lights', [])
      await items.lock('mine', bodyOf('MINE'))
      await vault.openVault('new harbour', [])
      const resealed = await Promise.all(texts.map((text) => vault.seal('mine', bodyOf(text))))
      vault.closeVault()
      await vault.openVault('harbour lights', [{ id: 'mine', vault: (await items.get('mine'))!.vault! }])
      return resealed
    }

    async function giveNewPasscode(user: ReturnType<typeof userEvent.setup>) {
      await user.click(await screen.findByRole('button', { name: 'Open the vault' }))
      await user.type(within(await screen.findByRole('dialog', { name: 'Open the vault' })).getByLabelText('Passcode'), 'new harbour')
      await user.click(screen.getByRole('button', { name: 'Open' }))
    }

    it('saves what was typed in place once the new passcode is given', { timeout: 20_000 }, async () => {
      const [resealed] = await lockedTwice('MINE')
      const user = userEvent.setup()
      await openMine(user)
      await arrives(resealed)

      await user.type(editor(), '!')
      expect(await screen.findByText(/passcode was changed on another device/)).toBeTruthy()
      await giveNewPasscode(user)
      await waitFor(async () => expect(await opened('mine')).toBe('MINE!'), { timeout: 15_000 })
      expect(await copiesHere()).toEqual([])
    })

    // It came up over whatever was up, in the middle of typing, and took the keys.
    it('asks by a notice, with the writing left to the writer', { timeout: 20_000 }, async () => {
      const [resealed] = await lockedTwice('MINE')
      const user = userEvent.setup()
      await openMine(user)
      await arrives(resealed)
      await user.type(editor(), '!')
      await screen.findByText(/passcode was changed on another device/)
      expect(screen.queryByRole('dialog', { name: 'Open the vault' })).toBeNull()
      expect(document.activeElement).toBe(editor())
    })

    // It was held only in memory until the passcode was given.
    it('keeps what was typed should Nib close before the passcode is given', async () => {
      const [resealed] = await lockedTwice('MINE')
      const user = userEvent.setup()
      await openMine(user)
      await arrives(resealed)
      await user.type(editor(), '!')
      await screen.findByText(/passcode was changed on another device/)
      await user.type(editor(), '?')
      await waitFor(async () => {
        const copies = await copiesHere()
        expect(copies).toHaveLength(1)
        expect(await vault.unbox(copies[0].id, (copies[0].unsealed as { box: string }).box)).toEqual(bodyOf('MINE!?'))
      })
      cleanup()

      vault.closeVault()
      await vault.openVault('new harbour', [{ id: 'mine', vault: (await items.get('mine'))!.vault! }])
      await items.sealCopies()
      expect(await opened((await copiesHere())[0].id)).toBe('MINE!?')
    })

    it('keeps it as a copy instead if the note changed again before the passcode was given', { timeout: 20_000 }, async () => {
      const [resealed, edited] = await lockedTwice('MINE', 'THEIRS')
      const user = userEvent.setup()
      await openMine(user)
      await arrives(resealed)
      await user.type(editor(), '!')
      await screen.findByText(/passcode was changed on another device/)
      await arrives(edited)

      await giveNewPasscode(user)
      // Sealed into the vault once the new passcode opens it.
      await waitFor(async () => expect((await copiesHere()).map((copy) => Boolean(copy.vault))).toEqual([true]), { timeout: 15_000 })
      expect(await opened('mine')).toBe('THEIRS')
      expect(await opened((await copiesHere())[0].id)).toBe('MINE!')
    })
  })
})

// One record whose text wasn't a string threw where the list reads titles,
// and React drew nothing at all, at every launch, since the record stayed.
describe('App opening a vault with a short passcode', () => {
  afterEach(() => vault.closeVault())

  /** A seal an earlier Nib made, before a passcode needed eight characters. */
  async function sealedEarlier(id: string, passcode: string, body: JSONContent): Promise<Vault> {
    const encoder = new TextEncoder()
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const secret = await crypto.subtle.importKey('raw', encoder.encode(passcode), 'PBKDF2', false, ['deriveKey'])
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600_000 }, secret, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`nib-vault/${id}`) }, key, encoder.encode(JSON.stringify(body)))
    return { salt: base64url(salt), sealed: base64url(new Uint8Array([...iv, ...new Uint8Array(cipher)])) }
  }

  // It still opens, but nothing asked for a longer one, though four digits
  // are guessed against a copy of the library in under a second.
  it('asks for a longer one', { timeout: 20_000 }, async () => {
    await items.create('note', bodyOf('MINE'), { id: 'mine' })
    await db.items.update('mine', { vault: await sealedEarlier('mine', '1234', bodyOf('MINE')), body: vault.LOCKED_BODY })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('Locked'))
    await user.click(await screen.findByRole('button', { name: 'Open the vault' }))
    await user.type(await screen.findByLabelText('Passcode'), '1234')
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('MINE'), { timeout: 15_000 })
    expect(screen.getByText(/passcode could be guessed from a copy of your library/)).toBeTruthy()
  })

  // Eight digits passed, though digits alone are guessed in hours.
  it('asks for a stronger one than digits alone', { timeout: 20_000 }, async () => {
    await items.create('note', bodyOf('MINE'), { id: 'mine' })
    await db.items.update('mine', { vault: await sealedEarlier('mine', '12345678', bodyOf('MINE')), body: vault.LOCKED_BODY })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('Locked'))
    await user.click(await screen.findByRole('button', { name: 'Open the vault' }))
    await user.type(await screen.findByLabelText('Passcode'), '12345678')
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('MINE'), { timeout: 15_000 })
    expect(screen.getByText(/passcode could be guessed from a copy of your library/)).toBeTruthy()
  })
})

describe('App with a damaged record', () => {
  it('still draws, and lists the rest', async () => {
    await items.create('note', bodyOf('Fine'))
    const odd = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: { toString: 0, valueOf: 0 } }] }] }
    await db.items.add({ id: 'odd', kind: 'note', body: odd as never, version: 1, rev: 1, createdAt: 1, updatedAt: 1 })
    render(<App />)
    expect(await screen.findByText('Fine')).toBeTruthy()
  })
})

// The vault shut only when Nib left the screen. A Mac window left showing
// behind another app's is covered by Lock Nib after its delay without ever
// being hidden, so an open locked note stayed open behind the cover, for the
// menu bar to export.
describe('App behind Lock Nib', () => {
  afterEach(() => vault.closeVault())

  it('shuts the vault when the lock covers it, keeping what was typed', async () => {
    await items.create('note', bodyOf('MINE'), { id: 'mine' })
    await vault.openVault('harbour lights', [])
    await items.lock('mine', bodyOf('MINE'))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('MINE'))
    const editor = () => screen.getByTestId<HTMLTextAreaElement>('editor')
    await waitFor(() => expect(editor().value).toBe('MINE'))

    await user.type(editor(), '!')
    act(() => void window.dispatchEvent(new Event('niblock')))
    expect(await screen.findByText('This is locked in the vault.')).toBeTruthy()
    expect(vault.vaultOpen()).toBe(false)

    const mine = (await items.get('mine'))!
    await vault.openVault('harbour lights', [{ id: 'mine', vault: mine.vault! }])
    expect(textOf((await vault.unseal('mine', mine.vault!))!)).toBe('MINE!')
  })
})

describe('App leaving the screen', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vault.closeVault()
  })

  // On iOS this is the last save there is: a hidden app's timers stop, so the
  // debounce would never fire. Stopped here too, or it could save the words
  // itself and the test would pass with nothing listening.
  function typeThenLeave(leave: () => void) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.change(screen.getByTestId('editor'), { target: { value: 'LAST WORDS' } })
    leave()
    vi.useRealTimers()
  }

  it('saves an edit still waiting when Nib is hidden', async () => {
    render(<App />)
    typeThenLeave(hide)
    await waitFor(async () => expect(await stored()).toEqual(['LAST WORDS']))
  })

  it('saves an edit still waiting when the page goes', async () => {
    render(<App />)
    typeThenLeave(() => act(() => void window.dispatchEvent(new Event('pagehide'))))
    await waitFor(async () => expect(await stored()).toEqual(['LAST WORDS']))
  })

  async function openLocked() {
    await items.create('note', bodyOf('MINE'), { id: 'mine' })
    await vault.openVault('harbour lights', [])
    await items.lock('mine', bodyOf('MINE'))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('MINE'))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('MINE'))
    return user
  }

  it('shuts the vault when Nib is hidden, keeping what was typed', async () => {
    const user = await openLocked()
    await user.type(screen.getByTestId('editor'), '!')
    hide()
    expect(await screen.findByText('This is locked in the vault.')).toBeTruthy()
    expect(vault.vaultOpen()).toBe(false)

    const mine = (await items.get('mine'))!
    await vault.openVault('harbour lights', [{ id: 'mine', vault: mine.vault! }])
    expect(textOf((await vault.unseal('mine', mine.vault!))!)).toBe('MINE!')
  })

  // Shown through sync, the text came up with the sealed screen still over it, until the note was chosen again.
  it('shows a note unlocked on another device, in place of its locked screen', async () => {
    await openLocked()
    hide()
    expect(await screen.findByText('This is locked in the vault.')).toBeTruthy()
    await act(async () => {
      await db.items.update('mine', { vault: null, body: bodyOf('OPENED THERE'), version: (await items.get('mine'))!.version + 1 })
    })
    act(() => synced.applied!(['mine'], 0))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('OPENED THERE'))
    expect(screen.queryByText('This is locked in the vault.')).toBeNull()
  })

  it('leaves the vault open when Nib comes back to the front', async () => {
    await openLocked()
    act(() => void document.dispatchEvent(new Event('visibilitychange')))
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)))
    expect(vault.vaultOpen()).toBe(true)
    expect(screen.queryByText('This is locked in the vault.')).toBeNull()
  })
})

describe('App when sync changes the open note', () => {
  const editor = () => screen.getByTestId<HTMLTextAreaElement>('editor')
  // Long enough for the reload, if one was coming, to have landed.
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 100)))

  async function openMine() {
    const id = await items.create('note', bodyOf('MINE'))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('MINE'))
    await waitFor(() => expect(editor().value).toBe('MINE'))
    return { id, user }
  }

  /** Sync bringing in what another device wrote, and telling App which documents it touched. */
  async function arrives(id: string, text: string) {
    await act(async () => {
      await items.update(id, bodyOf(text))
    })
    act(() => synced.applied!([id], 0))
  }

  it('shows the new text, and the next save goes on from it', async () => {
    const { id, user } = await openMine()
    await arrives(id, 'THEIRS')
    await waitFor(() => expect(editor().value).toBe('THEIRS'))

    await user.type(editor(), '!')
    await waitFor(async () => expect(textOf((await items.get(id))!.body)).toBe('THEIRS!'))
    await settle()
    expect(screen.queryByText(/Also edited elsewhere/)).toBeNull()
  })

  // Not focused, or the caret's own rule below would hide this one.
  it('leaves it alone while an edit is waiting, and the save keeps both', async () => {
    const { id } = await openMine()
    const before = editor()
    fireEvent.change(before, { target: { value: 'MINE!' } })
    await arrives(id, 'THEIRS')
    await settle()
    expect(editor()).toBe(before)
    expect(editor().value).toBe('MINE!')

    expect(await screen.findByText(/Also edited elsewhere/)).toBeTruthy()
    expect(textOf((await items.get(id))!.body)).toBe('MINE!')
    expect((await revisions.list(id)).map((entry) => textOf(entry.body))).toContain('THEIRS')
  })

  it('leaves it alone with the caret in the text, and shows it once the caret has gone', async () => {
    const { id } = await openMine()
    const before = editor()
    act(() => before.focus())
    await arrives(id, 'THEIRS')
    await settle()
    expect(editor()).toBe(before)
    expect(editor().value).toBe('MINE')

    act(() => before.blur())
    act(() => synced.applied!([id], 0))
    await waitFor(() => expect(editor().value).toBe('THEIRS'))
  })
})

describe('App copies from sync', () => {
  afterEach(() => vault.closeVault())

  it('says once that sync kept an edit as a copy', async () => {
    render(<App />)
    act(() => synced.applied!([], 1))
    expect(await screen.findByText(/The other edit is kept as a separate locked note/)).toBeTruthy()
  })

  // Made while the vault was shut here: locked like any other, and sealed when it opens.
  it('shows a copy as locked, and seals and opens it with the vault', { timeout: 20_000 }, async () => {
    await db.items.add({ id: 'copy', kind: 'note', body: vault.LOCKED_BODY, version: 1, rev: 1, createdAt: 1, updatedAt: 1, unsealed: { body: bodyOf('THE OTHER EDIT') } })
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('Locked'))
    await user.click(await screen.findByRole('button', { name: 'Open the vault' }))
    await user.type(await screen.findByLabelText('Passcode'), 'harbour lights')
    await user.click(screen.getByRole('button', { name: 'Open' }))

    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('THE OTHER EDIT'), { timeout: 15_000 })
    const sealed = (await items.get('copy'))!
    expect(sealed.unsealed).toBeUndefined()
    expect(textOf((await vault.unseal('copy', sealed.vault!))!)).toBe('THE OTHER EDIT')
  })
})

describe('App search', () => {
  const withFootnote = (prose: string, note: string): JSONContent => ({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: prose },
          { type: 'footnote', attrs: { text: note } },
        ],
      },
    ],
  })

  it('finds a note by the wording of its footnote', async () => {
    await items.create('note', withFootnote('The wardrobe', 'Pevensie 1950'))
    await items.create('note', bodyOf('unrelated'))

    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByPlaceholderText(/Search/), 'pevensie')

    expect(await screen.findByText('The wardrobe')).toBeTruthy()
    expect(screen.queryByText('unrelated')).toBeNull()
  })

  it('lists it by its prose, not by the footnote', async () => {
    await items.create('note', withFootnote('The wardrobe', 'Pevensie 1950'))

    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByPlaceholderText(/Search/), 'pevensie')

    // The title is the prose alone — the footnote must not bleed into it.
    expect(await screen.findByText('The wardrobe')).toBeTruthy()
  })
})

describe('App export', () => {
  /** Captures whatever `download` puts in a Blob. */
  function captureDownloads() {
    const blobs: Blob[] = []
    URL.createObjectURL = vi.fn((blob: Blob) => {
      blobs.push(blob)
      return 'blob:nib-test'
    }) as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn()
    return blobs
  }

  // NOTE: this holds the property, but it does not discriminate the bug it was
  // written for. Opening the palette blurs the editor, and `act()` then flushes
  // both the write and the live-query re-render before the click lands — so the
  // stale-array window the fix closes cannot be reproduced under jsdom. It
  // passes against the unfixed code too. Kept as a guard on the end-to-end
  // property; the fix itself rests on reading the code.
  it('includes an edit that has not been written yet', async () => {
    const blobs = captureDownloads()
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByTestId('editor'), 'UNSAVED EDIT')
    // Straight to the export, without waiting out the debounce.
    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await user.click(await screen.findByText('Export everything as Markdown'))

    await waitFor(() => expect(blobs).toHaveLength(1))
    expect(await blobs[0].text()).toContain('UNSAVED EDIT')
  })
})

describe('App save failure', () => {
  // The warning lives in the library's footer, which focus mode hides — so a
  // storage failure could go unannounced for a whole writing session.
  it('reports a failed save even with the library hidden', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.type(screen.getByTestId('editor'), 'HELLO')
    await waitFor(async () => expect(await db.items.count()).toBe(1))

    // Stand in for another tab purging the record this editor still holds.
    const [saved] = await db.items.toArray()
    await db.items.delete(saved.id)

    await user.type(screen.getByTestId('editor'), '!')
    // With the library open this is its footer's copy, the only one rendered.
    expect(await screen.findByText(/Can’t save to this device/)).toBeTruthy()

    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await user.click(await screen.findByText('Focus mode'))
    // In focus mode the warning has to reach <main>. Scoped, because the
    // library stays mounted so it can fade rather than vanish, and its copy
    // is still in the DOM behind `inert`.
    const main = within(screen.getByRole('main'))
    await waitFor(() => expect(main.getByText(/Can’t save to this device/)).toBeTruthy())
  })
})

describe('App duplicating', () => {
  // The copy opened under the library, so with the list still up nothing seemed to happen.
  it('puts the library away for the copy', async () => {
    await items.create('note', bodyOf('ORIGINAL'))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('ORIGINAL'))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('ORIGINAL'))
    const library = () => document.querySelector<HTMLElement>('.nib-library')!.dataset.open
    await user.click(within(screen.getByRole('main')).getByRole('button', { name: 'Notes' }))
    await waitFor(() => expect(library()).toBe('true'))

    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await user.click(await screen.findByRole('button', { name: /^Duplicate this/ }))

    await waitFor(() => expect(library()).toBe('false'))
    await waitFor(async () => expect(await items.list('note')).toHaveLength(2))
  })
})

describe('App templates', () => {
  const chip = (name: RegExp) => within(screen.getByRole('group', { name: 'Show' })).queryByRole('button', { name })
  const cards = () => [...document.querySelectorAll('.nib-library [data-id]')].map((card) => card.textContent ?? '')

  it('saves a copy of the document open as a template, kept in Templates and out of the list', async () => {
    await items.create('note', bodyOf('LETTER'))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('LETTER'))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('LETTER'))
    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await user.click(await screen.findByRole('button', { name: /^Save as template/ }))
    expect(await screen.findByText('Saved as a template. It’s in Templates, in the library.')).toBeTruthy()
    await waitFor(async () => expect(items.sortOut(await items.listAll()).templates.map((item) => textOf(item.body))).toEqual(['LETTER']))

    await user.click(within(screen.getByRole('main')).getByRole('button', { name: 'Notes' }))
    await waitFor(() => expect(chip(/^Templates 1$/)).toBeTruthy())
    // The list has the original alone; Templates, the template.
    expect(cards().filter((text) => text.includes('LETTER'))).toHaveLength(1)
    await user.click(chip(/^Templates/)!)
    await waitFor(() => expect(cards().filter((text) => text.includes('LETTER'))).toHaveLength(1))
    const template = items.sortOut(await items.listAll()).templates[0]
    expect(document.querySelector(`.nib-library [data-id="${template.id}"]`)).toBeTruthy()
  })

  it('starts a note from one in Commands, filed in the folder shown, and leaves the template as it was', async () => {
    const template = await items.create('note', bodyOf('DEAR'), { template: true })
    await items.create('note', bodyOf('DRAFT'), { folder: 'Letters' })
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(chip(/^Letters/)).toBeTruthy())
    await user.click(chip(/^Letters/)!)
    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await user.click(await screen.findByRole('button', { name: /^New from template/ }))
    await user.click(await screen.findByRole('button', { name: /DEAR/ }))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('DEAR'))
    const made = (await items.list('note')).find((item) => textOf(item.body) === 'DEAR')!
    expect(made).toMatchObject({ folder: 'Letters' })
    expect(made.template).toBeUndefined()
    expect((await items.get(template))!.template).toBe(true)
  })

  it('starts a page from a template’s Use, in Templates, and opens it on Pages', async () => {
    await items.create('page', bodyOf('CHAPTER'), { template: true })
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(chip(/^Templates/)).toBeTruthy())
    await user.click(chip(/^Templates/)!)
    await user.click(within(document.querySelector<HTMLElement>('.nib-library')!).getByRole('tab', { name: 'Pages' }))
    await user.click(await screen.findByRole('button', { name: 'Use CHAPTER' }))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('CHAPTER'))
    await waitFor(async () => expect((await items.list('page')).map((item) => textOf(item.body))).toEqual(['CHAPTER']))
    expect(items.sortOut(await items.listAll()).templates).toHaveLength(1)
  })

  it('makes a template of a new note written while Templates is shown, and asks for Plus first at three', async () => {
    await items.create('note', bodyOf('ONE'), { template: true })
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(chip(/^Templates/)).toBeTruthy())
    await user.click(chip(/^Templates/)!)
    await user.click(within(document.querySelector<HTMLElement>('.nib-library')!).getByRole('button', { name: /^New note/ }))
    await user.type(screen.getByTestId('editor'), 'TWO')
    await waitFor(async () => expect(items.sortOut(await items.listAll()).templates.map((item) => textOf(item.body)).sort()).toEqual(['ONE', 'TWO']))

    await items.create('note', bodyOf('THREE'), { template: true })
    await user.click(within(screen.getByRole('main')).getByRole('button', { name: 'Notes' }))
    await waitFor(() => expect(chip(/^Templates 3$/)).toBeTruthy())
    await user.click(within(document.querySelector<HTMLElement>('.nib-library')!).getByRole('button', { name: /^New note/ }))
    expect(await screen.findByText('Nib Plus is sold in the Nib app for iPhone, iPad and Mac.')).toBeTruthy()
  })

  it('asks for Plus to start a screenplay from a template, as New screenplay does, and starts it with Plus', async () => {
    await items.create('page', bodyOf('INT. HOUSE - DAY'), { template: true, screenplay: true })
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(chip(/^Templates/)).toBeTruthy())
    await user.click(chip(/^Templates/)!)
    await user.click(within(document.querySelector<HTMLElement>('.nib-library')!).getByRole('tab', { name: 'Pages' }))
    await user.click(await screen.findByRole('button', { name: /^Use / }))
    expect(await screen.findByText('Nib Plus is sold in the Nib app for iPhone, iPad and Mac.')).toBeTruthy()
    expect(await items.list('page')).toEqual([])
    cleanup()
    plusOn.active = true
    render(<App />)
    await waitFor(() => expect(chip(/^Templates/)).toBeTruthy())
    await user.click(chip(/^Templates/)!)
    await user.click(within(document.querySelector<HTMLElement>('.nib-library')!).getByRole('tab', { name: 'Pages' }))
    await user.click(await screen.findByRole('button', { name: /^Use / }))
    await waitFor(async () => expect((await items.list('page')).map((item) => item.screenplay)).toEqual([true]))
    plusOn.active = false
  })

  it('starts a new note in a folder from the folder’s template, given in Edit, and a page there blank', async () => {
    const template = await items.create('note', bodyOf('SCENE'), { template: true })
    await items.create('note', bodyOf('OLD SCENE'), { folder: 'Novel' })
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(chip(/^Novel/)).toBeTruthy())
    await user.click(within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: 'Edit folders and categories' }))
    await user.click(await screen.findByRole('button', { name: 'Template for Novel' }))
    await user.click(within(screen.getByRole('radiogroup', { name: 'Template for Novel' })).getByRole('radio', { name: /^SCENE/ }))
    await waitFor(() => expect(readFolderSettings().novel?.template).toBe(template))
    await user.click(screen.getByRole('button', { name: '← Back' }))

    await user.click(chip(/^Novel/)!)
    await user.click(within(document.querySelector<HTMLElement>('.nib-library')!).getByRole('button', { name: /^New note/ }))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('SCENE'))
    await waitFor(async () => expect((await items.list('note')).filter((item) => textOf(item.body) === 'SCENE').map((item) => [item.folder, item.template])).toEqual([['Novel', undefined]]))
    expect((await items.get(template))!.template).toBe(true)

    // A page, of the other kind, starts blank.
    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await user.click(await screen.findByRole('button', { name: /^New page/ }))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe(''))
  })

  it('asks for Plus for a fourth, and saves none', async () => {
    for (const name of ['ONE', 'TWO', 'THREE']) await items.create('note', bodyOf(name), { template: true })
    await items.create('note', bodyOf('FOURTH'))
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('FOURTH'))
    await waitFor(() => expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('FOURTH'))
    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await user.click(await screen.findByRole('button', { name: /^Save as template/ }))
    // In a browser, where Plus isn't sold, its Billing page says where it is.
    expect(await screen.findByText('Nib Plus is sold in the Nib app for iPhone, iPad and Mac.')).toBeTruthy()
    expect(items.sortOut(await items.listAll()).templates).toHaveLength(3)
  })
})

describe('App backup restore failure', () => {
  const openRestore = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(within(document.querySelector<HTMLElement>('.nib-library')!).getByLabelText('Settings'))
    await user.click(screen.getByRole('button', { name: /Advanced/ }))
    return screen.getByLabelText('Restore from a backup…') as HTMLInputElement
  }

  // Picking the wrong file is the ordinary way this fails, and the storage
  // warning is both wrong and sticky — it stays up until the next good save,
  // sending the writer to hunt a disk fault that is not there.
  it('says the file was wrong, not that the device cannot save', async () => {
    const user = userEvent.setup()
    render(<App />)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const input = await openRestore(user)
    const wrong = new File(['{"hello":"world"}'], 'notes.json', { type: 'application/json' })
    await user.upload(input, wrong)

    expect(await screen.findByText('This is not a Nib backup.')).toBeTruthy()
    expect(screen.queryByText(/Can’t save to this device/)).toBeNull()
  })

  it('leaves the existing documents alone when the file is rejected', async () => {
    const user = userEvent.setup()
    const keep = await items.create('note', bodyOf('KEEP ME'))
    render(<App />)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const input = await openRestore(user)
    await user.upload(input, new File(['not json at all'], 'junk.json', { type: 'application/json' }))

    expect(await screen.findByText('This is not a Nib backup.')).toBeTruthy()
    expect(await db.items.get(keep)).toBeTruthy()
    expect(await stored()).toEqual(['KEEP ME'])
  })
})

describe('App restoring a good backup', () => {
  afterEach(() => {
    localStorage.removeItem('nib-theme')
    document.documentElement.classList.remove('dark')
    vi.restoreAllMocks()
  })

  // With a document open and its last words still in the debounce: they aren't
  // the backup's, and written afterwards they'd land in what was just restored.
  it('replaces everything, and leaves the open document for a new draft', async () => {
    await items.create('note', bodyOf('FROM THE BACKUP'), { id: 'kept' })
    const { content } = await takeBackup({ theme: 'dark', sort: 'title' })
    await items.update('kept', bodyOf('WRITTEN SINCE'))
    await items.create('note', bodyOf('NEWER STILL'))

    const user = userEvent.setup()
    render(<App />)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await user.click(await screen.findByText('WRITTEN SINCE'))
    const editor = () => screen.getByTestId<HTMLTextAreaElement>('editor')
    await waitFor(() => expect(editor().value).toBe('WRITTEN SINCE'))

    await user.click(within(screen.getByRole('main')).getByLabelText('Settings'))
    await user.click(screen.getByRole('button', { name: /Advanced/ }))
    // Typed without a blur, so it's still waiting as the restore begins.
    fireEvent.change(editor(), { target: { value: 'NOT IN THE BACKUP' } })
    await user.upload(screen.getByLabelText('Restore from a backup…'), new File([content], 'nib-backup.json', { type: 'application/json' }))

    await waitFor(() => expect(editor().value).toBe(''))
    expect(await stored()).toEqual(['FROM THE BACKUP'])
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    // Said, and Settings out of the way of the saying.
    expect(await screen.findByText('Your backup is restored.')).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull()
    // Past the debounce, nothing from the old editor has come after it.
    await act(() => new Promise((resolve) => setTimeout(resolve, 500)))
    expect(await stored()).toEqual(['FROM THE BACKUP'])
  })
})

describe('App revision restore', () => {
  /** Opens the history row at `index`, 0 being Current, and restores it. */
  async function restoreRow(user: ReturnType<typeof userEvent.setup>, index: number) {
    // History reads its versions once it's open.
    await screen.findByText('Current')
    const rows = within(screen.getByRole('list', { name: 'Versions' })).getAllByRole('listitem')
    await user.click(within(rows[index]).getByRole('button'))
    await user.click(screen.getByText('Restore this whole version'))
  }

  // The editor is remounted only by its `key`. Keying on the revision id meant
  // restoring the same revision twice produced an identical key, so the editor
  // kept the text the restore had just replaced — and wrote it back on the
  // next keystroke, silently undoing the restore.
  it('remounts the editor when the same revision is restored twice', async () => {
    const id = await items.create('note', bodyOf('VONE'))
    await db.revisions.add({
      id: crypto.randomUUID(),
      itemId: id,
      body: bodyOf('VZERO'),
      createdAt: Date.now() - COALESCE_MS * 2,
    })

    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('VONE'))
    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await user.click(await screen.findByText('Version history'))

    // Rows are newest first: 0 is "Current" (VONE), 1 is the older VZERO.
    await restoreRow(user, 1)
    await waitFor(() =>
      expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('VZERO'),
    )

    await user.type(screen.getByTestId('editor'), '-PLUS')
    await waitFor(async () => expect(textOf((await items.get(id))!.body)).toBe('VZERO-PLUS'))

    // Restore that same revision again — now row 2, behind the two snapshots
    // the first restore took.
    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await user.click(await screen.findByText('Version history'))
    await restoreRow(user, 2)

    await waitFor(() =>
      expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('VZERO'),
    )
    expect(textOf((await items.get(id))!.body)).toBe('VZERO')
  })

  it('brings one paragraph back, keeps History open, and keeps the text it replaced', async () => {
    const two = (first: string, second: string): JSONContent => ({
      type: 'doc',
      content: [first, second].map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
    })
    const second = (body: JSONContent) => body.content?.[1]?.content?.[0]?.text
    const id = await items.create('note', two('KEEP', 'The boats came in early.'))
    await db.revisions.add({ id: crypto.randomUUID(), itemId: id, body: two('KEEP', 'The boats came in late.'), createdAt: Date.now() - COALESCE_MS * 2 })
    // Bringing back one paragraph is Plus's (Phase 10).
    plusOn.active = true

    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByText('KEEP'))
    await user.keyboard(`{${MOD}>}k{/${MOD}}`)
    await user.click(await screen.findByText('Version history'))
    await screen.findByText('Current')
    await user.click(within(screen.getByRole('list', { name: 'Versions' })).getAllByRole('button')[0])
    await user.click(screen.getByRole('button', { name: 'Bring back “The boats came in late.”' }))

    await waitFor(async () => expect(second((await items.get(id))!.body)).toBe('The boats came in late.'))
    expect(await screen.findByText('No changes to the words since then.')).toBeTruthy()
    expect(await screen.findByText('Brought back. The text before is kept in History.')).toBeTruthy()
    await waitFor(async () => {
      const kept = (await revisions.list(id)).map((revision) => second(revision.body))
      expect(kept).toContain('The boats came in early.')
      expect(kept[0]).toBe('The boats came in late.')
    })
  })
})

describe('App open document moved to trash', () => {
  async function openAndEdit(user: ReturnType<typeof userEvent.setup>, title: string) {
    await user.click(await screen.findByText(title))
    await waitFor(() =>
      expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe(title),
    )
  }

  it('tells the writer when another tab trashed the open document', async () => {
    const id = await items.create('note', bodyOf('MINE'))
    const user = userEvent.setup()
    render(<App />)
    await openAndEdit(user, 'MINE')

    await act(async () => {
      await items.remove(id)
    })

    expect(await screen.findByText(/This was moved to the trash/)).toBeTruthy()
    // The editor still holds the text — it was not the writer's delete.
    expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe('MINE')
  })

  it('does not treat this tab trashing the open document as a surprise', async () => {
    await items.create('note', bodyOf('MINE'))
    const user = userEvent.setup()
    render(<App />)
    await openAndEdit(user, 'MINE')

    await user.click(screen.getByLabelText(/^Move .* to trash$/))
    await waitFor(async () => expect(await items.listTrash()).toHaveLength(1))
    expect(screen.queryByText(/This was moved to the trash/)).toBeNull()
  })

  it('Restore puts it back in the list', async () => {
    const id = await items.create('note', bodyOf('MINE'))
    const user = userEvent.setup()
    render(<App />)
    await openAndEdit(user, 'MINE')

    await act(async () => {
      await items.remove(id)
    })
    await screen.findByText(/This was moved to the trash/)
    await user.click(screen.getByText('Restore'))

    await waitFor(() => expect(screen.queryByText(/This was moved to the trash/)).toBeNull())
    await waitFor(async () => expect((await items.get(id))?.deletedAt).toBeUndefined())
    expect(await items.list('note')).toHaveLength(1)
  })

  it('Leave it there keeps the text in the trash and opens a new draft', async () => {
    const id = await items.create('note', bodyOf('MINE'))
    const user = userEvent.setup()
    render(<App />)
    await openAndEdit(user, 'MINE')
    await user.type(screen.getByTestId('editor'), '!')

    await act(async () => {
      await items.remove(id)
    })
    await screen.findByText(/This was moved to the trash/)
    await user.click(screen.getByText('Leave it there'))

    await waitFor(() =>
      expect(screen.getByTestId<HTMLTextAreaElement>('editor').value).toBe(''),
    )
    expect(screen.queryByText(/This was moved to the trash/)).toBeNull()
    await waitFor(async () => expect(textOf((await items.get(id))!.body)).toBe('MINE!'))
    expect((await items.get(id))?.deletedAt).toBeTypeOf('number')
  })
})

describe('App unload', () => {
  function leave() {
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent
    Object.defineProperty(event, 'returnValue', { writable: true, value: '' })
    window.dispatchEvent(event)
    return event
  }

  it('asks before leaving with an edit that has not been written yet', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByTestId('editor'), 'UNSAVED')

    const event = leave()
    expect(event.defaultPrevented).toBe(true)
  })

  it('does not ask when nothing is pending', async () => {
    render(<App />)
    const event = leave()
    expect(event.defaultPrevented).toBe(false)
  })

  it('does not ask once the edit has been stored', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.type(screen.getByTestId('editor'), 'SAVED')
    await waitFor(async () => expect(await stored()).toEqual(['SAVED']))

    // Stored is not yet settled: the queue counts the write in flight until its
    // promise resolves, a beat after IndexedDB commits, and asking in that gap
    // is correct. Waiting for a record alone was worse — the first write can
    // land after 'S' with the rest still in the debounce. Both raced.
    await waitFor(() => expect(leave().defaultPrevented).toBe(false))
  })
})

describe('App keyboard hints on touch', () => {
  // A touch screen hides shortcut hints until a hardware keyboard shows itself.
  // Only a real keyboard sends a modifier, so ordinary typing must not count.
  it('remembers a keyboard once a modifier key arrives, not before', async () => {
    const user = userEvent.setup()
    localStorage.removeItem('nib-keys')
    delete document.documentElement.dataset.keys
    render(<App />)

    await user.type(screen.getByTestId('editor'), 'Plain typing, Shift included')
    expect('keys' in document.documentElement.dataset).toBe(false)

    await user.keyboard('{Meta>}{/Meta}')
    expect('keys' in document.documentElement.dataset).toBe(true)
    expect(localStorage.getItem('nib-keys')).toBe('1')

    localStorage.removeItem('nib-keys')
    delete document.documentElement.dataset.keys
  })
})
