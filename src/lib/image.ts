import type { JSONContent } from '@tiptap/react'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { base64 } from '../../worker/base64'
import { asAttached } from './attachment'
import { asFileRef, type FileRef } from './fileRef'

/**
 * Images live in the document body as data URIs — characters, not bytes in a
 * side table.
 *
 * The reason is the backup. `buildExport` returns one string and `download`
 * writes one text/markdown Blob; there is no seam for bytes to travel beside
 * it. A reference to a separate table would export as a dead link, so a
 * restored backup would come back with the pictures missing and no error — the
 * exact failure the audit spent its time removing. Characters cost size; a
 * silently incomplete backup costs the picture.
 *
 * If anyone does move these to a table later: jsdom's `structuredClone` of a
 * Blob returns `{}` with `size === undefined` and does not throw, so tests will
 * happily pass on data that was never really stored.
 */

/**
 * How wide a picture is shown when the writer has said: a share of the
 * text's width (index.css). Otherwise it's its own size, up to that width.
 * Only how it's shown: the picture kept is the same.
 */
export const IMAGE_SIZES = ['small', 'medium', 'large', 'full'] as const
export type ImageSize = (typeof IMAGE_SIZES)[number]

/** One of them, or null: this comes from stored bodies, pasted pages and imported files, and goes into an attribute. */
export const asImageSize = (raw: unknown): ImageSize | null => (IMAGE_SIZES.includes(raw as ImageSize) ? (raw as ImageSize) : null)

/** Each size as a share of the text's width, in hundredths. The app's and the reader's stylesheets say the same (index.css, reader/reader.css), which a test holds them to. */
export const IMAGE_SHARE: Record<ImageSize, number> = { small: 33, medium: 50, large: 75, full: 100 }

/** The same as style rules, for the pages Nib writes out whole: an export, a book's chapter. */
export const IMAGE_SIZE_RULES = IMAGE_SIZES.map((size) => `img[data-size="${size}"] { width: ${IMAGE_SHARE[size]}%; }`).join(' ')

/** The kinds of picture Nib keeps, each `image/` and one of these. */
const IMAGE_TYPES = 'png|jpeg|gif|webp'

/**
 * The one definition of what Nib accepts as an image source. Paste, import,
 * parseHTML, renderHTML, load-from-IDB and a future Dexie restore all go
 * through `allowedImageSrc` / `filterBodyImages` so there is a single place to
 * audit. Nothing remote and nothing scriptable: no http(s), no blob:, no SVG.
 *
 * IndexedDB is not a trusted renderer input. `parseHTML` never sees stored
 * JSON, so a hostile `src` that survived a dump would fetch unless render and
 * load check this too.
 */
export const IMAGE_SRC = new RegExp(`^data:image/(${IMAGE_TYPES});base64,[A-Za-z0-9+/]+=*$`)

/** True when `src` is a data URI Nib will put on an `<img>`. */
export function allowedImageSrc(src: unknown): src is string {
  return typeof src === 'string' && IMAGE_SRC.test(src)
}

/**
 * A sketch is an image with its PencilKit drawing kept beside the picture.
 * Nib no longer draws sketches, but keeps the drawings it has. It is base64 and nothing else,
 * and it is never put in the DOM (editor/NibImage), so it cannot load or run
 * anything; the cap keeps one sketch from taking a document's whole budget.
 */
export const MAX_DRAWING = 500 * 1024
const DRAWING = /^[A-Za-z0-9+/]+=*$/

/** True when `drawing` is one Nib will keep on a sketch. */
export function allowedDrawing(drawing: unknown): drawing is string {
  return typeof drawing === 'string' && drawing.length <= MAX_DRAWING && DRAWING.test(drawing)
}

/**
 * A picture's original in the file store (lib/files, lib/originals): which
 * file, what kind of picture, how many bytes. The picture in the note is what
 * is shown wherever the original isn't.
 */
export type Full = FileRef

/** A `full` Nib will keep on a picture: a file (lib/fileRef) that is a kind of picture Nib keeps. Anything else is none. */
export function asFull(raw: unknown): Full | null {
  const file = asFileRef(raw)
  return file && ACCEPTED.test(file.type) ? file : null
}

