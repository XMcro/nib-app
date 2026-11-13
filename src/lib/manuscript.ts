import type { Item } from '../db/db'
import { settingOf, type FolderSettings } from './folderSettings'
import { filingOf, sameName, split } from './folders'

/**
 * A manuscript: a folder's pages, in the order the writer puts them, as
 * chapters. Notes in the folder are its research and stay out. There's no
 * record of a folder to keep the order on, so each page keeps its own place
 * (Item `position`), synced and backed up with it like its folder: moving a
 * chapter rewrites that one page, and two devices rarely touch the same one.
 *
 * The folders inside the folder (lib/folders) are the book's parts: after
 * its own pages, each one's pages in turn, under its name. A chapter's place
 * is among its own folder's pages, so it moves within its part.
 */

/** The one check on a page's place arriving from outside: a number, or `null` for taken away. Anything else says nothing. */
export function asPosition(raw: unknown): number | null | undefined {
  return raw === null ? null : Number.isFinite(raw) ? (raw as number) : undefined
}

const placed = (item: Item): item is Item & { position: number } => typeof item.position === 'number'

/**
 * The folder's pages in book order: those with a place by it, then those
 * without, which are new to the folder, oldest first, so a page written
 * next lands at the end.
 */
export function chaptersOf(documents: Item[], folder: string): Item[] {
  return documents
    // The folder's own pages: those in the folders inside it are its parts' (partsOf).
    .filter((item) => item.kind === 'page' && item.deletedAt === undefined && sameName(filingOf(item).folder ?? '', folder))
    .sort((a, b) => {
      if (placed(a) && placed(b)) return a.position - b.position || a.createdAt - b.createdAt
      if (placed(a) !== placed(b)) return placed(a) ? -1 : 1
      return a.createdAt - b.createdAt || a.id.localeCompare(b.id)
    })
}

/**
 * The places to write when the chapter at `from` moves to `to`, both
 * indexes in `chapters` as chaptersOf gives them. Only the moved one, given
 * a place between its new neighbours, while they all have places and there's
 * room between; otherwise every chapter, numbered 1 up in the new order.
 */
export function moveChapter(chapters: Item[], from: number, to: number): { id: string; position: number }[] {
  if (from === to) return []
  const order = [...chapters]
  const [moved] = order.splice(from, 1)
  order.splice(to, 0, moved)
  if (order.every(placed)) {
    const low = order[to - 1]?.position
    const high = order[to + 1]?.position
    const position = low === undefined ? high! - 1 : high === undefined ? low + 1 : (low + high) / 2
    if ((low === undefined || position > low) && (high === undefined || position < high)) return [{ id: moved.id, position }]
  }
  return order.map((item, index) => ({ id: item.id, position: index + 1 }))
}

/** A stretch of a book: the folder's own pages, with no name, or a folder inside it, by its own name, each with its chapters in order. */
export type Part = { name: string | null; folder: string; chapters: Item[] }

/**
 * The book of the folder: its own pages, then each folder inside it that
 * has pages, A to Z by its own name with numbers as numbers (Part 2 before
 * Part 10). None with no pages.
 */
export function partsOf(documents: Item[], folder: string): Part[] {
  const inside = new Map<string, string>()
  for (const item of documents) {
    // Any document's: a folder with no pages of its own to show is left out below.
    const filed = filingOf(item).folder
    if (!filed) continue
    const { parent } = split(filed)
    const key = filed.toLocaleLowerCase()
    if (parent !== null && sameName(parent, folder) && !inside.has(key)) inside.set(key, filed)
  }
  const named = [...inside.values()].sort((a, b) => split(a).name.localeCompare(split(b).name, undefined, { numeric: true }))
  return [{ name: null, folder }, ...named.map((one) => ({ name: split(one).name, folder: one }))]
    .map((part) => ({ ...part, chapters: chaptersOf(documents, part.folder) }))
    .filter((part) => part.chapters.length > 0)
}

