import { db, type SyncRecord } from '../db/db'
import { filesIn, type Full } from '../lib/image'
import { SERVER } from '../lib/server'
import { httpApi, SyncHttpError, type Api } from './api'
import { codeStore } from './codeStore'
import { deriveKeys, newCode } from './crypto'
import { adopt, fill, resetSyncState, syncOnce } from './engine'
import { fetchMissing } from './files'
import { takePosts } from './inbox'

/** Every file this device's documents name, in what they hold or in their history, once each. */
async function filesNamed(): Promise<Full[]> {
  const named = new Map<string, Full>()
  const note = (row: { body: Parameters<typeof filesIn>[0] }) => {
    for (const file of filesIn(row.body)) named.set(file.id, file)
  }
  // One at a time: a library's whole history, read in one go, is every version with its pictures held at once.
  await db.items.each(note)
  await db.revisions.each(note)
  return [...named.values()]
}

/** Whether a library has been deleted: asked, it says there's none. False if it's still there, or can't be asked. */
const isGone = (library: Api) =>
  library.status().then(
    () => false,
    (error: unknown) => error instanceof SyncHttpError && (error.status === 404 || error.status === 410),
  )

/** How long before the old library is asked again to go, each time no answer came back. */
const ASK_AGAIN_MS = [400, 1200]
/** Said when no answer could be had as to whether the old library went. Shown as it is (SyncPanel). */
export const UNSURE =
  'The connection was lost while the old library was being deleted, so the sync code may or may not have changed. Nothing is lost: all of it is on this device. When you’re online, look at Sync again: if it says its library is gone, turn sync off here, then on.'

/**
 * The old library deleted, and known to be. Its answer lost on the way back, it's asked again: one already
 * deleted says there's none, and one still being deleted is by then. Taken for a failure, the new library was
 * deleted too, both were gone, and the writer was told that nothing had changed (the server audit of 2026-11-23).
 * Only "there's none" is taken as its word. Any other answer, or none, is asked about again, and at the last it's
 * asked whether it's still there; `UNSURE` is thrown if that can't be told, and one that says it's still there
 * may be going as it says so. No refusal is taken for "still there": the server failing after the library went, a
 * request sent twice by the network and refused the second time as taken already, a refusal from in front of the
 * server, each was, and the new library was deleted with the old.
 */
async function deleted(old: Api) {
  for (let attempt = 0; ; attempt++) {
    try {
      await old.wipe()
      return
    } catch (error) {
      if (error instanceof SyncHttpError && (error.status === 404 || error.status === 410)) return
      if (attempt < ASK_AGAIN_MS.length) await new Promise((resolve) => setTimeout(resolve, ASK_AGAIN_MS[attempt]))
      else if (await isGone(old)) return
      else throw new Error(UNSURE)
    }
  }
}

/**
 * The library behind `code`, moved to a new code, for when it has got out
 * (Sync changeCode). A new library is made for the new code, in the EU like
 * any new one (worker/library findLibrary), and given everything here, sealed
 * under its keys (engine fill), with signed sync required if the old one
 * required it. Only then is the old library deleted and this device moved
 * over: until that, a failure leaves the old library syncing as before, and
 * the new one is deleted again. Run with sync here held (Session hold).
 * Returns the new code.
 *
 * What the old library holds that isn't its documents goes with it too, and
 * so is brought here first: the files this device never fetched (a picture's
 * original never shown here, an attachment never opened), and the posts
 * waiting in its inbox, made notes in `postsFolder` as at any look. Left, the
 * files of a phone since lost were deleted for good by the change made for
 * its sake (the server audit of 2026-11-23). A file the old library has that
 * can't be fetched stops the change, with nothing changed: the download
 * failed, or this device has no room for it. One that is lost already, there
 * only in name or not what its document names, doesn't (files `fetchMissing`).
 * Posts are taken once more just before the old library goes, for those that
 * came while the new one was filled.
 */
export async function changeLibrary(code: string, jws: string, postsFolder?: string): Promise<string> {
  const before = await deriveKeys(code)
  const old = httpApi(SERVER, before)
  // So this device has everything the old library has.
  await syncOnce(before, old)
  await takePosts(before, old, postsFolder)
  const unfetched = await fetchMissing(before, old, await filesNamed())
  if (unfetched.length > 0) {
    throw new Error(
      `${unfetched.length === 1 ? 'One of your library’s files' : `${unfetched.length} of your library’s files`} couldn’t be downloaded to this device, so the sync code hasn’t been changed and nothing was deleted. Check your connection and this device’s free space, then try again.`,
    )
  }
  const { signedOnly } = await old.status()
  const fresh = newCode()
  const keys = await deriveKeys(fresh)
  const api = httpApi(SERVER, keys)
  await api.create(jws)
  let filled: SyncRecord[]
  let gone = false
  try {
    // Signed where this device signs, so the first push enrols the new key (sync/api).
    filled = await fill(keys, api)
    if (signedOnly) await api.requireSigned(true)
    // Those that came since the first look: made notes now, they go to the new library with this device's next pass.
    await takePosts(before, old, postsFolder)
    await deleted(old)
    gone = true
    // Empty is right for either code: stopped between these, the next pass merges afresh.
    await resetSyncState()
    await codeStore.set(fresh)
  } catch (error) {
    // Its place goes back to the subscription.
    await api.wipe().catch((wiping: unknown) => console.warn('Nib: could not delete the new sync library', wiping))
    if (gone) throw new Error('The old library is deleted, but this device couldn’t move to the new code. Turn sync off here, then on again.')
    throw error
  }
  // Failing, it leaves nothing known: the first pass merges afresh, sending everything again.
  await adopt(filled).catch((error: unknown) => console.warn('Nib: could not keep what the new sync library holds', error))
  return fresh
}