/** Its pictures' originals alone. */
export const originalsIn = (body: JSONContent): Full[] => [...(body.type === 'image' ? [asFull(body.attrs?.full)].filter((full) => full !== null) : []), ...(body.content ?? []).flatMap(originalsIn)]

/** Every file a body names, as often as it names it: its pictures' originals, and its attachments (lib/attachment). */
export function filesIn(body: JSONContent, found: FileRef[] = []): FileRef[] {
  const file = body.type === 'image' ? asFull(body.attrs?.full) : body.type === 'attachment' ? asFileRef(body.attrs?.file) : null
  if (file) found.push(file)
  body.content?.forEach((child) => filesIn(child, found))
  return found
}

/**
 * A body that names no file: what a locked document is sealed as (lib/vault),
 * since a file is kept in the clear beside the library. A picture stays as its
 * note has it. An attachment would be left its name alone, but none gets
 * this far: a note that has one can't be locked (db/items `lock`).
 */
export function withoutOriginals(body: JSONContent): JSONContent {
  if (body.type === 'image') {
    if (!body.attrs?.full) return body
    const { full: _, ...attrs } = body.attrs
    return { ...body, attrs }
  }
  if (body.type === 'attachment') return { ...body, attrs: { ...body.attrs, file: null } }
  if (!body.content) return body
  return { ...body, content: body.content.map(withoutOriginals) }
}

/**
 * Drops image nodes whose src Nib will not render. Call this on any path that
 * turns stored JSON into editor HTML — load, restore, import — so a future
 * Dexie dump cannot multiply a remote URL into the document.
 */
export function filterBodyImages(body: JSONContent): JSONContent {
  return filterNode(body, 0) ?? { type: 'doc', content: [] }
}

/** Deeper than anything Nib writes, lists in lists included. Everything that reads a body recurses. */
const MAX_DEPTH = 200

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The shape every Nib writes, and so what is let through. A synced or
 * restored body whose text wasn't a string threw where the list reads
 * titles, and the app drew nothing at all, at every launch.
 */
export function wellFormed(node: unknown): node is JSONContent {
  if (!isObject(node) || typeof node.type !== 'string') return false
  if ((node.type === 'text' || node.text !== undefined) && (typeof node.text !== 'string' || !node.text)) return false
  if (node.attrs !== undefined && !isObject(node.attrs)) return false
  if (node.marks !== undefined && !(Array.isArray(node.marks) && node.marks.every((mark) => isObject(mark) && typeof mark.type === 'string' && (mark.attrs === undefined || isObject(mark.attrs))))) return false
  return node.content === undefined || Array.isArray(node.content)
}

/** A table cell's column widths go into a style, so numbers or nothing: a string there wrote CSS. */
const widths = (value: unknown) => value === null || (Array.isArray(value) && value.every((width) => typeof width === 'number' && Number.isFinite(width) && width > 0))

/**
 * How many columns or rows a table cell takes: a whole number up to a hundred,
 * or one. A table is drawn a column at a time, so a cell said to span ten
 * million of them was a page that froze Nib each time it was opened or exported.
 */
export const asSpan = (value: unknown): number => (Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 100 ? (value as number) : 1)

const noAddress = (mark: { type: string; attrs?: Record<string, unknown> }) => mark.type === 'link' && typeof mark.attrs?.href !== 'string'

function filterNode(node: JSONContent, depth: number): JSONContent | null {
  if (depth > MAX_DEPTH || !wellFormed(node)) return null
  if (node.attrs && 'colwidth' in node.attrs && !widths(node.attrs.colwidth)) node = { ...node, attrs: { ...node.attrs, colwidth: null } }
  // A link is drawn by asking whether its address is one to follow, which reads it as text: a number there, from a
  // backup or another device, and the document it was in opened to nothing. The words stay, the link goes.
  if (node.marks?.some(noAddress)) node = { ...node, marks: node.marks.filter((mark) => !noAddress(mark)) }
  for (const name of ['colspan', 'rowspan']) {
    if (node.attrs && name in node.attrs && node.attrs[name] !== asSpan(node.attrs[name])) node = { ...node, attrs: { ...node.attrs, [name]: asSpan(node.attrs[name]) } }
  }
  if (node.type === 'image') {
    if (!allowedImageSrc(node.attrs?.src)) return null
    // A drawing that fails the check costs only the editing: the picture stays.
    const drawing = node.attrs?.drawing
    if (drawing !== undefined && drawing !== null && !allowedDrawing(drawing)) {
      node = { ...node, attrs: { ...node.attrs, drawing: null } }
    }
    // An original that isn't one costs only that: the picture stays, as the note has it.
    const full = node.attrs?.full
    if (full !== undefined && full !== null && !asFull(full)) node = { ...node, attrs: { ...node.attrs, full: null } }
    return node
  }
  // An attachment is its name and, if what's said of it is one, its file: nothing else it says is kept.
  if (node.type === 'attachment') {
    const attached = asAttached(node.attrs)
    return attached && { type: 'attachment', attrs: attached }
  }
  if (!node.content) return node
  return {
    ...node,
    content: node.content.flatMap((child) => {
      const next = filterNode(child, depth + 1)
      return next ? [next] : []
    }),
  }
}

