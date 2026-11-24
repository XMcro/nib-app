import type { JSONContent } from '@tiptap/react'
import { oneLine, plainText } from './text'

/**
 * A book's characters and places (Nib Plus): cards the writer makes, each a
 * name, any other names it goes by (Mara, Mrs Lee) and a line about it, kept
 * with the book's folder (lib/folderSettings). Nib adds none of its own; it
 * only finds the chapters that name each one (`mentionsIn`).
 */

export type CastKind = 'character' | 'place'
export type CastCard = { id: string; kind: CastKind; name: string; also: string[]; line?: string }

/** More than a book has, and few enough that a copy from outside can't hold the app up. */
export const MAX_CAST = 500
const MAX_ALSO = 12
const MAX_NAME = 80

/** A name, a line of words of at most MAX_NAME. */
const asName = (raw: unknown) => {
  const name = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : ''
  return name && name.length <= MAX_NAME ? name : undefined
}

/** A card, from storage, a backup or another device; none for what isn't one. Its other names each once, and none its name. */
export function asCard(raw: unknown): CastCard | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const { id, kind, name, also, line } = raw as Record<string, unknown>
  const named = asName(name)
  if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id) || (kind !== 'character' && kind !== 'place') || !named) return undefined
  const others = Array.isArray(also) ? [...new Set(also.map(asName).filter((one): one is string => Boolean(one) && one !== named))].slice(0, MAX_ALSO) : []
  const said = typeof line === 'string' ? oneLine(line) : null
  return { id, kind, name: named, also: others, ...(said ? { line: said } : {}) }
}

/** A book's cards: each once by its id, in the order given, at most MAX_CAST. None for what isn't a list. */
export function asCast(raw: unknown): CastCard[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const seen = new Set<string>()
  return raw
    .flatMap((one) => {
      const card = asCard(one)
      if (!card || seen.has(card.id)) return []
      seen.add(card.id)
      return [card]
    })
    .slice(0, MAX_CAST)
}

/** A name as a pattern: its spaces any space, and either apostrophe for an apostrophe. */
const asPattern = (name: string) =>
  name
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/ /g, '\\s+')
    .replace(/['’]/g, "['’]")

/** A card's names, each as written and in capitals, as a screenplay's cue has it: the longest first, so "Mrs Lee" is found before "Lee". */
const namesOf = (card: CastCard) => [...new Set([card.name, ...card.also].flatMap((name) => [name, name.toLocaleUpperCase()]))].sort((a, b) => b.length - a.length)

/**
 * A card's names as one pattern: whole words only, so Mara isn't found in
 * Maradona; the longest first, so "Mrs Lee" is one mention, not "Lee" too.
 * The letter before is matched rather than looked behind for.
 */
function patternOf(card: CastCard): RegExp {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${namesOf(card).map(asPattern).join('|')})(?![\\p{L}\\p{N}])`, 'gu')
}

/** What a chapter's find bar opens on to show where it names a card (editor/FindBar): its names, as `mentionsIn` finds them. */
export const findSeedOf = (card: CastCard) => ({ words: namesOf(card).map(asPattern).join('|'), caseSensitive: true, wholeWord: true, regex: true, index: 0 })

/** Each card's chapters, in the order they're given, with how many times they name it; those that don't, left out. Each chapter's words are read once. */
export function mentionsIn(cards: CastCard[], chapters: { id: string; body: JSONContent }[]): Map<string, { id: string; count: number }[]> {
  const texts = chapters.map((chapter) => ({ id: chapter.id, text: plainText(chapter.body) }))
  return new Map(
    cards.map((card) => {
      const pattern = patternOf(card)
      return [card.id, texts.flatMap(({ id, text }) => {
        const count = text.match(pattern)?.length ?? 0
        return count ? [{ id, count }] : []
      })]
    }),
  )
}
