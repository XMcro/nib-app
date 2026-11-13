import { registerPlugin } from '@capacitor/core'
import { asCollection, emptyCollection, mergedWith, sameCollection, STAMPS_CHANGED, STAMPS_SYNCED, takeIn, type Collection } from './collection'

/** What iCloud's key-value storage keeps of one app, less room for the key's name. */
const ICLOUD_LIMIT = 1_000_000

/**
 * The stamps in iCloud (ios/App/App/NibCloudPlugin.swift): the collection
 * (lib/collection), the days, the stampbook's stamps, the market's trades and
 * the day's coins, kept as one value in iCloud's key-value store, on every
 * device signed in to the same Apple Account. Free, and apart from Nib sync,
 * which carries the same collection between devices with its code. Merged as
 * sync merges it: all that either has, so a pack opened, coins collected or a
 * week's wait begun on one device is so on all of them.
 */
const cloud = registerPlugin<{
  read(): Promise<{ value: string | null }>
  write(options: { value: string }): Promise<void>
  addListener(event: 'changed', listener: (change: { value: string | null }) => void): Promise<{ remove: () => Promise<void> }>
}>('NibCloud')

const parse = (value: string | null): Collection | null => {
  try {
    return value ? asCollection(JSON.parse(value)) : null
  } catch {
    return null
  }
}

/**
 * Keeps this device's stamps and iCloud's as one, from now till the returned
 * stop: iCloud's taken in now, again as another device changes them and as
 * Nib comes back to the screen, and this device's sent up whenever it has
 * any iCloud hasn't. `looked` once iCloud's have been read, or couldn't be.
 */
export function keepInCloud(looked: () => void): () => void {
  // iCloud's, as last read or written.
  let there: Collection | null = null
  let live = true

  function send() {
    if (!live) return
    const both = mergedWith(there)
    if (emptyCollection(both) || (there && sameCollection(both, there))) return
    there = both
    const value = JSON.stringify(both)
    // iCloud's key-value storage holds a megabyte, and a write past it fails without a word: about five busy years of
    // stamps and coins. Past it they stay here, and go with sync, which has no such limit.
    if (new Blob([value]).size > ICLOUD_LIMIT) return console.warn('Nib: the stamps are too many for iCloud to keep, so they stay on this device and in sync')
    cloud.write({ value }).catch((error: unknown) => console.warn('Nib: could not keep the stamps in iCloud', error))
  }
  function take(value: string | null) {
    if (!live) return
    const theirs = parse(value)
    if (theirs) there = theirs
    // Said (STAMPS_SYNCED), which sends what's here and not there.
    if (!takeIn(theirs)) send()
  }
  const read = () =>
    cloud
      .read()
      .then(({ value }) => take(value))
      .catch((error: unknown) => console.warn('Nib: could not read the stamps in iCloud', error))
  const back = () => document.visibilityState === 'visible' && void read()

  void read().finally(() => live && looked())
  const listening = Promise.resolve()
    .then(() => cloud.addListener('changed', ({ value }) => take(value)))
    .catch(() => null)
  window.addEventListener(STAMPS_CHANGED, send)
  window.addEventListener(STAMPS_SYNCED, send)
  document.addEventListener('visibilitychange', back)
  return () => {
    live = false
    void listening.then((handle) => handle?.remove())
    window.removeEventListener(STAMPS_CHANGED, send)
    window.removeEventListener(STAMPS_SYNCED, send)
    document.removeEventListener('visibilitychange', back)
  }
}
