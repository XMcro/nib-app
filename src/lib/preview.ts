import { registerPlugin } from '@capacitor/core'
import { download } from './download'
import type { FileRef } from './fileRef'
import { hasFile, namedFile, readFile } from './files'
import { broughtHere } from './originals'

/**
 * Opening an attached file (lib/attachment). In the app it's shown by the
 * system's own viewer (ios/App/App/NibPreviewPlugin.swift), which can read,
 * search and share it; in a browser, where Nib is only run to be worked on,
 * it's handed over as a download. One that isn't on this device is fetched
 * from the server first, as a picture's original is the first time it's shown
 * (lib/originals): an attachment, when it's opened.
 */
const viewer = registerPlugin<{
  show(options: { uri: string }): Promise<void>
  thumbnail(options: { uri: string; edge: number }): Promise<{ png: string }>
}>('NibPreview')

/** How opening one went: `away` if it isn't on this device and couldn't be fetched, `failed` if it's here and couldn't be shown. */
export type Opened = 'opened' | 'away' | 'failed'

/** What the writer is told when one didn't open. */
export const OPEN_PROBLEMS: Record<Exclude<Opened, 'opened'>, string> = {
  away: 'It isn’t on this device, and couldn’t be fetched.',
  failed: 'Couldn’t open it.',
}

export async function openAttached(file: FileRef, name: string): Promise<Opened> {
  try {
    if (!(await broughtHere(file))) return 'away'
    const named = await namedFile(file.id, name)
    if (!named) return 'failed'
    if (named.uri) {
      await viewer.show({ uri: named.uri })
      return 'opened'
    }
    const kept = await readFile(file.id)
    if (!kept) return 'failed'
    await download(new Blob([kept], { type: file.type }), name)
    return 'opened'
  } catch (error) {
    console.warn('Nib: could not open an attachment', error)
    return 'failed'
  }
}

/** Where the page can play it from, if it's on this device: nothing is fetched to find out. */
export const playable = async (file: FileRef, name: string): Promise<string | null> => ((await hasFile(file.id)) ? ((await namedFile(file.id, name))?.url ?? null) : null)

/** A small picture of its first page, as the system draws one, for a file that's on this device, in the app. Null anywhere else, or for a file the system draws nothing for. */
export async function firstPage(file: FileRef, name: string, edge: number): Promise<string | null> {
  if (!(await hasFile(file.id))) return null
  const named = await namedFile(file.id, name)
  if (!named?.uri) return null
  return viewer.thumbnail({ uri: named.uri, edge }).then(
    ({ png }) => (/^[A-Za-z0-9+/]+=*$/.test(png) ? `data:image/png;base64,${png}` : null),
    () => null,
  )
}
