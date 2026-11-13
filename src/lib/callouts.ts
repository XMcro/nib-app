/** The eight kinds of callout: GitHub's five, and three more that Obsidian reads. In the order they are offered. */
export const CALLOUT_KINDS = ['note', 'info', 'tip', 'success', 'question', 'important', 'warning', 'caution'] as const
export type CalloutKind = (typeof CALLOUT_KINDS)[number]

export const CALLOUT_NAMES: Record<CalloutKind, string> = {
  note: 'Note',
  info: 'Info',
  tip: 'Tip',
  success: 'Success',
  question: 'Question',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
}

/** One of them, or null: this comes from stored bodies and imported files. */
export const asCalloutKind = (raw: unknown): CalloutKind | null => (CALLOUT_KINDS.includes(raw as CalloutKind) ? (raw as CalloutKind) : null)

/** On white paper, for what goes out of Nib, where a label has to read at a small size. */
export const CALLOUT_INK: Record<CalloutKind, string> = {
  note: '#55606f',
  info: '#1f66ad',
  tip: '#0b7268',
  success: '#1e7a3a',
  question: '#6d3fd4',
  important: '#a21caf',
  warning: '#a85b00',
  caution: '#b91c1c',
}

/** For an exported page or an e-book: the box, its colour, and its kind written over it, as there is no icon there. */
export const CALLOUT_CSS = `[data-callout] { margin: 0 0 0.9em; padding: 0.5em 0.9em; border-left: 3px solid; }
[data-callout] > :last-child { margin-bottom: 0; }
[data-callout]::before { display: block; font-weight: 600; font-size: 0.85em; }
${CALLOUT_KINDS.map((kind) => `[data-callout="${kind}"] { border-color: ${CALLOUT_INK[kind]}; }\n[data-callout="${kind}"]::before { content: "${CALLOUT_NAMES[kind]}"; color: ${CALLOUT_INK[kind]}; }`).join('\n')}`
