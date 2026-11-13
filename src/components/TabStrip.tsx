import { PinIcon } from './Library'

/**
 * Tabs (lib/tabs): the strip along the top of the writing, under the way back
 * to the library. Shown once there are two.
 */
export function TabStrip({ tabs, front, hidden, onShow, onClose, onUnpin, onNew }: {
  /** The pinned first. */
  tabs: { key: number; label: string; pinned: boolean }[]
  /** The key of the one in front. */
  front: number
  /** Out of the way, as in focus mode, with its room kept so the text doesn't move. */
  hidden: boolean
  onShow: (key: number) => void
  onClose: (key: number) => void
  onUnpin: (key: number) => void
  onNew: () => void
}) {
  return (
    // Over the writing's half when a document is beside it. Its notices come down over its right end, as over the pane's own row.
    <div className="nib-chrome absolute top-11 right-[var(--nib-beside,0px)] left-0 flex h-[var(--nib-tabs)] items-center gap-1 px-3" data-hidden={hidden}>
      {/* A group of buttons, the one in front marked as current, and not a tablist: in one, the Mac calls every button a tab, each tab's × and pin among them. */}
      <div role="group" aria-label="Open documents" className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const selected = tab.key === front
          return (
            <div
              key={tab.key}
              data-tab
              className={`group flex h-7 max-w-[12rem] min-w-[5rem] shrink items-center rounded-md pointer-coarse:h-9 ${selected ? 'bg-item-hover text-ink' : 'text-muted hover:bg-item-hover hover:text-ink'}`}
            >
              <button aria-current={selected ? 'true' : undefined} onClick={() => onShow(tab.key)} className="nib-tap h-full min-w-0 flex-1 cursor-pointer truncate pr-1 pl-2.5 text-left text-[12px]">
                {tab.label}
              </button>
              {tab.pinned ? (
                // A pinned tab has its pin where the others have their ×, always showing: it says the tab is pinned, and takes the pin out.
                <button aria-label={`Unpin ${tab.label}`} onClick={() => onUnpin(tab.key)} className="nib-tap mr-0.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-faint hover:text-ink pointer-coarse:size-9">
                  <PinIcon pinned />
                </button>
              ) : (
                // Always there on a touch screen, which has no pointer to bring it up.
                <button
                  aria-label={`Close ${tab.label}`}
                  onClick={() => onClose(tab.key)}
                  className={`nib-tap mr-0.5 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-faint hover:text-ink focus-visible:opacity-100 pointer-coarse:size-9 pointer-coarse:opacity-100 ${selected ? '' : 'opacity-0 group-hover:opacity-100'}`}
                >
                  <svg aria-hidden width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                    <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
                  </svg>
                </button>
              )}
            </div>
          )
        })}
      </div>
      <button aria-label="New tab" onClick={onNew} className="nib-tap flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-item-hover hover:text-ink pointer-coarse:size-9">
        <svg aria-hidden width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <path d="M6 2v8M2 6h8" />
        </svg>
      </button>
    </div>
  )
}
