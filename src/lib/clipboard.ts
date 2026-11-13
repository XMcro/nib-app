import { registerPlugin } from '@capacitor/core'
import { nativeApp } from './platform'

interface NibClipboard {
  write(options: { text: string; html?: string; expiresIn?: number; localOnly?: boolean }): Promise<void>
}

/** How long something private stays on the clipboard: time to paste it, not to come across it later. */
export const PRIVATE_COPY_MS = 10 * 60_000

/**
 * Something private: `expires` takes it off the clipboard after
 * PRIVATE_COPY_MS (a sync code, a password); `thisDeviceOnly` keeps it off
 * the writer's other devices too, which Universal Clipboard would hand it to
 * (a locked note's text).
 */
export type Privately = { expires: true; thisDeviceOnly?: true }

/** How a locked note's text is copied: for this device alone, and only for a while. */
export const SEALED_COPY: Privately = { expires: true, thisDeviceOnly: true }

const pasteboard = registerPlugin<NibClipboard>('NibClipboard')

/**
 * Puts `text` on the clipboard, with `html` beside it for apps that take rich
 * text. In the app it goes through the native pasteboard
 * (ios/App/App/NibClipboardPlugin.swift): what a page copies through WebKit
 * reached other Mac apps as nothing they could paste.
 */
export function copyText(text: string, html?: string, privately?: Privately): Promise<void> {
  if (!nativeApp) return navigator.clipboard.writeText(text)
  if (!privately) return pasteboard.write({ text, html })
  return pasteboard.write({ text, html, expiresIn: PRIVATE_COPY_MS, ...(privately.thisDeviceOnly && { localOnly: true }) })
}
