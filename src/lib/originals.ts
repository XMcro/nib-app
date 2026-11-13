import type { JSONContent } from '@tiptap/core'
import { MAX_FILE } from './fileRef'
import { fileUrl, hasFile, keepFile, readFile } from './files'
import { asFull, MAX_BYTES, originalOf, readAsDataUrl, type Full } from './image'

/**
 * A picture's original, kept with Nib Plus (lib/files): a note holds its
 * picture made small enough to live in it (lib/image toDataUrl), and with
 * Plus the picture as it came is kept beside the library, and shown in place
 * of the small one wherever it's on the device.
 *
 * Whether Plus is on is told from outside (App), as the look is told: the
 * places a picture comes in by are the editor's, which doesn't know.
 */
let keeping = false
export function keepOriginals(on: boolean) {
  keeping = on
}

/** Whether files are kept at all: with Plus. An attachment (editor/attach) asks, as an original does here. */
export const keepsFiles = () => keeping

/**
 * The original of `file`, kept, for the picture going into a note; null when
 * there is none to keep: without Plus, for a locked document (`locked`: its
 * text is sealed, and a file beside the library isn't), when the note's own
 * picture is already
 * the file's pixels untouched (a small PNG, WebP or GIF), when it's over a
 * file's limit, or a kind Nib doesn't keep. What it says about itself (where
 * and when it was taken) is left behind first, as it is from the small one.
 */
export async function keepOriginal(file: Blob, locked: boolean): Promise<Full | null> {
  if (!keeping || locked || file.size > MAX_FILE) return null
  if (file.size <= MAX_BYTES && file.type !== 'image/jpeg') return null
  const original = await originalOf(file)
  const id = original && (await keepFile(original))
  return id ? { id, type: original.type, size: original.size } : null
}

/**
 * How an original that isn't on this device is fetched from the server:
 * sync's, while it runs (sync/session), told from outside as Plus is. `was`:
 * taken away only if it's still the one in place.
 */
type Fetch = (full: Full) => Promise<boolean>
let fetcher: Fetch | null = null
export function fetchOriginalsWith(fetch: Fetch | null, was?: Fetch) {
  if (fetch || !was || fetcher === was) fetcher = fetch
}

/** Each asked for once at a time, however many pictures or exports want it. */
const asking = new Map<string, Promise<boolean>>()
function fetched(full: Full): Promise<boolean> {
  if (!fetcher) return Promise.resolve(false)
  const known = asking.get(full.id)
  if (known) return known
  const asked = fetcher(full).finally(() => asking.delete(full.id))
  asking.set(full.id, asked)
  return asked
}

/** Whether a file a document names is on this device now: there already, or fetched from the server for being asked. */
export const broughtHere = async (file: Full): Promise<boolean> => (await hasFile(file.id)) || fetched(file)

/**
 * Where the page can show a picture's original from: on this device already,
 * or fetched now from the server, the first time it's wanted here. Null if
 * it's in neither place, or can't be reached: the picture stays as its note
 * has it, and is asked for again the next time it's shown.
 */
export const originalUrl = async (full: Full): Promise<string | null> => (await fileUrl(full.id)) ?? ((await fetched(full)) ? fileUrl(full.id) : null)

/** The original as a picture a document can hold, fetched if it has to be; null if it can't be had. */
async function wholeSrc(full: Full): Promise<string | null> {
  const file = (await readFile(full.id)) ?? ((await fetched(full)) ? await readFile(full.id) : null)
  // Under the kind the note has for it: a file read back in the app comes without one.
  return file && readAsDataUrl(new Blob([file], { type: full.type }))
}

/**
 * A body for an export that is made to be kept or printed (Word, PDF, EPUB,
 * HTML): each picture as its original, where that is on this device or can
 * be fetched to it, and as the note has it where it can't. What's stored stays as it is, and what the
 * original says about itself was left behind when it was kept.
 */
export async function withOriginals(body: JSONContent): Promise<JSONContent> {
  if (body.type === 'image') {
    const full = asFull(body.attrs?.full)
    const src = full && (await wholeSrc(full))
    return src ? { ...body, attrs: { ...body.attrs, src } } : body
  }
  if (!body.content) return body
  const content: JSONContent[] = []
  // One at a time: a book's pictures read all at once are more than a phone has room for.
  for (const child of body.content) content.push(await withOriginals(child))
  return { ...body, content }
}
