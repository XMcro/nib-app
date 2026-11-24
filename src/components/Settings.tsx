import { useEffect, useState, type ReactNode } from 'react'
import { IMPORT_ACCEPT } from '../lib/importApps'
import badge from '../assets/plus-badge.png'
import { RULES } from '../editor/styleCheck/rules'
import { rulesOn, setRule, useStyleSettings } from '../editor/styleCheck/settings'
import type { DailyReminder } from '../lib/dailyReminder'
import { FORMAT_NAMES, RICH_FORMATS, type RichFormat } from '../lib/documentExport'
import { sizeText } from '../lib/attachment'
import { setBuddy, useBuddy } from '../lib/buddy'
import { countsAnswer, setCountsAnswer, useCounted } from '../lib/counts'
import { listFiles } from '../lib/files'
import { LOCK_AFTER, describeUnlock, lock, unavailableReason, type LockStatus } from '../lib/lock'
import { useChosenLook } from '../lib/look'
import { nibWindow, type LoginItem } from '../lib/keyboard'
import { macApp, nativeApp } from '../lib/platform'
import type { Entitlement } from '../lib/plus'
import { NAMED, THEMES, THEME_LABEL, WINTER, type Mode, type Theme } from '../lib/theme'
import type { Sync } from '../sync'
import { describeSync } from '../sync/status'
import { Billing } from './Billing'
import { BackupFolderPanel } from './BackupFolderPanel'
import { BlogPanel } from './BlogPanel'
import { blogPlugin } from '../lib/blog'
import { Customize } from './Customize'
import { Goals } from './Goals'
import { Sheet } from './Sheet'
import { SyncPanel } from './SyncPanel'

