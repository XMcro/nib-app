import type { SyncRecord } from '../db/db'
import { SERVER } from '../lib/server'
import { httpApi } from './api'
import { codeStore } from './codeStore'
import { deriveKeys, newCode } from './crypto'
import { adopt, fill, resetSyncState, syncOnce } from './engine'

/**
 * The library behind `code`, moved to a new code, for when it has got out
 * (Sync changeCode). A new library is made for the new code, in the EU like
 * any new one (worker/library findLibrary), and given everything here, sealed
 * under its keys (engine fill), with signed sync required if the old one
 * required it. Only then is the old library deleted and this device moved
 * over: until that, a failure leaves the old library syncing as before, and
 * the new one is deleted again. Run with sync here held (Session hold).
 * Returns the new code.
 */
export async function changeLibrary(code: string, jws: string): Promise<string> {
  const before = await deriveKeys(code)
  const old = httpApi(SERVER, before)
  // So this device has everything the old library has.
  await syncOnce(before, old)
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
    await old.wipe()
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
