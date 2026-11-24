/**
 * What can reach Nib's server about how Nib is used, read by the app and by
 * the Worker (worker/counts, worker/feedback), so the two can't differ. Plain
 * data: the Worker builds this file too.
 *
 * Each name is a thing done in Nib, never what was written or who did it. A
 * name that isn't here is dropped by the server.
 */
export const COUNTED = [
  'opened',
  'note_new',
  'page_new',
  'duplicated',
  'trashed',
  'pinned',
  'focus_mode',
  'read_aloud',
  'filing_opened',
  'history_opened',
  'notes_to_self_opened',
  'export_markdown',
  'export_word',
  'export_pdf',
  'export_html',
  'export_all',
  'share_opened',
  'reminder_opened',
  'sprint_started',
  'open_beside',
  'compare_drafts',
  'manuscript_opened',
  'import_started',
  'vault_locked',
  'settings_opened',
  'customize_opened',
  'theme_changed',
  'stampbook_opened',
  'market_opened',
  'pack_opened',
  'plus_offer_seen',
  'plus_bought',
  'feedback_opened',
  'feedback_sent',
] as const

export type Counted = (typeof COUNTED)[number]

/** Which kind of device, the only thing said about it. */
export const DEVICES = ['iphone', 'ipad', 'mac'] as const

export type Device = (typeof DEVICES)[number]

/** How long a message can be, in characters, trimmed. */
export const FEEDBACK_MIN = 200
export const FEEDBACK_MAX = 4000

/**
 * The Nib this is built with, as package.json has it (worker/counts.test.ts checks they agree), and the first that
 * sent counts: the server takes counts from the one to a few past the other (worker/counts), and from no version
 * anyone cares to make up.
 */
export const LATEST = '1.10.15'
export const FIRST_COUNTED = '1.10.10'

/** A version as Nib writes it, 1.10.09 for one. */
export const VERSION = /^\d{1,3}(\.\d{1,3}){0,2}$/
