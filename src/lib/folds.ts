/**
 * Which headings are folded, in which documents, on this device (editor/fold).
 * Folding puts a section out of sight and changes nothing in the document, so
 * it is no edit, and it is kept here and not with the document: another
 * device shows the page whole. A heading is known by its level and its words,
 * as it has no name of its own.
 */

const KEY = 'nib-folds'

/** The documents whose folds are kept: past this, the ones longest left alone go. */
const MOST = 200

type Kept = Record<string, string[]>

function read(): Kept {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
    return Object.fromEntries(Object.entries(stored).filter(([, folds]) => Array.isArray(folds) && folds.every((fold) => typeof fold === 'string'))) as Kept
  } catch {
    return {}
  }
}

/** The folded headings of the document `id`, each as fold.ts names it. None for a document not saved yet. */
export function foldsOf(id: string | null): string[] {
  return id ? (read()[id] ?? []) : []
}

/** Keeps `folds` as the document's own; with none, nothing is kept of it. */
export function keepFolds(id: string, folds: string[]) {
  const kept = read()
  // Taken out first, so the one just touched is the last to go.
  delete kept[id]
  if (folds.length) kept[id] = folds
  const ids = Object.keys(kept)
  for (const old of ids.slice(0, Math.max(0, ids.length - MOST))) delete kept[old]
  try {
    localStorage.setItem(KEY, JSON.stringify(kept))
  } catch {
    // Storage off or full: the folds last while the document is open.
  }
}