/**
 * Rewrites `src` on every image node. No allowlist — callers run
 * `filterBodyImages` / `allowedImageSrc`. The Dexie backup uses this to swap
 * a data URI for a hash ref without a second policy walker of its own.
 * What isn't a node, or is deeper than any is, is left as it is for that
 * filter to drop: read here first, a damaged backup threw, and was answered
 * as if the device couldn't save.
 */
export function mapImageSrcs(body: JSONContent, fn: (src: string) => string): JSONContent {
  return mapNode(body, 0)
  function mapNode(node: JSONContent, depth: number): JSONContent {
    if (depth > MAX_DEPTH || !wellFormed(node)) return node
    if (node.type === 'image') {
      return { ...node, attrs: { ...node.attrs, src: fn(String(node.attrs?.src ?? '')) } }
    }
    if (!node.content) return node
    return { ...node, content: node.content.map((child) => mapNode(child, depth + 1)) }
  }
}

/** Beyond this a single image is re-encoded rather than stored as-is. A sketch's picture is drawn to fit it. */
export const MAX_BYTES = 200 * 1024

export { DOC_BUDGET } from '../../worker/wire.mjs'

/** What a document's images take up as stored: every picture, and every sketch's drawing too. */
export function imageBytes(doc: ProseMirrorNode): number {
  let total = 0
  doc.descendants((node) => {
    if (node.type.name !== 'image') return
    total += String(node.attrs.src ?? '').length
    if (typeof node.attrs.drawing === 'string') total += node.attrs.drawing.length
  })
  return total
}

const ACCEPTED = new RegExp(`^image/(${IMAGE_TYPES})$`)

/** True when `file` is a kind of picture Nib keeps: PNG, JPEG, GIF or WebP. */
export const imageFile = (file: Blob) => ACCEPTED.test(file.type)

export const readAsDataUrl = (blob: Blob) =>
  new Promise<string | null>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(blob)
  })

const encode = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.8))

/** Re-encodes with the long edge at `edge`, or null if that is not possible. */
async function downscale(blob: Blob, edge: number): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(blob)
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const webp = await encode(canvas, 'image/webp')
    if (webp?.type === 'image/webp') return webp
    // WebKit — every browser on iPhone and iPad, and the app's web view —
    // cannot encode WebP and quietly hands back a PNG, usually far over the
    // cap. JPEG there instead. It has no alpha, so transparent areas are
    // painted white first rather than coming out black.
    context.globalCompositeOperation = 'destination-over'
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    return await encode(canvas, 'image/jpeg')
  } catch {
    return null
  }
}

/** PNG chunks that hold words about a picture, not the picture: EXIF (where and when, the camera), text, and the time it was saved. */
const PNG_ABOUT = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME'])

/** A PNG without its words about itself: its pixels, alpha and animation as they were. Null if it isn't one. */
export function withoutPngAbout(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 8 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a) return null
  const kept: Uint8Array[] = [bytes.subarray(0, 8)]
  for (let at = 8; at < bytes.length; ) {
    if (at + 12 > bytes.length) return null
    const end = at + 12 + view.getUint32(at)
    if (end > bytes.length) return null
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    if (!PNG_ABOUT.has(type)) kept.push(bytes.subarray(at, end))
    // Past its end is no chunk of the picture's, however it reads: as it came.
    if (type === 'IEND') {
      kept.push(bytes.subarray(end))
      break
    }
    at = end
  }
  return joined(kept)
}

