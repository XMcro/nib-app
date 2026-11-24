import { readJson, writeJson } from './jsonStorage'

/**
 * Which of the writer's folders go to the backup folder (lib/backupFolder):
 * all the library (null), or those named, each with the folders inside it.
 * Kept on this device. On its own, so renaming a folder (lib/folders) can
 * carry the choice without knowing the backup.
 */
const WHICH_KEY = 'nib-backup-folder-which'

export const whichFolders = (): string[] | null => {
  const which = readJson<unknown>(WHICH_KEY, null)
  return Array.isArray(which) ? which.filter((name): name is string => typeof name === 'string') : null
}
export const setWhichFolders = (which: string[] | null) => writeJson(WHICH_KEY, which)
