import { registerPlugin } from '@capacitor/core'
import { imageFile, readAsDataUrl } from './image'
import { nativeApp } from './platform'

/**
 * The words in a picture, read on this device by Apple's Vision
 * (ios/App/App/NibTextPlugin.swift). Nothing leaves the device. Only in the
 * app, and only from iOS and macOS 26, the first with Vision's document
 * reader; anywhere else a picture is just a picture.
 */
const reader = registerPlugin<{
  read(options: { image: string }): Promise<{ paragraphs: string[] }>
  warm(): Promise<void>
}>('NibText')

/** Larger than a camera's largest photo: past it, a picture isn't sent across to be read (as text, four thirds its size), and goes in as a picture. */
export const READ_MAX = 20 * 1024 * 1024

/** How long after launch Vision is readied (`warmUp`): Nib has opened by then. */
const WARM_AFTER_MS = 5000

/**
 * Vision readies its reader the first time an app reads a picture, about 24
 * seconds on a Mac, and the first picture pasted waited for it. Done quietly
 * a little after each launch instead (NibTextPlugin warm): after the first
 * time, and until the system is updated, that's a fifth of a second.
 */
export function warmUp() {
  if (nativeApp) setTimeout(() => void reader.warm().catch(() => {}), WARM_AFTER_MS)
}

/**
 * The paragraphs of words in `file`, in reading order, or null when it has
 * none. Only for a picture Nib would keep as one, so the picture can always
 * go back in place of its words.
 */
export async function wordsIn(file: Blob): Promise<string[] | null> {
  if (!nativeApp || !imageFile(file) || file.size > READ_MAX) return null
  try {
    const image = await readAsDataUrl(file)
    if (!image) return null
    const { paragraphs } = await reader.read({ image })
    const words = paragraphs.map((paragraph) => paragraph.trim()).filter(Boolean)
    return words.length > 0 ? words : null
  } catch (error) {
    console.warn('Nib: could not read the words in a picture', error)
    return null
  }
}
