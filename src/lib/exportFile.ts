import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'

/**
 * Files made for the share sheet or the Mac's Save dialog: Markdown, a
 * backup, Word, HTML, and the PDF (ios/App/App/NibPdfPlugin.swift). They are
 * the writing in the clear, opened vault notes included, so each goes once it
 * has been handed over, and whatever is left over goes at the next launch.
 */

/** Their folder in Caches. The PDF plugin writes there too. */
const FOLDER = 'exports'
// What earlier versions of Nib left loose in Caches: Markdown and backups by
// date, a document by its title.
const LOOSE = /^nib-(export-.*\.md|backup-.*\.json)$|\.(html|docx|pdf)$/i

/** Writes `name` where the share sheet and the Save dialog can take it from. Returns its URI. */
export async function writeExport(name: string, data: string, encoding?: Encoding): Promise<string> {
  const { uri } = await Filesystem.writeFile({
    path: `${FOLDER}/${name}`,
    data,
    directory: Directory.Cache,
    recursive: true,
    ...(encoding ? { encoding } : {}),
  })
  return uri
}

/** Hands the file at `uri` over with `hand`, then deletes it, however that went. */
export async function handOverFile(uri: string, hand: (uri: string) => Promise<void>): Promise<void> {
  try {
    await hand(uri)
  } finally {
    await Filesystem.deleteFile({ path: uri }).catch((error: unknown) => console.warn('Nib: could not delete an export', error))
  }
}

/** The bytes of the file at `uri`, which is then deleted: a PDF on its way into a zip (lib/exportMany). */
export async function takeExport(uri: string): Promise<Uint8Array> {
  try {
    const { data } = await Filesystem.readFile({ path: uri })
    return Uint8Array.from(atob(data as string), (char) => char.charCodeAt(0))
  } finally {
    await Filesystem.deleteFile({ path: uri }).catch((error: unknown) => console.warn('Nib: could not delete an export', error))
  }
}

/** At launch: exports a crash left behind, and those earlier versions kept. */
export async function sweepExports(): Promise<void> {
  await Filesystem.rmdir({ path: FOLDER, directory: Directory.Cache, recursive: true }).catch(() => {}) // none left
  const { files } = await Filesystem.readdir({ path: '', directory: Directory.Cache })
  for (const file of files) {
    if (file.type === 'file' && LOOSE.test(file.name)) await Filesystem.deleteFile({ path: file.name, directory: Directory.Cache })
  }
}
