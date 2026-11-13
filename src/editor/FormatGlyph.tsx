/**
 * How the styles of editor/formats are drawn on a button, on the bar above
 * the keyboard and on the selection toolbar.
 */

/** Each letter's look, and its size on the bar and, `small`, on the toolbar. */
const LETTERS: Record<string, { letter: string; look: string; size: string; small: string }> = {
  'format-bold': { letter: 'B', look: '', size: 'text-[16px] font-bold', small: 'text-[14px] font-semibold' },
  'format-italic': { letter: 'I', look: 'italic', size: 'text-[16px]', small: 'text-[15px]' },
  'format-underline': { letter: 'U', look: 'underline underline-offset-2', size: 'text-[16px]', small: 'text-[14px]' },
  'format-strike': { letter: 'S', look: 'line-through', size: 'text-[16px]', small: 'text-[14px]' },
  'format-highlight': { letter: 'ab', look: 'rounded-[3px] bg-[var(--color-highlight)] px-1', size: 'text-[14px] text-ink', small: 'text-[12px]' },
}

export function TextGlyph({ id, small = false }: { id: string; small?: boolean }) {
  const glyph = LETTERS[id]
  return <span className={`${small ? glyph.small : glyph.size} ${glyph.look}`}>{glyph.letter}</span>
}

export function AlignIcon({ id }: { id: string }) {
  const widths = id === 'format-justify' ? [14, 14, 14, 14] : [14, 9, 14, 9]
  const from = (width: number) => (id === 'format-align-right' ? 16 - width : id === 'format-align-center' ? 9 - width / 2 : 2)
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      {widths.map((width, row) => (
        <path key={row} d={`M${from(width)} ${3.5 + row * 3.7}h${width}`} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      ))}
    </svg>
  )
}

export function ListIcon({ id }: { id: string }) {
  const line = (y: number) => <path d={`M7 ${y}h8`} stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
      {id === 'format-checklist' && (
        <>
          <rect x="1.5" y="3" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
          <path d="m2.5 5 1 1 1.5-1.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="1.5" y="11" width="4" height="4" rx="1" stroke="currentColor" strokeWidth="1.2" />
          {line(5)}
          {line(13)}
        </>
      )}
      {id === 'format-bullets' && (
        <>
          <circle cx="3" cy="5" r="1.2" fill="currentColor" />
          <circle cx="3" cy="13" r="1.2" fill="currentColor" />
          {line(5)}
          {line(13)}
        </>
      )}
      {id === 'format-numbers' && (
        <>
          <text x="1" y="7" fontSize="6" fill="currentColor">1</text>
          <text x="1" y="15" fontSize="6" fill="currentColor">2</text>
          {line(5)}
          {line(13)}
        </>
      )}
      {id === 'format-indent' && (
        <>
          <path d="m2 6 3 3-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          {line(5)}
          {line(9)}
          {line(13)}
        </>
      )}
      {id === 'format-outdent' && (
        <>
          <path d="M5 6 2 9l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          {line(5)}
          {line(9)}
          {line(13)}
        </>
      )}
    </svg>
  )
}
