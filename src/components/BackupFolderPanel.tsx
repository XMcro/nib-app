import { useEffect, useState } from 'react'
import { backUp, folderPlugin, lastBackup, setWhichFolders, whichFolders, type Last } from '../lib/backupFolder'
import { saidAs } from '../lib/folders'

const quiet = 'nib-tap cursor-pointer text-[11px] text-muted hover:text-ink disabled:cursor-default'
const primary = 'nib-tap w-full cursor-pointer rounded-md bg-ink py-2 text-[12px] font-medium text-paper disabled:cursor-default disabled:opacity-50'
const secondary = 'nib-tap w-full cursor-pointer rounded-md border border-line py-2 text-[12px] hover:bg-item-hover disabled:cursor-default disabled:opacity-50'

const FAILED: Record<Extract<Last, { failed: unknown }>['failed'], string> = {
  lost: 'Nib couldn’t find the folder. Choose it again.',
  refused: 'The folder wouldn’t take the files.',
  doubt: 'Nib waited, as your library wasn’t all here yet.',
  other: 'That folder holds another Nib library’s backup, so Nib left it as it is. Choose another folder for this one.',
  error: 'Something went wrong. Nib will try again tomorrow.',
}

/** How the last backup went, in words. */
function lastSaid(last: Last): string {
  const when = new Date(last.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  if ('failed' in last) return `${when}: ${FAILED[last.failed]}`
  const files = last.written === 1 ? '1 file written' : `${last.written} files written`
  return `Last backed up ${when}: ${files}${last.removed > 0 ? `, ${last.removed} taken away` : ''}.`
}

/**
 * Settings → Backup to a folder (Nib Plus, in the app): the folder Nib
 * writes the library to once a day (lib/backupFolder), chosen in the
 * system's picker, changed or let go; all the writing or chosen folders;
 * and how the last backup went, with Back up now.
 */
export function BackupFolderPanel({ folders, onBack }: { folders: string[]; onBack: () => void }) {
  // Not known till the app has looked.
  const [kept, setKept] = useState<{ name?: string; lost?: boolean } | null>(null)
  useEffect(() => {
    folderPlugin.folder().then(setKept, () => setKept({}))
  }, [])
  const [which, setWhich] = useState(whichFolders)
  const [last, setLast] = useState(lastBackup)
  const [busy, setBusy] = useState(false)

  async function backUpNow() {
    setBusy(true)
    const done = await backUp()
    setLast(done)
    if ('failed' in done && done.failed === 'lost') setKept({ lost: true })
    setBusy(false)
  }

  // A folder chosen is written to at once.
  async function choose() {
    const chosen = await folderPlugin.choose().catch(() => ({}) as { name?: string })
    if (!chosen.name) return
    setKept({ name: chosen.name })
    await backUpNow()
  }

  async function stop() {
    await folderPlugin.forget().catch(() => {})
    setKept({})
  }

  function choosing(next: string[] | null) {
    setWhichFolders(next)
    setWhich(next)
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <button onClick={onBack} className={quiet}>
          ← Back
        </button>
        <span className="text-[11px] text-faint">Backup to a folder</span>
      </div>
      <p className="mt-3 text-[11px] leading-[1.5] text-muted">
        Once a day, Nib writes your notes and pages to a folder you choose, as Markdown, with a full backup beside them to restore from: on iCloud Drive, Dropbox, a drive or this device.
      </p>

      {kept?.name ? (
        <>
          <div className="mt-3 text-[12px] font-medium">Writing to {kept.name}</div>
          {last && <p className="mt-0.5 text-[11px] text-muted">{lastSaid(last)}</p>}
          <button onClick={() => void backUpNow()} disabled={busy} className={`${primary} mt-3`}>
            {busy ? 'Backing up…' : 'Back up now'}
          </button>
          <button onClick={() => void choose()} disabled={busy} className={`${secondary} mt-1.5`}>
            Change folder
          </button>
          <button onClick={() => void stop()} disabled={busy} className={`${quiet} mt-2`}>
            Stop backing up
          </button>
        </>
      ) : (
        kept && (
          <>
            {kept.lost && <p className="mt-3 text-[11px] leading-[1.5] text-ink">Nib can’t find the folder it was writing to. Choose it, or another, again.</p>}
            <button onClick={() => void choose()} className={`${primary} mt-3`}>
              Choose a folder
            </button>
          </>
        )
      )}

      <div role="radiogroup" aria-label="What goes" className="mt-4 flex flex-col gap-1.5 text-[12px]">
        <label className="flex cursor-pointer items-center gap-2">
          <input type="radio" name="which" checked={which === null} onChange={() => choosing(null)} />
          All your writing
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input type="radio" name="which" checked={which !== null} onChange={() => choosing([])} />
          Only these folders
        </label>
      </div>
      {which !== null && (
        <div role="group" aria-label="Folders" className="mt-1.5 ml-5 flex flex-col gap-1 text-[12px]">
          {folders.length === 0 && <p className="text-[11px] text-muted">You have no folders yet.</p>}
          {folders.map((folder) => (
            <label key={folder} className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={which.includes(folder)}
                onChange={(event) => choosing(event.target.checked ? [...which, folder] : which.filter((one) => one !== folder))}
              />
              {saidAs(folder)}
            </label>
          ))}
          <p className="text-[10.5px] leading-[1.5] text-faint">A folder takes the folders inside it. The full backup is written only for all your writing.</p>
        </div>
      )}

      <p className="mt-3 text-[10.5px] leading-[1.5] text-faint">
        Nib writes there from this device and touches only what it wrote. In a folder on iCloud Drive or Dropbox, your writing is kept by them, not encrypted by Nib. Locked notes go only into the full backup, sealed; notes kept on this device only never go.
      </p>
    </div>
  )
}
