/**
 * What a document may say of a file in the store (lib/files): its id, and no
 * more than a file can be. Kept apart, with nothing imported but what the app
 * and the server agree on, so what checks a document (lib/image, the reader's
 * page too) doesn't bring the store with it.
 */

/** The most one file may be. */
import { MAX_FILE } from '../../worker/wire.mjs'

export { MAX_FILE }

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** True for an id the store gave out: all that's taken from a document to find a file by. */
export const isFileId = (raw: unknown): raw is string => typeof raw === 'string' && ID.test(raw)

/**
 * A file as a document names it: which one, what kind (its media type), how
 * many bytes. A picture's original (lib/image `full`) and an attachment
 * (lib/attachment) are each one.
 */
export type FileRef = { id: string; type: string; size: number }

/** A media type and nothing after it: it's put on a file fetched back from the server, and said beside an attachment's name. */
const TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/i

/** A file a document may name: an id of the store's, a media type, a size a file can be. Anything else is none. */
export function asFileRef(raw: unknown): FileRef | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { id, type, size } = raw as Record<string, unknown>
  if (!isFileId(id) || typeof type !== 'string' || !TYPE.test(type)) return null
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0 || size > MAX_FILE) return null
  return { id, type, size }
}
