import { isFileId } from './fileRef'
import { readJson, writeJson } from './jsonStorage'

/**
 * What sync has still to do with files (sync/files), kept on this device as
 * lists of ids: the originals named by documents that were sent, whose files
 * follow them; and those to be taken off the server. Apart from sync itself,
 * so that what locks a note or keeps it on this device (lib/fileUse) can say
 * so whether or not sync is running.
 */
const WAITING = 'nib-files-waiting'
const GONE = 'nib-files-gone'
const REMOVALS = 'nib-files-removals'

/** A list of files' ids kept on this device under `key`: whatever else is there, only those. */
export function read(key: string): string[] {
  const kept = readJson<unknown>(key, [])
  return Array.isArray(kept) ? kept.filter(isFileId) : []
}
const add = (key: string, ids: string[]) => ids.length > 0 && writeJson(key, [...new Set([...read(key), ...ids])])
const drop = (key: string, ids: string[]) => writeJson(key, read(key).filter((id) => !ids.includes(id)))

/** Originals whose files are to be sent, if they're on this device and the server hasn't them. */
export const filesWaiting = () => read(WAITING)
export const sendFiles = (ids: string[]) => add(WAITING, ids)
export const fileSettled = (id: string) => drop(WAITING, [id])

/** Originals whose files are to be taken off the server: no longer waiting to be sent, either. */
export const filesGone = () => read(GONE)
export function removeFiles(ids: string[]) {
  if (ids.length === 0) return
  writeJson(REMOVALS, removals() + 1)
  add(GONE, ids)
  drop(WAITING, ids)
}
/**
 * How many times files have been given to be taken off the server (`removeFiles`). What was worked out before one
 * and acted on after it may send a file that was to go (sync/files `nameFiles`), and the list of those to go
 * (`filesGone`) doesn't say: sync empties it as it takes them off.
 */
export const removals = (): number => Number(readJson<unknown>(REMOVALS, 0)) || 0
export const fileRemoved = (id: string) => drop(GONE, [id])
