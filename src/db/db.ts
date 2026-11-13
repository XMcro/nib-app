import type { Accent } from '../lib/look'
import Dexie, { type EntityTable } from 'dexie'
import type { JSONContent } from '@tiptap/react'

export type Kind = 'note' | 'page'

/** A document's own target, in words, and the day to reach it by (`YYYY-MM-DD`). */
export type Goal = { words: number; deadline?: string }

/**
 * A shared draft of a document (share/crypto.ts): its slug, the key in its
 * link, and the token that proves the writer to the server. Secret, and kept
 * with the document so every synced device can revoke it or read its notes.
 */
/**
 * `password`, when set, is needed with the link to read the draft (share/crypto
 * `withPassword`). `free` marks one made without Nib Plus: read-only, for 7
 * days, and one live at a time across the library.
 */
export type ShareRef = { slug: string; key: string; owner: string; createdAt: number; expiresAt: number; password?: string; free?: true; once?: true }

export type Category = { name: string; color: Accent }

/** One of the stampbook's 300 is its number, with the day it was found; a holiday's is its day, which says which holiday it is. */
export type Placed = { day: string; no?: number }

/** How a reminder comes round again (lib/reminders): at the same hour each day, week, month or year. */
export type Repeat = 'day' | 'week' | 'month' | 'year'

/** A reminder on a document (lib/reminders): when it rings, first if it repeats, on each device the document is on. */
export type Reminder = { at: number; repeat?: Repeat }

/** `salt` makes the key from the passcode; `sealed` is the body: a 12-byte IV, then AES-GCM, bound to the document's id. */
export type Vault = { salt: string; sealed: string }

export interface Item {
  id: string
  kind: Kind
  /** Opaque outside src/db. Today: TipTap JSON. Later: a ciphertext blob. */
  body: JSONContent
  /** Revision counter, incremented on every save. */
  version: number
  createdAt: number
  updatedAt: number
  /** Set when trashed. Unindexed, so it needed no schema migration. */
  deletedAt?: number
  /** Set when pinned; pinned items sort above everything else. */
  pinnedAt?: number
  /**
   * Bumped by every write of any kind — pin, trash and restore too, which
   * `version` deliberately ignores so they cannot look like another tab's edit.
   * Sync compares it against what it last sent, through the [id+rev] index,
   * without loading a single document body.
   */
  rev?: number
  /** Its words can't be changed until this is taken off. Unindexed. Taken off is `null`, for the same reason as `goal`. */
  readOnly?: true | null
  /** When it went into the archive, which keeps it out of the lists and search. Unindexed. Taken out is `null`, for the same reason as `goal`. */
  archivedAt?: number | null
  /** A template to start new documents from (lib/templates), kept out of the lists and search, in Templates. Unindexed. Taken off is `null`, for the same reason as `goal`. */
  template?: true | null
  /**
   * Kept on this device only: off the server and the writer's other devices,
   * and never sent (sync/engine). This device's to say, so it doesn't travel
   * with sync; it is in backups, as the document is. Unindexed. Taken off is
   * `null`, as `goal`.
   */
  deviceOnly?: true | null
  /** Its reminder (lib/reminders). Unindexed. Taken off is `null`, for the same reason as `goal`. One whose time has passed is as none. */
  reminder?: Reminder | null
  /** Nib Plus. The day it moves itself to the trash, `YYYY-MM-DD` (lib/expiry). Unindexed. Taken off is `null`, for the same reason as `goal`. */
  expires?: string | null
  /**
   * Nib Plus. Unindexed, so no schema migration. `null` means the goal was
   * removed, and is stored rather than deleting the field: a document arriving
   * without the field may come from a Nib that predates goals and dropped it,
   * which says nothing about the goal (see sync/engine.ts).
   */
  goal?: Goal | null
  /** Shared drafts. Unindexed. An empty list, not a missing one, means none, for the same reason as `goal`. */
  shares?: ShareRef[]
  /** The folder it's in, by name (lib/folders). Unindexed. Taken out of it is `null`, for the same reason as `goal`. */
  folder?: string | null
  /** Its categories (lib/folders). Unindexed. An empty list, not a missing one, means none, as with `shares`. */
  categories?: Category[]
  /**
   * A page's place among its folder's pages, the manuscript's order
   * (lib/manuscript): lower first. Unindexed. Taken away when the page moves
   * to another folder, as `null`, for the same reason as `goal`.
   */
  position?: number | null
  /** Stamps put on it from the Stampbook (lib/placed). Unindexed. An empty list, not a missing one, means none, as with `categories`. */
  stamps?: Placed[]
  /**
   * Nib Plus: in the vault (lib/vault). The text is sealed here and `body` is
   * left empty. `null` means its lock was removed, for the same reason as `goal`.
   */
  vault?: Vault | null
  /**
   * A copy of an edit a lock beat in sync (sync/engine), not sealed yet: its
   * text boxed under this device's key (lib/vault `box`), or a seal still
   * bound to the document it came from. Text in the clear is an earlier
   * Nib's, boxed at launch (db/items `boxCopies`). It is locked
   * like any other (lib/vault `isLocked`) with an empty `body`, stays on this
   * device, and is sealed under its own id when the vault next opens here
   * (db/items `sealCopies`), which replaces this with `vault`.
   */
  unsealed?: { box: string } | { vault: Vault; from: string } | { body: JSONContent }
}

