import { useMemo, useState, type ReactNode } from 'react'
import type { JSONContent } from '@tiptap/react'
import { useCounted } from '../lib/counts'
import { bringBack, compare, type Paragraph, type Part, type Run } from '../lib/compare'
import { momentOf } from '../lib/time'

/**
 * An earlier version beside the text as it is now (lib/compare): only what
 * changed, with what's between folded away. Words taken out are struck
 * through, and words put in are marked in the highlight colour each theme
 * already makes readable (Comparison.browser.test checks every theme). A
 * changed or removed paragraph can be brought back on its own. In place of
 * History's list.
 */
export function Comparison({
  then,
  now,
  at,
  onBack,
  onRestore,
  onBringBack,
  readOnly,
}: {
  then: JSONContent
  now: JSONContent
  /** When the earlier version was saved. */
  at: number
  onBack: () => void
  onRestore: () => void
  /** The text as it would be with one paragraph brought back, worked out from `now`. */
  onBringBack: (body: JSONContent) => void
  /** To be read and copied only: nothing here may change it. */
  readOnly?: boolean
}) {
  useCounted(true, 'compare_drafts')
  const parts = useMemo(() => compare(then, now), [then, now])
  // The unchanged stretches opened, by their place among these parts: all
  // folded again once a paragraph brought back changes them.
  const [opened, setOpened] = useState<{ of: Part[]; open: number[] }>({ of: parts, open: [] })
  const open = opened.of === parts ? opened.open : []
  const changes = parts.some((part) => part.kind !== 'same')

  // Under a changed or removed paragraph: what it is, and bringing it back.
  const footing = (part: Part, index: number) => {
    const body = () => bringBack(then, now, parts, index)
    const offered = !readOnly && (part.kind === 'changed' || (part.kind === 'removed' && !part.then.within.includes('table')))
    const words = part.kind === 'changed' || part.kind === 'removed' ? part.then.text : ''
    return (
      <div className="mt-0.5 flex items-center gap-3 text-[11px]">
        {part.kind === 'changed' && part.formatOnly && <span className="text-faint">Formatting only</span>}
        {offered && (
          <button
            aria-label={`Bring back “${words.length > 40 ? `${words.slice(0, 40)}…` : words}”`}
            onClick={() => {
              const next = body()
              if (next) onBringBack(next)
            }}
            className="nib-tap ml-auto cursor-pointer text-muted hover:text-ink"
          >
            Bring back
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="nib-swap flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between px-4 pb-2">
        <button onClick={onBack} className="nib-tap cursor-pointer text-[11px] text-muted hover:text-ink">
          ← Back
        </button>
        <span className="text-[11px] text-faint">History</span>
      </div>
      <div className="px-4 pt-1 pb-3">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">
          {momentOf(at)} <span className="font-normal text-muted">→ Current</span>
        </h2>
        {!readOnly && (
          <button onClick={onRestore} className="nib-tap mt-1.5 cursor-pointer text-[12px] text-muted hover:text-ink">
            Restore this whole version
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3 px-4 pb-6 text-[13.5px] leading-[1.55] phone:pb-24">
        {!changes && <p className="text-[12px] text-muted">No changes to the words since then.</p>}
        {parts.map((part, index) => {
          if (part.kind === 'same') {
            const shown = open.includes(index)
            const count = part.paragraphs.length
            return (
              <div key={index} className="flex flex-col gap-3">
                <button
                  aria-expanded={shown}
                  onClick={() => setOpened({ of: parts, open: shown ? open.filter((one) => one !== index) : [...open, index] })}
                  className="nib-tap cursor-pointer self-start text-[11px] text-faint hover:text-muted"
                >
                  ⋯ {count === 1 ? '1 paragraph' : `${count} paragraphs`} unchanged
                </button>
                {shown && part.paragraphs.map((paragraph, at) => <Block key={at} paragraph={paragraph} className="text-muted" />)}
              </div>
            )
          }
          if (part.kind === 'added') {
            return (
              <Block key={index} paragraph={part.now}>
                <Added>{part.now.text}</Added>
              </Block>
            )
          }
          return (
            <div key={index}>
              {part.kind === 'removed' ? (
                <Block paragraph={part.then}>
                  <Removed>{part.then.text}</Removed>
                </Block>
              ) : (
                <Block paragraph={part.now}>
                  {part.runs.map((run, at) => (
                    <Words key={at} run={run} />
                  ))}
                </Block>
              )}
              {footing(part, index)}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** A paragraph shown as what it is: a heading, code, a list item, a quote. */
function Block({ paragraph, className = '', children }: { paragraph: Paragraph; className?: string; children?: ReactNode }) {
  const { node, within } = paragraph
  const item = within.at(-1)
  const marker = item === 'listItem' ? '•' : item === 'taskItem' ? '☐' : item === 'taskItem:ticked' ? '☑' : null
  const look = [
    'whitespace-pre-wrap break-words',
    node.type === 'heading' ? 'font-semibold' : '',
    node.type === 'codeBlock' ? 'font-mono text-[12px]' : '',
    within.includes('blockquote') || within.includes('callout') ? 'border-l-2 border-line pl-3' : '',
    marker ? 'flex gap-2' : '',
    className,
  ].join(' ')
  const words = children ?? paragraph.text
  return (
    <p className={look}>
      {marker ? (
        <>
          <span aria-hidden className="shrink-0 text-faint">
            {marker}
          </span>
          <span className="min-w-0">{words}</span>
        </>
      ) : (
        words
      )}
    </p>
  )
}

function Words({ run }: { run: Run }) {
  if (run.change === 'removed') return <Removed>{run.text}</Removed>
  if (run.change === 'added') return <Added>{run.text}</Added>
  return run.text
}

// Named for a screen reader too, which may not say what <del> and <ins> are.
// In the text's own colour: the muted one is too faint to read struck
// through on some themes (Gruvbox Dark, drcl).
function Removed({ children }: { children: string }) {
  return (
    <del className="text-ink">
      <span className="sr-only">Removed: </span>
      {children}
    </del>
  )
}

function Added({ children }: { children: string }) {
  return (
    <ins className="rounded-[2px] bg-highlight no-underline [del+&]:ml-[0.2em]">
      <span className="sr-only">Added: </span>
      {children}
    </ins>
  )
}
