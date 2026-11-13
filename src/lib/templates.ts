/**
 * Templates: documents of one's own to start new ones from (db Item.template).
 * One is saved as a copy of a note or page (db/items saveAsTemplate) and kept
 * in Templates, apart from the lists and search as the archive is, both kinds
 * together. A Nib from before them shows a template as an ordinary document.
 *
 * Without Nib Plus: this many. Any more, from a device with Plus or from
 * before it ended, stay, and stay usable; it's only saving another that waits
 * for Plus, as with folders.
 */
export const FREE_TEMPLATES = 3

export const TEMPLATES_PLUS = `${FREE_TEMPLATES} templates is the most without Nib Plus. With it, keep as many as you like.`

export const canSaveTemplate = (templates: number, plus: boolean) => plus || templates < FREE_TEMPLATES
