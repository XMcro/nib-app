import type { NoticeAction } from '../lib/notices'

/**
 * A warning: the sign, its words, and what can be done about it. Over the text
 * it's a row of its own; in the library's foot (`foot`), a part of the row
 * that's there.
 */
export function Banner({ text, actions = [], foot = false }: { text: string; actions?: NoticeAction[]; foot?: boolean }) {
  const line = (
    <>
      <span aria-hidden className="shrink-0 text-[11px] leading-none">
        ⚠
      </span>
      <span role="status" className={`text-[11px] font-medium text-ink ${foot ? 'min-w-0' : 'sm:whitespace-nowrap'}`}>
        {text}
      </span>
      {actions.map(({ label, run }) => (
        <button key={label} onClick={run} className="nib-tap shrink-0 cursor-pointer text-[11px] text-muted hover:text-ink">
          {label}
        </button>
      ))}
    </>
  )
  return foot ? line : <div className="nib-notice pointer-events-auto flex items-center gap-[7px] rounded-md border border-line bg-shell px-2 py-1 max-sm:flex-wrap">{line}</div>
}
