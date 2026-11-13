import { registerPlugin } from '@capacitor/core'

/**
 * A picture added from a web address. The app fetches it, once, natively
 * (ios/App/App/NibPicturePlugin.swift): the page's own policy lets it reach
 * Nib's servers and nothing else (lib/csp). What comes back is a picture like
 * one pasted in, and goes the same way from there (lib/image toDataUrl): the
 * note keeps its own copy, and the address is never asked again.
 *
 * It's the one time Nib contacts a server that isn't Nib's or Apple's, and
 * only one the writer names: the privacy page says so (site/privacy.html).
 */
const native = registerPlugin<{ fetch(options: { url: string }): Promise<{ data: string; type: string }> }>('NibPicture')

/** Why no picture came: the address, what was there, its size, or anything else. The plugin's codes. */
const PROBLEMS = ['address', 'kind', 'size', 'failed'] as const
export type PictureProblem = (typeof PROBLEMS)[number]

export const PICTURE_PROBLEMS: Record<PictureProblem, string> = {
  address: 'That isn’t an address Nib can fetch from. It has to start with https://',
  kind: 'There’s no picture at that address.',
  size: 'That picture is too large to add.',
  failed: 'Couldn’t fetch a picture from that address.',
}

export class PictureError extends Error {
  readonly problem: PictureProblem
  constructor(problem: PictureProblem) {
    super(PICTURE_PROBLEMS[problem])
    this.problem = problem
  }
}

/** The address as it will be asked for, or null: a whole https address and nothing else. */
export function asPictureAddress(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'https:' && url.hostname ? url.href : null
  } catch {
    return null
  }
}

/** The picture at `address`, as a file would be. Throws a PictureError saying why not. */
export async function pictureAt(address: string): Promise<Blob> {
  const url = asPictureAddress(address)
  if (!url) throw new PictureError('address')
  try {
    const { data, type } = await native.fetch({ url })
    const binary = atob(data)
    const bytes = new Uint8Array(binary.length)
    for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at)
    return new Blob([bytes], { type })
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code
    throw new PictureError(PROBLEMS.includes(code as PictureProblem) ? (code as PictureProblem) : 'failed')
  }
}
