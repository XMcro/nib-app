import type { Item } from '../db/db'
import { withoutAboutIn } from './image'
import { toMarkdown } from './markdown'
import { nameOf } from './fountain'

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

const entry = (item: Item) =>
  [`### ${nameOf(item)}`, `*${isoDay(item.createdAt)}*`, toMarkdown(withoutAboutIn(item.body))]
    .filter(Boolean)
    .join('\n\n')

/**
 * One portable Markdown file holding everything. Rules separate entries within
 * a section — not the headings — so the result reads naturally anywhere.
 */
export function buildExport(notes: Item[], pages: Item[], exportedAt: number): string {
  const counts = [
    notes.length && `${notes.length} note${notes.length === 1 ? '' : 's'}`,
    pages.length && `${pages.length} page${pages.length === 1 ? '' : 's'}`,
  ].filter(Boolean)

  const parts = [
    `# Nib export — ${isoDay(exportedAt)}`,
    counts.length ? `${counts.join(', ')}.` : 'Nothing saved yet.',
  ]

  for (const [heading, list] of [
    ['Notes', notes],
    ['Pages', pages],
  ] as const) {
    if (list.length === 0) continue
    parts.push(`## ${heading}`, list.map(entry).join('\n\n---\n\n'))
  }

  return parts.join('\n\n')
}

export function exportFilename(exportedAt: number, extension = 'md'): string {
  return `nib-export-${isoDay(exportedAt)}.${extension}`
}