export function Settings({
  theme,
  onThemeChange,
  folders = [],
  onExport,
  onExportCurrent,
  onExportCurrentAs,
  goal,
  onGoalChange,
  daily,
  winter = false,
  canExportCurrent,
  onImport,
  onBackup,
  onRestore,
  onAttachments,
  subscription,
  plus,
  pointsPlus = null,
  onPlusChange,
  sync,
  openTo = null,
  onFeedback,
}: {
  theme: Theme
  onThemeChange: (theme: Theme) => void
  /** Every folder, by its whole name: for Customize's choice of where Nib opens. */
  folders?: string[]
  onExport: () => void
  onExportCurrent: () => void
  onExportCurrentAs: (format: RichFormat) => void
  goal: number
  onGoalChange: (goal: number) => void
  /** The daily reminder (lib/dailyReminder), where it can ring. */
  daily?: Pick<DailyReminder, 'time' | 'change' | 'invitations' | 'changeInvitations'>
  /** Winter is among the themes once Christmas Day's present has given it (lib/rewards). */
  winter?: boolean
  canExportCurrent: boolean
  onImport: (files: File[]) => void
  onBackup: () => void
  /** Says whether it was restored: Settings then makes way for the library and its notice. */
  onRestore: (file: File) => Promise<boolean> | void
  /** The list of every attached file (components/AttachmentsPanel), in the library. */
  onAttachments?: () => void
  /** Nib Plus as the App Store has it. */
  subscription: Entitlement
  /** Plus's features: with the subscription, or days from the stamp market's points. */
  plus: boolean
  /** Plus's features open until then by the stamp market's points (lib/market), without the subscription: not sync, not Billing. */
  pointsPlus?: number | null
  onPlusChange: (entitlement: Entitlement) => void
  sync: Sync
  /**
   * Opens Settings at a view: the gear at its start, a "Plus" label at
   * Billing, and a new device's "Sync from another device" at Sync, ready for
   * a code, or the palette's "Change sync code…" at Sync, asking. `at` makes
   * a repeat a new request.
   */
  openTo?: { view: 'main' | 'billing' | 'sync' | 'blog'; at: number; changeCode?: boolean } | null
  /** Send feedback, in the app (components/TellUs). */
  onFeedback?: () => void
}) {
  const [open, setOpen] = useState(false)
  // Billing gets the whole panel rather than a section of it: it is the one
  // place in Nib that takes money, and should read that way.
  const [view, setView] = useState<'main' | 'billing' | 'sync' | 'goals' | 'customize' | 'acknowledgements' | 'blog' | 'backupFolder'>('main')
  // Through Billing too: subscribing there must not lead a new device to
  // "Turn on sync", which would start a second library instead of joining.
  const [joinFirst, setJoinFirst] = useState(false)
  const [changeFirst, setChangeFirst] = useState(false)
  useEffect(() => {
    if (!openTo) return
    setOpen(true)
    setView(openTo.view)
    setJoinFirst(openTo.view === 'sync')
    setChangeFirst(openTo.changeCode === true)
  }, [openTo])
  // Collapsed by default — the calm state, per screen 1e.
  const [advanced, setAdvanced] = useState(false)
  // A theme of one's own: its tile is drawn in its colours (Customize).
  const own = useChosenLook().ownTheme
  useStyleSettings()
  useCounted(open, 'settings_opened')
  useCounted(open && view === 'customize', 'customize_opened')

  const panel = 'p-4'
  const views = (
    <>
      {open && view === 'billing' && (
        <div className={panel}>
          <Billing
            entitlement={subscription}
            onEntitlement={(next) => {
              // Plus turned on: Settings makes way for its welcome, whose
              // badge lands in the library or on the gear (PlusWelcome).
              if (next.active && !subscription.active) setOpen(false)
              onPlusChange(next)
            }}
            onBack={() => setView('main')}
            onOpenSync={() => setView('sync')}
          />
        </div>
      )}

      {open && view === 'sync' && (
        <div className={panel}>
          <SyncPanel sync={sync} subscribed={subscription.active} startJoining={joinFirst} startChanging={changeFirst} onBack={() => setView('main')} onOpenBilling={() => setView('billing')} />
        </div>
      )}

      {open && view === 'blog' && (
        <div className={panel}>
          <BlogPanel plus={plus} onBack={() => setView('main')} />
        </div>
      )}

      {open && view === 'backupFolder' && (
        <div className={panel}>
          <BackupFolderPanel folders={folders} onBack={() => setView('main')} />
        </div>
      )}

      {open && view === 'customize' && (
        <div className={panel}>
          <Customize plus={plus} theme={theme} onThemeChange={onThemeChange} folders={folders} onOpenBilling={() => setView('billing')} onBack={() => setView('main')} />
        </div>
      )}

      {open && view === 'goals' && (
        <div className={panel}>
          <Goals
            goal={goal}
            onGoalChange={onGoalChange}
            daily={daily}
            plus={plus}
            onOpenBilling={() => setView('billing')}
            onBack={() => setView('main')}
          />
        </div>
      )}

      {open && view === 'acknowledgements' && (
        <div className={panel}>
          <Acknowledgements onBack={() => setView('main')} />
        </div>
      )}

      {open && view === 'main' && (
        <div className={panel}>
          <div className="text-[11px] text-muted">Appearance</div>
          {/* Neutral by design: the accent is reserved for caret, tab and links. */}
          <div className="relative mt-2 flex gap-px rounded-md border border-line p-px">
            {/* The selected background travels between the three, rather than
                switching off one and on another. Its width matches a segment:
                the row is 1px padded and 1px gapped, so three segments share
                what is left. */}
            <span
              aria-hidden
              data-k={THEMES.indexOf(theme as Mode)}
              // With a named theme chosen, none of the three is.
              className={`nib-segknob absolute top-px bottom-px left-px rounded-[4px] bg-item-active ${THEMES.includes(theme as Mode) ? '' : 'opacity-0'}`}
              style={{ width: 'calc((100% - 4px) / 3)' }}
            />
            {THEMES.map((option) => (
              <button
                key={option}
                aria-pressed={option === theme}
                onClick={() => onThemeChange(option)}
                className={`relative flex-1 cursor-pointer rounded-[4px] py-1 text-[11px] transition-colors pointer-coarse:min-h-11 ${
                  option === theme ? 'font-medium text-ink' : 'text-muted hover:text-ink'
                }`}
              >
                {THEME_LABEL[option]}
              </button>
            ))}
          </div>

          {/* The named themes, each shown in its own colours: its paper, its
              ink, and its accent. Fourteen are Nib Plus, and lead to Billing
              without it. Every row as tall as the tallest: a name that wraps,
              as Purple Green does beside its lock on an iPhone, made its row
              stand taller than the rest. */}
          <div role="radiogroup" aria-label="Themes" className="mt-2 grid auto-rows-fr grid-cols-2 gap-1.5">
            {NAMED.filter((option) => option.id !== WINTER || winter).map((option) => {
              const locked = option.plus && !plus
              return (
                <button
                  key={option.id}
                  role="radio"
                  aria-checked={option.id === theme}
                  onClick={() => (locked ? setView('billing') : onThemeChange(option.id))}
                  data-theme={option.id}
                  className={`nib-tap flex cursor-pointer items-center gap-2 rounded-md border bg-paper px-2 py-1.5 text-left pointer-coarse:min-h-11 ${
                    option.id === theme ? 'border-accent' : 'border-line'
                  }`}
                >
                  <span aria-hidden className="size-2 shrink-0 rounded-full bg-accent" />
                  {/* Onto two lines rather than cut short: two tiles both read "Gruvbo…". */}
                  <span className="flex-1 text-[11px] leading-tight text-ink">{option.label}</span>
                  {/* A small lock, not a word: "Plus" beside the name cut the name short. */}
                  {locked && (
                    <svg role="img" aria-label="Nib Plus" width="9" height="11" viewBox="0 0 9 11" fill="none" className="shrink-0 text-muted">
                      <path d="M2 4.6V3a2.5 2.5 0 0 1 5 0v1.6" stroke="currentColor" strokeWidth="1" />
                      <rect x=".5" y="4.6" width="8" height="5.9" rx="1.5" stroke="currentColor" strokeWidth="1" />
                    </svg>
                  )}
                </button>
              )
            })}
            <button
              role="radio"
              aria-checked={theme === 'custom'}
              onClick={() => (plus ? onThemeChange('custom') : setView('billing'))}
              style={{ background: own.paper, color: own.ink }}
              className={`nib-tap flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 text-left pointer-coarse:min-h-11 ${
                theme === 'custom' ? 'border-accent' : 'border-line'
              }`}
            >
              <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: own.accent }} />
              <span className="flex-1 text-[11px] leading-tight">Your own</span>
              {!plus && (
                <svg role="img" aria-label="Nib Plus" width="9" height="11" viewBox="0 0 9 11" fill="none" className="shrink-0 opacity-60">
                  <path d="M2 4.6V3a2.5 2.5 0 0 1 5 0v1.6" stroke="currentColor" strokeWidth="1" />
                  <rect x=".5" y="4.6" width="8" height="5.9" rx="1.5" stroke="currentColor" strokeWidth="1" />
                </svg>
              )}
            </button>
          </div>

          {/* Size, width, fonts, accent and toolbars (lib/look). */}
          <button
            onClick={() => setView('customize')}
            className="nib-tap mt-2 flex w-full cursor-pointer items-center gap-2 rounded-md border border-line px-2 py-1.5 text-left hover:bg-item-hover"
          >
            <span className="flex-1 text-[12px] font-medium">Customize</span>
            <span className="text-[11px] text-muted">›</span>
          </button>

          <button
            onClick={() => setView('billing')}
            className="nib-tap mt-4 flex w-full cursor-pointer items-center gap-2 rounded-md border border-line px-2 py-1.5 text-left hover:bg-item-hover"
          >
            <img src={badge} alt="" className="size-5" />
            <span className="flex-1 text-[12px] font-medium">Nib Plus</span>
            <span className="text-[11px] text-muted">
              {subscription.active ? 'Active' : pointsPlus ? `Until ${new Date(pointsPlus).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'Billing ›'}
            </span>
          </button>
          <button
            onClick={() => {
              setView('sync')
              setJoinFirst(false)
            }}
            className="nib-tap mt-1.5 flex w-full cursor-pointer items-center gap-2 rounded-md border border-line px-2 py-1.5 text-left hover:bg-item-hover"
          >
            <span className="flex-1 text-[12px] font-medium">Sync</span>
            <span className="max-w-[60%] truncate text-[11px] text-muted">
              {sync.code ? describeSync(sync.status) : 'Off'} ›
            </span>
          </button>
          {/* Nib Plus, and only in the app, which sends to it (lib/blog). */}
          {nativeApp && (
            <button
              // Without Plus, still the way to disconnect a blog connected with it; with none connected, to Nib Plus.
              onClick={() => (plus ? setView('blog') : void blogPlugin.blog().then(({ site }) => setView(site ? 'blog' : 'billing'), () => setView('billing')))}
              className="nib-tap mt-1.5 flex w-full cursor-pointer items-center gap-2 rounded-md border border-line px-2 py-1.5 text-left hover:bg-item-hover"
            >
              <span className="flex-1 text-[12px] font-medium">Your blog</span>
              <span className="text-[11px] text-muted">{plus ? '›' : 'Plus ›'}</span>
            </button>
          )}
          {/* Nib Plus, and only in the app, which writes there (lib/backupFolder). */}
          {nativeApp && (
            <button
              onClick={() => setView(plus ? 'backupFolder' : 'billing')}
              className="nib-tap mt-1.5 flex w-full cursor-pointer items-center gap-2 rounded-md border border-line px-2 py-1.5 text-left hover:bg-item-hover"
            >
              <span className="flex-1 text-[12px] font-medium">Backup to a folder</span>
              <span className="text-[11px] text-muted">{plus ? '›' : 'Plus ›'}</span>
            </button>
          )}
          {/* Only in the app. The daily goal and the year's card are free; the calendar and the stats are Nib Plus. */}
          {nativeApp && (
            <button
              onClick={() => setView('goals')}
              className="nib-tap mt-1.5 flex w-full cursor-pointer items-center gap-2 rounded-md border border-line px-2 py-1.5 text-left hover:bg-item-hover"
            >
              <span className="flex-1 text-[12px] font-medium">Goals</span>
              <span className="text-[11px] text-muted">
                {goal > 0 ? `${goal.toLocaleString()} a day ›` : '›'}
              </span>
            </button>
          )}
          {/* Free, and only in the app: the lock is native. */}
          {nativeApp && <LockRow />}
          {/* On the Mac: macOS keeps the list, so it's asked each time. */}
          {macApp && <LoginRow />}
          <BuddyRow />
          {onFeedback && (
            <button
              onClick={onFeedback}
              className="nib-tap mt-1.5 flex w-full cursor-pointer items-center gap-2 rounded-md border border-line px-2 py-1.5 text-left hover:bg-item-hover"
            >
              <span className="flex-1 text-[12px] font-medium">Send feedback</span>
              <span className="text-[11px] text-muted">›</span>
            </button>
          )}
          {nativeApp && <CountsRow />}
          {/* The export promise never changes, and Settings.test.tsx treats it
              as a contract. */}
          <p className="mt-2 text-[11px] leading-[1.5] text-muted">
            Your writing never leaves this device unless you share a draft, turn
            on sync, send it to your blog or back it up to a folder elsewhere,
            and Markdown export is free forever.
          </p>

          <button
            aria-expanded={advanced}
            onClick={() => setAdvanced((value) => !value)}
            className="mt-4 flex w-full cursor-pointer items-center justify-between text-[11px] text-muted hover:text-ink pointer-coarse:min-h-11"
          >
            <span>Advanced</span>
            <span aria-hidden>{advanced ? '−' : '+'}</span>
          </button>

          {advanced && (
            <div className="mt-2 flex flex-col">
              <button
                onClick={onExport}
                className="cursor-pointer rounded-[5px] px-2 py-1 text-left text-[12px] hover:bg-item-hover pointer-coarse:min-h-11"
              >
                Export everything as Markdown
              </button>
              <button
                onClick={onExportCurrent}
                disabled={!canExportCurrent}
                className="cursor-pointer rounded-[5px] px-2 py-1 text-left text-[12px] hover:bg-item-hover disabled:cursor-default disabled:text-faint disabled:hover:bg-transparent pointer-coarse:min-h-11"
              >
                Export this one as Markdown
              </button>
              {/* Nib Plus, and only in the app, where Plus is sold. Without it
                  the formats are still shown, and lead to Billing. */}
              {nativeApp && (
                <div className={`px-2 py-1 text-[12px] ${canExportCurrent ? '' : 'text-faint'}`}>
                  <div className="flex items-center justify-between">
                    <span>Export this one as</span>
                    {!plus && <span className="text-[10.5px] text-faint">Plus</span>}
                  </div>
                  <div className="mt-1 flex gap-1.5">
                    {RICH_FORMATS.map((format) => (
                      <button
                        key={format}
                        onClick={() => (plus ? onExportCurrentAs(format) : setView('billing'))}
                        disabled={!canExportCurrent}
                        className="nib-tap cursor-pointer rounded-[5px] border border-line px-2 py-0.5 text-[11.5px] hover:bg-item-hover disabled:cursor-default disabled:hover:bg-transparent"
                      >
                        {FORMAT_NAMES[format]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* Only in the app. Which documents are checked is chosen in the
                  palette; which rules run is chosen here. Without Plus it counts. */}
              {nativeApp && (
                <div className="px-2 py-1 text-[12px]">
                  <div>Style check</div>
                  <div className="mt-1 flex flex-col gap-0.5">
                    {RULES.map((rule) => (
                      <label key={rule.id} className="flex cursor-pointer items-center gap-2 text-[11.5px] text-muted pointer-coarse:min-h-11">
                        <input type="checkbox" checked={rulesOn().has(rule.id)} onChange={(event) => setRule(rule.id, event.target.checked)} />
                        {rule.label}
                      </label>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] leading-[1.5] text-faint">
                    Checked on this device. Turn it on for a document from the palette.
                    {!plus && ' It counts what it finds; Nib Plus underlines each one.'}
                  </p>
                </div>
              )}
              <button
                onClick={onBackup}
                className="cursor-pointer rounded-[5px] px-2 py-1 text-left text-[12px] hover:bg-item-hover pointer-coarse:min-h-11"
              >
                Download a full backup
              </button>

              <label className="flex cursor-pointer flex-col justify-center rounded-[5px] px-2 py-1 text-[12px] hover:bg-item-hover focus-within:bg-item-hover pointer-coarse:min-h-11">
                Import notes…
                <span className="block text-[10.5px] text-faint">Markdown, a Word document, a Fountain or Final Draft screenplay, or an export from Simplenote, Bear, Evernote, Notesnook, Obsidian, Apple Notes, Google Keep, Joplin, UpNote, Zoho Notebook, FuseBase or ColorNote</span>
                <input
                  type="file"
                  accept={IMPORT_ACCEPT}
                  multiple
                  className="sr-only"
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? [])
                    if (files.length) onImport(files)
                    event.target.value = ''
                  }}
                />
              </label>

              <label className="flex cursor-pointer flex-col justify-center rounded-[5px] px-2 py-1 text-[12px] hover:bg-item-hover focus-within:bg-item-hover pointer-coarse:min-h-11">
                Restore from a backup…
                <input
                  type="file"
                  accept=".json,application/json"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (!file) return
                    if (
                      !confirm(
                        'This replaces every note, page, and version stored on this device. This cannot be undone.',
                      )
                    ) {
                      return
                    }
                    void Promise.resolve(onRestore(file)).then((restored) => restored && setOpen(false))
                  }}
                />
              </label>

              <p className="mt-1 px-2 text-[11px] leading-[1.5] text-muted">
                Each Markdown file becomes one document, and each Word document
                one page, its comments notes to self. A Nib export is unpacked
                back into the notes and pages it came from. A backup keeps ids,
                pins, trash, and history, and each picture as its note has it.
                Full-quality originals and attached files, kept with Nib Plus,
                aren’t in it: they stay on this device, and are in the device’s
                own backups.
              </p>
              <FilesLine
                sync={sync}
                onAttachments={
                  onAttachments &&
                  (() => {
                    setOpen(false)
                    onAttachments()
                  })
                }
              />
            </div>
          )}

          <div className="mt-3 flex items-center justify-between border-t border-line pt-2 text-[10.5px] text-faint">
            <span>Nib {__APP_VERSION__}</span>
            <button onClick={() => setView('acknowledgements')} className="nib-tap cursor-pointer hover:text-ink pointer-coarse:min-h-11">
              Acknowledgements ›
            </button>
          </div>
        </div>
      )}
    </>
  )

  return open ? <Screen onClose={() => setOpen(false)}>{views}</Screen> : null
}

/**
 * The room full-quality pictures and attachments take: on this device
 * (lib/files), and, with sync on and the server in reach, of what they may
 * take there. Asked when Advanced is opened, and nothing said where there are
 * none. With it, the way to the list of what's attached.
 */
function FilesLine({ sync, onAttachments }: { sync: Sync; onAttachments?: () => void }) {
  const [here, setHere] = useState(0)
  const [there, setThere] = useState<{ bytes: number; limit: number } | null>(null)
  const { filesRoom } = sync
  useEffect(() => {
    let live = true
    void listFiles()
      .then((files) => live && setHere(files.reduce((sum, file) => sum + file.size, 0)))
      // Not counted: nothing is said of it.
      .catch(() => {})
    void filesRoom().then((room) => live && setThere(room))
    return () => {
      live = false
    }
  }, [filesRoom])
  if (!here && !there?.bytes) return null
  return (
    <p className="mt-1 px-2 text-[11px] leading-[1.5] text-muted">
      Full-quality pictures and attachments take {here ? sizeText(here) : 'no room'} on this device{there ? `, and ${sizeText(there.bytes)} of the ${sizeText(there.limit)} they may on Nib’s server` : ''}.
      {onAttachments && (
        <>
          {' '}
          <button type="button" onClick={onAttachments} className="cursor-pointer underline hover:text-ink">
            See attachments
          </button>
        </>
      )}
    </p>
  )
}

/** The writing buddy (lib/buddy), on or off, on this device. */
function BuddyRow() {
  const on = useBuddy()
  return (
    <div className="mt-1.5 flex items-center gap-2 rounded-md border border-line px-2 py-1.5">
      <span className="flex-1">
        <span className="block text-[12px] font-medium">Inkwell</span>
        <span className="block text-[11px] leading-[1.4] text-muted">A nib in the corner to ask about Nib and about writing. On this device.</span>
      </span>
      <button
        role="switch"
        aria-checked={on}
        aria-label="Inkwell"
        onClick={() => setBuddy(!on)}
        className={`nib-tap relative h-[18px] w-[30px] shrink-0 cursor-pointer rounded-full transition-colors ${on ? 'bg-ink' : 'bg-line'}`}
      >
        <span aria-hidden className={`absolute top-[2px] left-0 size-[14px] rounded-full bg-paper transition-transform ${on ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
      </button>
    </div>
  )
}

function CountsRow() {
  const [on, setOn] = useState(() => countsAnswer() === 'yes')
  return (
    <div className="mt-1.5 flex items-center gap-2 rounded-md border border-line px-2 py-1.5">
      <span className="flex-1">
        <span className="block text-[12px] font-medium">Usage counts</span>
        <span className="block text-[11px] leading-[1.4] text-muted">Daily totals of which features get used. Never your writing, and nothing that says who you are or which device it came from.</span>
      </span>
      <button
        role="switch"
        aria-checked={on}
        aria-label="Usage counts"
        onClick={() => {
          setCountsAnswer(!on)
          setOn(!on)
        }}
        className={`nib-tap relative h-[18px] w-[30px] shrink-0 cursor-pointer rounded-full transition-colors ${on ? 'bg-ink' : 'bg-line'}`}
      >
        <span aria-hidden className={`absolute top-[2px] left-0 size-[14px] rounded-full bg-paper transition-transform ${on ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
      </button>
    </div>
  )
}

/**
 * "Lock Nib". Read each time the panel opens rather than once: the passcode
 * can be removed in iOS Settings while Nib sits in the background. Under it
 * on an iPhone or iPad, Privacy mode: Nib covered in the app switcher, with
 * the lock or without, and while the screen is recorded, mirrored or shared.
 */
function LockRow() {
  const [status, setStatus] = useState<LockStatus | null>(null)

  useEffect(() => {
    let live = true
    lock
      .status()
      .then((next) => live && setStatus(next))
      .catch((error: unknown) => console.warn('Nib: could not read the lock setting', error))
    return () => {
      live = false
    }
  }, [])

  if (!status) return null
  const change = (enabled: boolean, after = status.after) =>
    lock
      .set({ enabled, after })
      .then(setStatus)
      // Cancelled at the Face ID or passcode sheet: the setting stays as it was.
      .catch(() => {})

  const offersPrivacy = status.device !== 'Mac' && status.privacy !== undefined
  return (
    <>
      <div className="mt-1.5 rounded-md border border-line px-2 py-1.5">
        <div className="flex items-center gap-2">
          <span className="flex-1">
            <span className="block text-[12px] font-medium">Lock Nib</span>
            <span className="block text-[11px] leading-[1.4] text-muted">
              {status.available ? describeUnlock(status) : unavailableReason(status)}
            </span>
          </span>
          <button
            role="switch"
            aria-checked={status.enabled}
            aria-label="Lock Nib"
            disabled={!status.available}
            onClick={() => void change(!status.enabled)}
            className={`nib-tap relative h-[18px] w-[30px] shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-default disabled:opacity-40 ${
              status.enabled ? 'bg-ink' : 'bg-line'
            }`}
          >
            <span
              aria-hidden
              className={`absolute top-[2px] left-0 size-[14px] rounded-full bg-paper transition-transform ${
                status.enabled ? 'translate-x-[14px]' : 'translate-x-[2px]'
              }`}
            />
          </button>
        </div>
        {status.enabled && (
          <label className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted">
            <span>Locks</span>
            <select
              value={status.after}
              onChange={(event) => void change(true, Number(event.target.value))}
              aria-label="When Nib locks"
              className="cursor-pointer bg-transparent text-right text-[11px] text-ink outline-none pointer-coarse:text-[16px]"
            >
              {LOCK_AFTER.map(([seconds, label]) => (
                <option key={seconds} value={seconds}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {offersPrivacy && (
        <div className="mt-1.5 flex items-center gap-2 rounded-md border border-line px-2 py-1.5">
          <span className="flex-1">
            <span className="block text-[12px] font-medium">Privacy mode</span>
            <span className="block text-[11px] leading-[1.4] text-muted">Covers Nib in the app switcher, and while the screen is being recorded or shared. iOS doesn’t let an app stop a screenshot.</span>
          </span>
          <button
            role="switch"
            aria-checked={status.privacy}
            aria-label="Privacy mode"
            onClick={() =>
              void lock
                .privacy({ on: !status.privacy })
                .then(setStatus)
                .catch((error: unknown) => console.warn('Nib: could not change privacy mode', error))
            }
            className={`nib-tap relative h-[18px] w-[30px] shrink-0 cursor-pointer rounded-full transition-colors ${status.privacy ? 'bg-ink' : 'bg-line'}`}
          >
            <span aria-hidden className={`absolute top-[2px] left-0 size-[14px] rounded-full bg-paper transition-transform ${status.privacy ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
          </button>
        </div>
      )}
    </>
  )
}

/**
 * "Open Nib at login", on the Mac. macOS keeps its own list of what opens at
 * login and the writer can change it there, so it's read each time the panel
 * opens, and what macOS answers to a change is what's shown.
 */
function LoginRow() {
  const [item, setItem] = useState<LoginItem | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    nibWindow
      .login()
      .then((next) => live && setItem(next))
      .catch((error: unknown) => console.warn('Nib: could not read the login item', error))
    return () => {
      live = false
    }
  }, [])

  if (!item?.available) return null
  const wanted = item.on || item.approval
  return (
    <div className="mt-1.5 flex items-center gap-2 rounded-md border border-line px-2 py-1.5">
      <span className="flex-1">
        <span className="block text-[12px] font-medium">Open Nib at login</span>
        <span className="block text-[11px] leading-[1.4] text-muted">
          {failed
            ? 'macOS didn’t take the change. Try it under Login Items in System Settings.'
            : item.approval
              ? 'Turned off in System Settings. Allow Nib under General → Login Items there.'
              : 'When you log in to this Mac.'}
        </span>
      </span>
      <button
        role="switch"
        aria-checked={wanted}
        aria-label="Open Nib at login"
        onClick={() => {
          setFailed(false)
          nibWindow
            .setLogin({ on: !wanted })
            .then(setItem)
            .catch(() => setFailed(true))
        }}
        className={`nib-tap relative h-[18px] w-[30px] shrink-0 cursor-pointer rounded-full transition-colors ${wanted ? 'bg-ink' : 'bg-line'}`}
      >
        <span aria-hidden className={`absolute top-[2px] left-0 size-[14px] rounded-full bg-paper transition-transform ${wanted ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
      </button>
    </div>
  )
}

/** The notices of the open-source software Nib is built with: the file the build writes beside the app (scripts/licences). */
function Acknowledgements({ onBack }: { onBack: () => void }) {
  const [text, setText] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    fetch('/licences.txt')
      .then((response) => (response.ok && response.headers.get('content-type')?.startsWith('text/plain') ? response.text() : Promise.reject(new Error(`${response.status}`))))
      .then((next) => live && setText(next))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [])

  return (
    <>
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="nib-tap cursor-pointer text-[11px] text-muted hover:text-ink">
          ← Back
        </button>
        <span className="text-[11px] text-faint">Acknowledgements</span>
      </div>
      <pre className="mt-3 font-mono text-[10.5px] leading-[1.5] break-words whitespace-pre-wrap text-muted">
        {failed ? 'This copy of Nib was built without its notices.' : (text ?? 'Loading…')}
      </pre>
    </>
  )
}

/** Settings is a screen of its own: a sheet over the window, the whole screen on a phone. */
function Screen({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <Sheet
      label="Settings"
      onClose={onClose}
      overlay="z-50 flex items-center justify-center bg-black/30 phone:items-stretch"
      focusOnTouch
      className="nib-pop flex max-h-[min(760px,calc(100dvh-4rem))] w-[min(460px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-line bg-paper shadow-[0_30px_80px_rgba(10,20,40,0.25)] phone:max-h-none phone:w-full phone:rounded-none phone:border-0 phone:pt-[env(safe-area-inset-top)] phone:pr-[env(safe-area-inset-right)] phone:pb-[env(safe-area-inset-bottom)] phone:pl-[env(safe-area-inset-left)]"
    >
      <div className="flex shrink-0 items-center justify-between border-b border-line px-4 py-2.5">
        <h2 className="text-[15px] font-semibold">Settings</h2>
        <button onClick={onClose} className="nib-tap cursor-pointer text-[13px] font-medium text-muted hover:text-ink">
          Done
        </button>
      </div>
      <div className="overflow-y-auto overscroll-contain">{children}</div>
    </Sheet>
  )
}
