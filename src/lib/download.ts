import { Capacitor, registerPlugin } from '@capacitor/core'
import { Encoding } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { handOverFile, writeExport } from './exportFile'
import { macApp } from './platform'

/** A file the writer asked for, handed over: saved on the Mac, the share sheet on iPhone and iPad, a download in a browser. For fileActions' exports, and the error screen's backup (components/ErrorBoundary). */

const saver = registerPlugin<{ save(options: { uri: string }): Promise<{ saved: boolean }> }>('NibSave')

/** The folder chosen in the Mac's Save dialog wouldn't take the file: macOS said no, as it can for the Desktop in iCloud Drive. */
export class SaveRefused extends Error {}

export async function share(uri: string) {
  // On the Mac a file is saved, not shared: the Save dialog, where the writer
  // picks the folder (ios/App/App/NibSavePlugin.swift). Cancelling is fine.
  if (macApp) {
    try {
      await saver.save({ uri })
    } catch (error) {
      if ((error as { code?: string }).code === 'refused') throw new SaveRefused((error as Error).message)
      throw error
    }
    return
  }
  try {
    await Share.share({ files: [uri] })
  } catch (error) {
    // Dismissing the sheet rejects too. That is the writer's choice, not a failure.
    if (!/cancel/i.test(String(error))) throw error
  }
}

const base64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

// The iOS app's web view ignores <a download>: the click does nothing and
// throws nothing. There the file goes to the share sheet instead, where Save to
// Files is one tap — Markdown export has to work everywhere Nib runs.
export async function download(content: string | Blob, filename: string, type = 'text/markdown;charset=utf-8') {
  if (Capacitor.isNativePlatform()) {
    const text = typeof content === 'string'
    const uri = await writeExport(filename, text ? content : await base64(content), text ? Encoding.UTF8 : undefined)
    return handOverFile(uri, share)
  }
  const url = URL.createObjectURL(typeof content === 'string' ? new Blob([content], { type }) : content)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