/** A WebP without its EXIF and XMP, and its header no longer saying it has them. Null if it isn't one. */
export function withoutWebpAbout(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') return null
  const kept: Uint8Array[] = [bytes.slice(0, 12)]
  for (let at = 12; at < bytes.length; ) {
    if (at + 8 > bytes.length) return null
    const end = at + 8 + view.getUint32(at + 4, true) + (view.getUint32(at + 4, true) % 2)
    if (end > bytes.length) return null
    const chunk = bytes.slice(at, end)
    if (tag(at) === 'VP8X') chunk[8] &= ~0x0c
    if (tag(at) !== 'EXIF' && tag(at) !== 'XMP ') kept.push(chunk)
    at = end
  }
  const out = joined(kept)
  new DataView(out.buffer).setUint32(4, out.length - 8, true)
  return out
}

/** Which way up an EXIF block says its picture goes, 1 to 8; 1 if it doesn't say, or it can't be read. */
function orientationIn(exif: Uint8Array): number {
  try {
    const view = new DataView(exif.buffer, exif.byteOffset, exif.byteLength)
    const little = view.getUint16(0) === 0x4949
    const entries = view.getUint32(4, little)
    for (let i = 0; i < view.getUint16(entries, little); i++) {
      const entry = entries + 2 + i * 12
      if (view.getUint16(entry, little) === 0x0112) return Math.min(8, Math.max(1, view.getUint16(entry + 8, little)))
    }
  } catch {
    // Damaged: no way up to keep.
  }
  return 1
}

/** An EXIF block holding one thing, which way up the picture goes. */
const exifTurned = (orientation: number) => Uint8Array.of(0xff, 0xe1, 0, 34, 0x45, 0x78, 0x69, 0x66, 0, 0, 0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0)

const startsWith = (bytes: Uint8Array, at: number, text: string) => [...text].every((char, i) => bytes[at + i] === char.charCodeAt(0))

/**
 * A JPEG without its words about itself, its compressed picture untouched
 * byte for byte: EXIF, XMP, IPTC and comments go, and anything after the
 * picture's end, as a phone's second picture. EXIF's way up stays, or a
 * photo would lie on its side, and so do the segments that say how to show it
 * (JFIF, the colour profile, Adobe's). Null if it isn't one.
 */
export function withoutJpegAbout(bytes: Uint8Array): Uint8Array | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const kept: Uint8Array[] = [bytes.subarray(0, 2)]
  let turned = false
  for (let at = 2; at + 1 < bytes.length; ) {
    if (bytes[at] !== 0xff) {
      // Stray bytes between segments: a browser steps over them to the next marker, so this does too.
      at = bytes.indexOf(0xff, at)
      if (at < 0) return null
      continue
    }
    const marker = bytes[at + 1]
    if (marker === 0xff) {
      at++
      continue
    }
    if (marker === 0xd9) {
      kept.push(bytes.subarray(at, at + 2))
      break
    }
    if (at + 4 > bytes.length) return null
    const end = at + 2 + view.getUint16(at + 2)
    if (end > bytes.length) return null
    if (marker === 0xda) {
      // A scan's data runs to the next marker: FF followed by anything but 00 or a restart. Cut off short, it runs to the end.
      let next = end
      while (next + 1 < bytes.length && !(bytes[next] === 0xff && bytes[next + 1] !== 0 && (bytes[next + 1] < 0xd0 || bytes[next + 1] > 0xd7))) next++
      if (next + 1 >= bytes.length) next = bytes.length
      kept.push(bytes.subarray(at, next))
      at = next
      continue
    }
    if (marker === 0xe1 && !turned && startsWith(bytes, at + 4, 'Exif\0\0')) {
      turned = true
      const orientation = orientationIn(bytes.subarray(at + 10, end))
      if (orientation !== 1) kept.push(exifTurned(orientation))
    }
    const about = marker === 0xfe || (marker >= 0xe0 && marker <= 0xef && marker !== 0xe0 && marker !== 0xee && !(marker === 0xe2 && startsWith(bytes, at + 4, 'ICC_PROFILE\0')))
    if (!about) kept.push(bytes.subarray(at, end))
    at = end
  }
  return joined(kept)
}