/** What a folder's book is called: its name, and for a folder inside another, that one's first: "Novel: Part 1". */
export function bookTitle(folder: string): string {
  const { parent, name } = split(folder)
  return parent === null ? name : `${parent}: ${name}`
}

/**
 * The book's title page, after its cover and before its first chapter: its
 * title, and under it who it's by, if that's said, each in the middle. Word,
 * PDF and EPUB each take it as they take any page, as they do a part's.
 */
export function titlePage(title: string, author?: string): Item {
  const centred = { textAlign: 'center' }
  return {
    id: 'title-page',
    kind: 'page',
    version: 0,
    createdAt: 0,
    updatedAt: 0,
    body: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1, ...centred }, content: [{ type: 'text', text: title }] },
        ...(author ? [{ type: 'paragraph', attrs: centred, content: [{ type: 'text', text: `by ${author}` }] }] : []),
      ],
    },
  }
}

/** The name on the book last given one (lib/folderSettings), for a book not given its own: the writer's, most likely, or their pen name. */
export function rememberedAuthor(settings: FolderSettings): string | undefined {
  let latest: { at: number; author: string } | undefined
  for (const setting of Object.values(settings)) {
    if (!setting.gone && setting.author && (!latest || setting.at > latest.at)) latest = { at: setting.at, author: setting.author }
  }
  return latest?.author
}

/** What the folder's book is called and who it's by: as it's been given in its Manuscript, or else its name, and the name last given a book. */
export function bookOf(folder: string, settings: FolderSettings): { title: string; author?: string } {
  const own = settingOf(settings, folder)
  return { title: own?.title ?? bookTitle(folder), author: own?.author ?? rememberedAuthor(settings) }
}

/** A part's title page, as a chapter before its first: Word, PDF and EPUB each take it as they take any page, as they do the cover. */
export function partPage(name: string): Item {
  return {
    id: `part:${name}`,
    kind: 'page',
    version: 0,
    createdAt: 0,
    updatedAt: 0,
    body: { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: name }] }] },
  }
}

/**
 * Standard manuscript format, the one agents and editors ask for: the book
 * in Times New Roman, double-spaced, with an inch all round. Its first page
 * has the writer's name, the length and the title; each page after it has
 * the running head, and each chapter starts a third of the way down a page
 * of its own. Word and PDF each make it (lib/documentExport).
 */
export type Standard = { title: string; author?: string; words: number }

/** The book's length as its first page gives it: to the hundred, or from ten thousand words, to the thousand. */
export function aboutWords(words: number): string {
  if (words < 100) return words === 1 ? '1 word' : `${words.toLocaleString()} words`
  const step = words < 10_000 ? 100 : 1000
  return `about ${(Math.round(words / step) * step).toLocaleString()} words`
}

/** The line at the top of each page after the first, before its number: the writer's surname, then the title in capitals. */
export function runningHead({ title, author }: Standard): string {
  const surname = author?.trim().split(/\s+/).pop()
  return `${surname ? `${surname} / ` : ''}${title.toLocaleUpperCase()} / `
}

/** A line that's only marks, as a writer puts between scenes: ***, * * *, #, ⁂ or ~~~. */
const SCENE_BREAK = /^(?=.*\S)[\s#*~⁂]+$/u

/** A chapter with each break between scenes as standard manuscript format has it: a # on its own line, in the middle. */
export function withSceneBreaks(body: Item['body']): Item['body'] {
  return {
    ...body,
    content: body.content?.map((block) =>
      block.type === 'paragraph' && block.content?.every((run) => run.type === 'text') && SCENE_BREAK.test(block.content.map((run) => run.text).join(''))
        ?{ type: 'paragraph', attrs: { ...block.attrs, textAlign: 'center' }, content: [{ type: 'text', text: '#' }] }
        : block,
    ),
  }
}
