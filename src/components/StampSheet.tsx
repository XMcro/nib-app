import { useEffect, useRef, type ReactNode } from 'react'
import { Sheet } from './Sheet'

/**
 * A stamp's own page, over whatever showed it (the Stampbook, the Christmas
 * calendar): large, with what it is, its story, and a line
 * on when it came or how it will. `children`: what can be done with it.
 */
export function StampSheet({
  label,
  art,
  caption,
  name,
  story,
  note,
  back = 'Back',
  onBack,
  children,
}: {
  label: string
  art: ReactNode
  caption: string
  name: string
  story?: string | null
  note: ReactNode
  back?: string
  onBack: () => void
  children?: ReactNode
}) {
  const backButton = useRef<HTMLButtonElement>(null)
  // A button gone with what it did (the last spare sold) takes focus with it: back here, for Escape.
  useEffect(() => {
    if (document.activeElement === document.body) backButton.current?.focus()
  })
  return (
    <Sheet label={label} onClose={onBack} z="z-[55]" top="pt-[16vh]" focus={backButton} focusOnTouch className="nib-pop h-fit w-[min(320px,90vw)] rounded-lg border border-line bg-paper p-5 text-center">
      <div className="nib-stamp mx-auto w-fit">
        {art}
      </div>
      <div className="mt-5 text-[11px] text-muted">{caption}</div>
      <div className="mt-0.5 text-[15px] font-medium">{name}</div>
      {story && <p className="mt-1 text-[12.5px] leading-[1.5] text-muted italic">{story}</p>}
      <div className="mt-3 text-[12px] leading-[1.5] text-muted">{note}</div>
      {children}
      <button ref={backButton} onClick={onBack} className="nib-tap mt-4 cursor-pointer rounded-md bg-ink px-4 py-1.5 text-[12px] font-medium text-paper">
        {back}
      </button>
    </Sheet>
  )
}