export interface Revision {
  id: string
  itemId: string
  body: JSONContent
  createdAt: number
}

/** What sync last sent or received for one record, under its hashed key. */
export interface SyncRecord {
  k: string
  type: 'item' | 'revision' | 'stamps' | 'folders' | 'looks'
  id: string
  /** The server's sequence number for this record's latest version. */
  seq: number
  /** For items: the local `rev` that matches what the server holds. */
  rev?: number
  deleted?: boolean
  /**
   * Deleted by a delete without a seal, which could have been the server's
   * own: kept here instead (a document in the Trash), and sent nowhere until
   * it is restored. Sync engine `apply` and `outgoing`.
   */
  held?: boolean
  /**
   * For revisions: past the history the server keeps, which let go of its
   * sealed text (sync/engine expireHistory). Kept here; not asked again.
   */
  expired?: boolean
  /**
   * For items: the highest count, sealed into each version, of any version
   * this device has had of this record. One no higher is the server handing
   * back the past (sync engine `apply`).
   */
  n?: number
  /** For the stamps, the folders' settings and the saved looks: the server's copy, as this device last knew it (lib/collection, lib/folderSettings, lib/look, in their order), to send only when this device has more. */
  sum?: string
}

// Immutable: a live query hands out the same objects for the rows a save left
// alone, and freezes them, instead of cloning the whole library after each save
// (and with it every cache keyed on a body). Nothing may write to a row from one.
export const db = new Dexie('nib', { cache: 'immutable' }) as Dexie & {
  items: EntityTable<Item, 'id'>
  revisions: EntityTable<Revision, 'id'>
  syncRecords: EntityTable<SyncRecord, 'k'>
  syncMeta: EntityTable<{ k: string; v: number }, 'k'>
}

db.version(1).stores({ items: 'id, [kind+updatedAt]' })
// v2 adds revisions. Dexie creates the new store and leaves items untouched.
db.version(2).stores({ items: 'id, [kind+updatedAt]', revisions: 'id, [itemId+createdAt]' })
// v3 adds sync: a change counter on items (indexed with the id, so a scan
// reads keys, not bodies), and sync's own bookkeeping. Existing items start
// their counter at their version.
db.version(3)
  .stores({
    items: 'id, [kind+updatedAt], [id+rev]',
    revisions: 'id, [itemId+createdAt]',
    syncRecords: 'k, [type+id]',
    syncMeta: 'k',
  })
  .upgrade((tx) =>
    tx
      .table('items')
      .toCollection()
      .modify((item: Item) => {
        item.rev = item.version
      }),
  )