/**
 * A picture file as it came, without its words about itself and with nothing
 * drawn again: what's kept as its original (lib/originals). By what its bytes
 * are, as below. Null if it isn't a kind Nib keeps, or can't be read as one.
 */
export async function originalOf(file: Blob): Promise<Blob | null> {
  if (!imageFile(file)) return null
  const bytes = new Uint8Array(await file.arrayBuffer())
  const [kept, type] =
    bytes[0] === 0xff ? [withoutJpegAbout(bytes), 'image/jpeg']
    : bytes[0] === 0x89 ? [withoutPngAbout(bytes), 'image/png']
    : bytes[0] === 0x52 ? [withoutWebpAbout(bytes), 'image/webp']
    : startsWith(bytes, 0, 'GIF8') ? [bytes, 'image/gif']
    : [null, '']
  return kept && new Blob([kept as BlobPart], { type })
}

/**
 * A picture as a data URI, without its words about itself and with nothing
 * drawn again, so no quality or transparency goes: by what its bytes are, as a
 * `.jpg` that is really a PNG shows as one. A GIF, with no EXIF, stays as it is.
 * Null if it can't be read as what it starts out as.
 */
export function withoutAbout(src: string): string | null {
  const comma = src.indexOf(',')
  let bytes: Uint8Array
  try {
    bytes = Uint8Array.from(atob(src.slice(comma + 1)), (char) => char.charCodeAt(0))
  } catch {
    return null
  }
  const kept = bytes[0] === 0xff ? withoutJpegAbout(bytes) : bytes[0] === 0x89 ? withoutPngAbout(bytes) : bytes[0] === 0x52 ? withoutWebpAbout(bytes) : bytes
  return kept && `${src.slice(0, comma + 1)}${base64(kept)}`
}

/**
 * A body for leaving Nib, in a shared draft or an export: every picture
 * without its words about itself, and without the name of its original, which
 * is a file on the writer's devices and nothing to anyone else. What's stored
 * stays as it is.
 */
export function withoutAboutIn(body: JSONContent): JSONContent {
  // An attachment leaves as its name: the file stays on the writer's devices.
  if (body.type === 'attachment') return { ...body, attrs: { ...body.attrs, file: null } }
  if (body.type === 'image') {
    const { full: _, ...attrs } = body.attrs ?? {}
    const src = String(attrs.src ?? '')
    return { ...body, attrs: { ...attrs, src: withoutAbout(src) ?? src } }
  }
  if (!body.content) return body
  return { ...body, content: body.content.map(withoutAboutIn) }
}

function joined(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/**
 * A data URI for `file`, or null if Nib will not take it. Kept with nothing
 * about where or when it was taken, as it goes into shared drafts and exports:
 * a JPEG is always re-encoded, which leaves its EXIF behind and turns it as it
 * was shown; a small PNG or WebP loses only its EXIF and text, keeping its
 * alpha and animation; a GIF, with no EXIF, is kept as it is. Larger ones are
 * re-encoded, as large as fits a picture's limit, down to 500 on the long
 * edge. `readAsDataURL` declares whatever type the encoder actually
 * produced, so no capability check is needed.
 */
export async function toDataUrl(file: Blob): Promise<string | null> {
  if (!imageFile(file)) return null
  if (file.size <= MAX_BYTES && file.type !== 'image/jpeg') {
    if (file.type === 'image/gif') return readAsDataUrl(file)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const kept = file.type === 'image/png' ? withoutPngAbout(bytes) : withoutWebpAbout(bytes)
    if (kept) return readAsDataUrl(new Blob([kept as BlobPart], { type: file.type }))
  }
  if (file.size <= MAX_BYTES) {
    const same = await downscale(file, Infinity)
    if (same && same.size <= MAX_BYTES) return readAsDataUrl(same)
  }

  // The first that fits. Most do at one of the first two; a photograph full of detail was still over the limit at
  // 1000 across where WebP can't be made (the app, every iPhone and iPad), and was refused. Smaller beats not at all.
  for (const edge of [1600, 1000, 700, 500]) {
    const smaller = await downscale(file, edge)
    if (smaller && smaller.size <= MAX_BYTES) return readAsDataUrl(smaller)
  }
  return null
}
