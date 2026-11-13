import { useEffect, useState } from 'react'
import * as items from '../db/items'
import type { useFirsts } from '../lib/firsts'
import { askedAboutDevices, markAskedAboutDevices } from '../lib/newDevice'
import { nativeApp } from '../lib/platform'
import type { Entitled } from '../lib/plus'
import type { Sync } from '../sync'
import { Welcome } from './Welcome'

/** The welcome on a new device (Welcome), not Plus's (PlusWelcome): who is welcomed, and what each way out of it does. */
export function useWelcome({ sync, firsts, entitled, askPlus, importFiles, write, openSync }: {
  sync: Pick<Sync, 'known' | 'code'>
  firsts: ReturnType<typeof useFirsts>
  entitled: Pick<Entitled, 'known' | 'subscribed'>
  askPlus: (reason: string, then?: () => void) => void
  importFiles: (files: File[]) => unknown
  /** A new note, to begin writing. */
  write: () => void
  /** Sync's settings, to give a code from another device. */
  openSync: () => void
}) {
  const [greeting, setGreeting] = useState(false)

  // Welcomed once, on a device that opens to an empty library with sync off:
  // someone new, or someone with Nib elsewhere, who is asked about that there.
  // A device with writing on it already never needed welcoming.
  useEffect(() => {
    if (!nativeApp || !sync.known || sync.code !== null || askedAboutDevices()) return
    let live = true
    void items.listAll().then((all) => {
      if (!live) return
      if (all.length) markAskedAboutDevices()
      else setGreeting(true)
    })
    return () => {
      live = false
    }
  }, [sync.known, sync.code])

  function endWelcome() {
    markAskedAboutDevices()
    setGreeting(false)
  }

  return {
    greeting,
    sheet: greeting && (
      <Welcome
        onStart={() => {
          endWelcome()
          firsts.start()
          write()
        }}
        onSync={() => {
          endWelcome()
          // Sync is Plus: without it, where it's sold, Plus first, then on to the code.
          if (nativeApp && entitled.known && !entitled.subscribed) askPlus('Keeping your writing in step with your other devices is part of Nib Plus.', openSync)
          else openSync()
        }}
        onImport={(files) => {
          endWelcome()
          firsts.start()
          void importFiles(files)
        }}
        onClose={() => {
          endWelcome()
          firsts.start()
        }}
      />
    ),
  }
}
