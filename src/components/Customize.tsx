import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import {
  ACCENTS,
  DEFAULT_LOOK,
  HIGHLIGHTS,
  KEYBOARD_MAX,
  KEYBOARD_TOOLS,
  SAVED_MAX,
  TOOLBAR_MAX,
  TOOLBAR_TOOLS,
  deleteSavedLook,
  resetLook,
  saveLook,
  setLook,
  useChosenLook,
  useLook,
  useSavedLooks,
  type Accent,
  type Highlight,
  type Look,
  type SavedLook,
} from '../lib/look'
import { download } from '../lib/download'
import { DEFAULT_OWN, OWN_EXTRAS, OWN_MIN, palette, readable, type OwnColors } from '../lib/ownTheme'
import { saidAs, sameName } from '../lib/folders'
import { DEFAULT_START, setStart, useStart, type Start } from '../lib/startAt'
import { readThemeFile, THEME_FILE_MAX, THEME_FILE_NAME, themeFile } from '../lib/themeFile'
import { nibWindow } from '../lib/keyboard'
import { touchApp } from '../lib/platform'
import { isTheme, themeLabel, type Theme } from '../lib/theme'
import ink from '../assets/icons/ink.png'
import paperIcon from '../assets/icons/paper.png'
import blue from '../assets/icons/blue.png'
import green from '../assets/icons/green.png'
import rose from '../assets/icons/rose.png'
import vellumIcon from '../assets/icons/vellum.png'
import sageIcon from '../assets/icons/sage.png'
import lilacIcon from '../assets/icons/lilac.png'
import emberIcon from '../assets/icons/ember.png'
import tideIcon from '../assets/icons/tide.png'
import merlotIcon from '../assets/icons/merlot.png'
import nibPlusIcon from '../assets/icons/nib-plus.png'
import inkwellIcon from '../assets/icons/inkwell.png'

/** The home-screen icons (ios Assets.xcassets): the standard one, and each alternate by its asset name. */
const ICONS = [
  { name: undefined, label: 'Ink', src: ink },
  { name: 'AppIcon-Paper', label: 'Paper', src: paperIcon },
  { name: 'AppIcon-Blue', label: 'Blue', src: blue },
  { name: 'AppIcon-Green', label: 'Green', src: green },
  { name: 'AppIcon-Rose', label: 'Rose', src: rose },
  { name: 'AppIcon-Vellum', label: 'Vellum', src: vellumIcon },
  { name: 'AppIcon-Sage', label: 'Sage', src: sageIcon },
  { name: 'AppIcon-Lilac', label: 'Lilac', src: lilacIcon },
  { name: 'AppIcon-Ember', label: 'Ember', src: emberIcon },
  { name: 'AppIcon-Tide', label: 'Tide', src: tideIcon },
  { name: 'AppIcon-Merlot', label: 'Merlot', src: merlotIcon },
  { name: 'AppIcon-NibPlus', label: 'Nib Plus', src: nibPlusIcon },
  { name: 'AppIcon-Inkwell', label: 'Inkwell', src: inkwellIcon },
]

/**
 * Settings → Customize (lib/look). Everything starts as Nib always looked. The
 * locked half is Nib Plus: without it, choosing one leads to Billing, and what
 * shows selected is what is drawn.
 */
export function Customize({
  plus,
  theme,
  onThemeChange,
  folders = [],
  onOpenBilling,
  onBack,
}: {
  plus: boolean
  theme: Theme
  onThemeChange: (theme: Theme) => void
  /** Every folder, by its whole name (lib/folders). */
  folders?: string[]
  onOpenBilling: () => void
  onBack: () => void
}) {
  const look = useLook()
  const chosen = useChosenLook()
  const [page, setPage] = useState<'main' | 'toolbars' | 'saved'>('main')
  const plusOnly = (change: Partial<Look>) => (plus ? setLook(change) : onOpenBilling())
  // Where Nib opens (lib/startAt): without Plus, as it always did, whatever was chosen with it.
  const chosenStart = useStart()
  const start = plus ? chosenStart : DEFAULT_START
  const startAt = (change: Partial<Start>) => (plus ? setStart(change) : onOpenBilling())

  if (page === 'saved') {
    return (
      <div key="saved" className="nib-swap">
        <Header title="Saved looks" back="Customize" onBack={() => setPage('main')} />
        <SavedLooks
          theme={theme}
          onUse={(saved) => {
            setLook(saved.look)
            if (isTheme(saved.theme)) onThemeChange(saved.theme)
          }}
        />
      </div>
    )
  }

  if (page === 'toolbars') {
    return (
      <div key="toolbars" className="nib-swap">
        <Header title="Toolbar buttons" back="Customize" onBack={() => setPage('main')} />
        <Tools
          title="Selection toolbar"
          pool={TOOLBAR_TOOLS}
          max={TOOLBAR_MAX}
          chosen={look.toolbar}
          onChange={(toolbar) => setLook({ toolbar })}
        />
        <p className="mt-1 text-[11px] leading-[1.5] text-faint">The rest are under its ••• button.</p>
        {touchApp && (
          <Tools
            title="Above the keyboard"
            pool={KEYBOARD_TOOLS}
            max={KEYBOARD_MAX}
            chosen={look.keyboardBar}
            onChange={(keyboardBar) => setLook({ keyboardBar })}
          />
        )}
        <button
          onClick={() => setLook({ toolbar: DEFAULT_LOOK.toolbar, keyboardBar: DEFAULT_LOOK.keyboardBar })}
          className="nib-tap mt-3 cursor-pointer text-[11px] text-muted hover:text-ink"
        >
          Put the buttons back
        </button>
      </div>
    )
  }

  return (
    <div key="customize" className="nib-swap">
      <Header title="Customize" back="Back" onBack={onBack} />
      {!plus && <p className="mt-2 text-[11px] leading-[1.5] text-muted">The ones with a lock are Nib Plus.</p>}

      <Section title="Text">
        <Choice
          label="Size"
          value={look.size}
          onChange={(size) => setLook({ size })}
          options={[
            ['small', 'Small', 'A', { fontSize: 10 }],
            ['standard', 'Standard', 'A', { fontSize: 12 }],
            ['large', 'Large', 'A', { fontSize: 14 }],
            ['larger', 'Larger', 'A', { fontSize: 16 }],
          ]}
        />
        <Choice
          label="Width"
          value={look.width}
          onChange={(width) => setLook({ width })}
          options={[
            ['narrow', 'Narrow'],
            ['standard', 'Standard'],
            ['wide', 'Wide'],
          ]}
        />
        <Choice
          label="Line spacing"
          value={look.spacing}
          onChange={(spacing) => setLook({ spacing })}
          options={[
            ['tight', 'Tight'],
            ['standard', 'Standard'],
            ['airy', 'Airy'],
          ]}
        />
        <Choice
          label="Notes in"
          locked={!plus}
          value={look.notesFont}
          onChange={(notesFont) => plusOnly({ notesFont })}
          options={[
            ['mono', 'Mono', undefined, { fontFamily: 'var(--font-mono)' }],
            ['sans', 'Sans', undefined, { fontFamily: 'var(--font-sans)' }],
            ['serif', 'Serif', undefined, { fontFamily: 'var(--nib-serif)' }],
          ]}
        />
        <Choice
          label="Pages in"
          locked={!plus}
          value={look.pagesFont}
          onChange={(pagesFont) => plusOnly({ pagesFont })}
          options={[
            ['sans', 'Sans', undefined, { fontFamily: 'var(--font-sans)' }],
            ['serif', 'Serif', undefined, { fontFamily: 'var(--nib-serif)' }],
            ['mono', 'Mono', undefined, { fontFamily: 'var(--font-mono)' }],
          ]}
        />
        <Choice
          label="Paragraphs on pages"
          locked={!plus}
          value={look.paragraphs}
          onChange={(paragraphs) => plusOnly({ paragraphs })}
          options={[
            ['lines', 'Lines'],
            ['spaced', 'Spaced'],
            ['indented', 'Indented'],
          ]}
        />
        <Choice
          label="Page edges"
          locked={!plus}
          value={look.align}
          onChange={(align) => plusOnly({ align })}
          options={[
            ['ragged', 'Ragged'],
            ['justified', 'Justified'],
          ]}
        />
      </Section>

      <Section title="Motion">
        <Choice
          label="Motion"
          hideLabel
          value={look.motion}
          onChange={(motion) => setLook({ motion })}
          options={[
            ['full', 'Full'],
            ['less', 'Less'],
            ['none', 'None'],
          ]}
        />
      </Section>

      <Section title="Writing" locked={!plus}>
        <div className="mt-1 flex flex-col gap-0.5">
          {(
            [
              ['typewriter', 'Keep the line I’m writing mid-screen, always'],
              ['dim', 'In focus mode, fade all but the paragraph I’m in'],
            ] as const
          ).map(([part, label]) => (
            <label key={part} className="flex cursor-pointer items-start gap-2 py-0.5 text-[11.5px] leading-[1.4] text-ink pointer-coarse:py-1.5">
              <input type="checkbox" className="mt-px" checked={look[part]} onChange={(event) => plusOnly({ [part]: event.target.checked })} />
              {label}
            </label>
          ))}
        </div>
      </Section>

      <Section title="Show">
        <div className="mt-1 flex flex-col gap-0.5">
          {(
            [
              ['wordCount', 'Word count'],
              ['outline', 'Outline beside pages'],
              ['linkedFrom', 'Linked from'],
            ] as const
          ).map(([part, label]) => (
            <label key={part} className="flex cursor-pointer items-center gap-2 py-0.5 text-[11.5px] text-ink pointer-coarse:py-1.5">
              <input type="checkbox" checked={look[part]} onChange={(event) => setLook({ [part]: event.target.checked })} />
              {label}
            </label>
          ))}
        </div>
      </Section>

      <Section title="When Nib opens" locked={!plus}>
        <Choice
          label="Nib opens on"
          hideLabel
          value={start.on}
          onChange={(on) => startAt({ on })}
          options={[
            ['notes', 'Notes'],
            ['pages', 'Pages'],
            ['last', 'Where I left off'],
          ]}
        />
        <FolderChoice label="Showing" none="Everything" folders={folders} value={start.folder} onChange={(folder) => startAt({ folder })} />
        <FolderChoice label="New notes and pages go in" none="No folder" folders={folders} value={start.newIn} onChange={(newIn) => startAt({ newIn })} />
      </Section>

      <Section title="Accent" locked={!plus}>
        <div role="radiogroup" aria-label="Accent" className="mt-1.5 flex flex-wrap gap-2">
          <Swatch label="The theme’s own" checked={look.accent === 'theme'} onClick={() => plusOnly({ accent: 'theme' })} />
          {(Object.keys(ACCENTS) as Accent[]).map((accent) => (
            <Swatch
              key={accent}
              label={ACCENTS[accent].label}
              checked={look.accent === accent}
              colors={ACCENTS[accent]}
              onClick={() => plusOnly({ accent })}
            />
          ))}
        </div>
      </Section>

      <Section title="Highlight" locked={!plus}>
        <div role="radiogroup" aria-label="Highlight" className="mt-1.5 flex flex-wrap gap-2">
          <Swatch label="The theme’s own" checked={look.highlight === 'theme'} onClick={() => plusOnly({ highlight: 'theme' })} />
          {(Object.keys(HIGHLIGHTS) as Highlight[]).map((highlight) => (
            <Swatch
              key={highlight}
              label={HIGHLIGHTS[highlight].label}
              checked={look.highlight === highlight}
              colors={HIGHLIGHTS[highlight]}
              onClick={() => plusOnly({ highlight })}
            />
          ))}
        </div>
      </Section>

      <Section title="Your own theme" locked={!plus}>
        {plus ? (
          <OwnTheme inUse={theme === 'custom'} onUse={() => onThemeChange('custom')} />
        ) : (
          <button onClick={onOpenBilling} className="nib-tap mt-1 cursor-pointer text-[11.5px] text-muted hover:text-ink">
            Choose your page, text and accent, or install a theme ›
          </button>
        )}
      </Section>

      {/* iPhone and iPad only: the Mac keeps one icon. */}
      {touchApp && (
        <Section title="App icon" locked={!plus}>
          <AppIcon plus={plus} onOpenBilling={onOpenBilling} />
        </Section>
      )}

      <button
        onClick={() => (plus ? setPage('toolbars') : onOpenBilling())}
        className="nib-tap mt-4 flex w-full cursor-pointer items-center gap-2 rounded-md border border-line px-2 py-1.5 text-left hover:bg-item-hover"
      >
        <span className="flex-1 text-[12px] font-medium">Toolbar buttons</span>
        {!plus && <Lock />}
        <span className="text-[11px] text-muted">›</span>
      </button>
      <button
        onClick={() => (plus ? setPage('saved') : onOpenBilling())}
        className="nib-tap mt-1.5 flex w-full cursor-pointer items-center gap-2 rounded-md border border-line px-2 py-1.5 text-left hover:bg-item-hover"
      >
        <span className="flex-1 text-[12px] font-medium">Saved looks</span>
        {!plus && <Lock />}
        <span className="text-[11px] text-muted">›</span>
      </button>

      <button
        onClick={resetLook}
        disabled={JSON.stringify(chosen) === JSON.stringify(DEFAULT_LOOK)}
        className="nib-tap mt-3 cursor-pointer text-[11px] text-muted hover:text-ink disabled:cursor-default disabled:text-faint"
      >
        Reset to default
      </button>
    </div>
  )
}

/**
 * The page, text and accent of one's own theme (lib/ownTheme), and under
 * them the two that are worked out unless chosen: the library's background
 * and the highlight. A pair that wouldn't read is shown, and said so, but not
 * kept: the theme stays as it last read until it reads again. The theme as
 * it's kept can be saved as a file (lib/themeFile), and one installed from a
 * file in its place.
 */
function OwnTheme({ inUse, onUse }: { inUse: boolean; onUse: () => void }) {
  const kept = useChosenLook().ownTheme
  const [draft, setDraft] = useState(kept)
  const [said, setSaid] = useState<string | null>(null)
  const save = () => {
    setSaid(null)
    download(themeFile(kept), THEME_FILE_NAME, 'application/json').catch(() => setSaid('Couldn’t save the file.'))
  }
  async function install(file: File) {
    setSaid(null)
    const colors = file.size > THEME_FILE_MAX ? 'not-a-theme' : readThemeFile(await file.text())
    if (colors === 'not-a-theme') return setSaid('That isn’t a Nib theme file.')
    if (colors === 'unreadable') return setSaid('That theme’s text wouldn’t read on its colours, so it isn’t installed.')
    // A theme made here goes when another is installed over it; the one Nib starts with is nothing to lose.
    const mine = themeFile(kept)
    if (mine !== themeFile(DEFAULT_OWN) && mine !== themeFile(colors) && !confirm('Replace your own theme’s colours with this file’s?')) return
    setDraft(colors)
    setLook({ ownTheme: colors })
    setSaid('Installed.')
  }
  const check = readable(draft)
  /** `value` undefined: worked out again, for the two that can be. */
  const change = (part: keyof OwnColors, value: string | undefined) => {
    const next = { ...draft, [part]: value } as OwnColors
    setDraft(next)
    if (readable(next).ok) setLook({ ownTheme: next })
  }
  // What each comes to, chosen or worked out.
  const worked = palette(draft).vars
  const unread = (
    [
      [check.ink, 'The text', ` on this page, and needs ${OWN_MIN}:1.`],
      [check.accent, 'The accent', `, and links need ${OWN_MIN}:1.`],
      [check.shell, 'The text', ` on the library, and needs ${OWN_MIN}:1.`],
      [check.highlight, 'The text', ` on the highlight, and needs ${OWN_MIN}:1.`],
    ] as const
  ).find(([reads]) => reads !== undefined && reads < OWN_MIN)

  return (
    <>
      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        {(
          [
            ['paper', 'Page'],
            ['ink', 'Text'],
            ['accent', 'Accent'],
          ] as const
        ).map(([part, label]) => (
          <label key={part} className="flex cursor-pointer flex-col items-center gap-1 text-[11px] text-muted">
            <input
              type="color"
              aria-label={`${label} colour`}
              value={draft[part]}
              onChange={(event) => change(part, event.target.value)}
              className="h-7 w-full cursor-pointer rounded-md border border-line bg-transparent p-0.5 pointer-coarse:h-11"
            />
            {label}
          </label>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        {OWN_EXTRAS.map(([part, label]) => (
          <div key={part} className="flex flex-col items-center gap-1 text-[11px] text-muted">
            <input
              type="color"
              aria-label={`${label} colour`}
              value={worked[part]}
              onChange={(event) => change(part, event.target.value)}
              className="h-7 w-full cursor-pointer rounded-md border border-line bg-transparent p-0.5 pointer-coarse:h-11"
            />
            {draft[part] === undefined ? (
              `${label} · worked out`
            ) : (
              <span>
                {label} ·{' '}
                <button onClick={() => change(part, undefined)} aria-label={`Work out the ${label.toLowerCase()} colour`} className="nib-tap cursor-pointer text-ink">
                  Work it out
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1.5 rounded-md border border-line p-1.5" style={{ background: worked.shell }}>
        <div className="rounded px-2 py-1.5 text-[12px]" style={{ background: draft.paper, color: draft.ink }}>
          Your words, <span style={{ color: draft.accent, textDecoration: 'underline' }}>a link</span>, and <span style={{ background: worked.highlight }}>a highlight</span>.
        </div>
      </div>
      {unread && (
        <p role="status" className="mt-1.5 text-[11px] leading-[1.5] text-ink">
          {unread[1]} would read at {unread[0]!.toFixed(1)}:1{unread[2]} Nothing changes until it reads.
        </p>
      )}
      {inUse ? (
        <p className="mt-1.5 text-[11px] text-muted">In use</p>
      ) : (
        <button onClick={onUse} className="nib-tap mt-1.5 cursor-pointer text-[11px] font-medium text-ink">
          Use it
        </button>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
        <button onClick={save} className="nib-tap cursor-pointer hover:text-ink pointer-coarse:min-h-11">
          Save as a file
        </button>
        <label className="nib-tap flex cursor-pointer items-center hover:text-ink focus-within:text-ink pointer-coarse:min-h-11">
          Install from a file…
          <input
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void install(file)
            }}
          />
        </label>
      </div>
      {said && (
        <p aria-live="polite" className="mt-1 text-[11px] leading-[1.5] text-ink">
          {said}
        </p>
      )}
    </>
  )
}

/**
 * The icon on the home screen, read from iOS each time, since it is iOS's
 * to keep. It stays as chosen if Plus ends: changing it back would bring up
 * iOS's alert unasked.
 */
function AppIcon({ plus, onOpenBilling }: { plus: boolean; onOpenBilling: () => void }) {
  const [current, setCurrent] = useState<string | undefined | null>(null)
  useEffect(() => {
    nibWindow
      .icon()
      .then(({ name }) => setCurrent(name))
      .catch(() => {})
  }, [])

  return (
    <div role="radiogroup" aria-label="App icon" className="mt-1.5 flex flex-wrap gap-2">
      {ICONS.map((icon) => (
        <button
          key={icon.label}
          role="radio"
          aria-checked={current !== null && current === icon.name}
          aria-label={icon.label}
          onClick={() => {
            if (!plus) return onOpenBilling()
            nibWindow
              .setIcon({ name: icon.name })
              .then(() => setCurrent(icon.name))
              .catch((error: unknown) => console.warn('Nib: could not change the icon', error))
          }}
          className={`size-10 shrink-0 cursor-pointer overflow-hidden rounded-[9px] ${current === icon.name ? 'outline-2 outline-offset-2 outline-ink' : ''}`}
        >
          <img src={icon.src} alt="" className="size-full" />
        </button>
      ))}
    </div>
  )
}

/** Each saved look, to use or delete, and a name to save this one under. */
function SavedLooks({ theme, onUse }: { theme: Theme; onUse: (saved: SavedLook) => void }) {
  const saved = useSavedLooks()
  const chosen = useChosenLook()
  const [name, setName] = useState('')
  const replacing = saved.some((entry) => entry.name === name.trim())
  const full = saved.length >= SAVED_MAX && !replacing

  return (
    <>
      {saved.length === 0 && (
        <p className="mt-3 text-[11px] leading-[1.5] text-muted">Save how Nib looks now, its theme too, to come back to it in one tap.</p>
      )}
      <ul className="mt-2 flex flex-col">
        {saved.map((entry) => (
          <li key={entry.name} className="flex items-center gap-2 py-1 text-[12px] pointer-coarse:py-2">
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            <span className="shrink-0 text-[10.5px] text-faint">{isTheme(entry.theme) ? themeLabel(entry.theme) : ''}</span>
            {entry.theme === theme && JSON.stringify(entry.look) === JSON.stringify(chosen) ? (
              <span className="text-[11px] text-muted">In use</span>
            ) : (
              <button onClick={() => onUse(entry)} className="cursor-pointer text-[11px] font-medium text-ink pointer-coarse:px-2">
                Use
              </button>
            )}
            <button aria-label={`Delete ${entry.name}`} onClick={() => deleteSavedLook(entry.name)} className="cursor-pointer text-[11px] text-muted hover:text-ink pointer-coarse:px-2">
              ×
            </button>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          saveLook(name, theme)
          setName('')
        }}
        className="mt-3 flex items-center gap-2"
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label="Name this look"
          placeholder="Name this look"
          maxLength={40}
          className="min-w-0 flex-1 rounded-[4px] border border-line bg-transparent px-1.5 py-0.5 text-[11.5px] outline-none placeholder:text-faint pointer-coarse:py-1.5 pointer-coarse:text-[16px]"
        />
        <button type="submit" disabled={!name.trim() || full} className="nib-tap cursor-pointer text-[11px] font-medium text-ink disabled:cursor-default disabled:text-faint">
          {replacing ? 'Replace' : 'Save'}
        </button>
      </form>
      {full && <p className="mt-1 text-[11px] leading-[1.5] text-faint">Eight is the most. Delete one to save another.</p>}
    </>
  )
}

function Header({ title, back, onBack }: { title: string; back: string; onBack: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <button onClick={onBack} className="nib-tap cursor-pointer text-[11px] text-muted hover:text-ink">
        ← {back}
      </button>
      <span className="text-[11px] text-faint">{title}</span>
    </div>
  )
}

function Section({ title, locked, children }: { title: string; locked?: boolean; children: ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="flex items-center gap-1.5 text-[11px] text-muted">
        {title}
        {locked && <Lock />}
      </h3>
      {children}
    </section>
  )
}

/** Its options are [value, name, what the button shows if not the name, how it shows it]. */
function Choice<T extends string>({
  label,
  hideLabel,
  locked,
  value,
  onChange,
  options,
}: {
  label: string
  hideLabel?: boolean
  locked?: boolean
  value: T
  onChange: (value: T) => void
  options: [T, string, string?, CSSProperties?][]
}) {
  return (
    <div className="mt-1.5">
      {!hideLabel && (
        <div className="flex items-center gap-1.5 text-[11px] text-faint">
          {label}
          {locked && <Lock />}
        </div>
      )}
      <div role="radiogroup" aria-label={label} className="mt-1 flex gap-px rounded-md border border-line p-px">
        {options.map(([option, name, shown, style]) => (
          <button
            key={option}
            role="radio"
            aria-checked={option === value}
            aria-label={shown ? name : undefined}
            onClick={() => onChange(option)}
            style={style}
            className={`flex-1 cursor-pointer rounded-[4px] py-1 text-[11px] leading-[1.4] transition-colors pointer-coarse:py-2 ${
              option === value ? 'bg-item-active font-medium text-ink' : 'text-muted hover:text-ink'
            }`}
          >
            {shown ?? name}
          </button>
        ))}
      </div>
    </div>
  )
}

/** One folder or none. A folder chosen that has since gone shows as none, as it then counts for nothing (lib/useStartAt, lib/folders filing). */
function FolderChoice({ label, none, folders, value, onChange }: { label: string; none: string; folders: string[]; value: string | null; onChange: (folder: string | null) => void }) {
  return (
    <label className="mt-1.5 flex items-center justify-between gap-2 text-[11.5px] text-ink pointer-coarse:min-h-11">
      {label}
      <select
        value={folders.find((folder) => value !== null && sameName(folder, value)) ?? ''}
        onChange={(event) => onChange(event.target.value || null)}
        className="min-w-0 max-w-[55%] cursor-pointer bg-transparent text-right text-[11.5px] text-ink outline-none pointer-coarse:text-[16px]"
      >
        <option value="">{none}</option>
        {folders.map((folder) => (
          <option key={folder} value={folder}>
            {saidAs(folder)}
          </option>
        ))}
      </select>
    </label>
  )
}

/** An accent, in the shade it takes on this page: its light one, or its dark. */
function Swatch({
  label,
  checked,
  colors,
  onClick,
}: {
  label: string
  checked: boolean
  colors?: { light: string; dark: string }
  onClick: () => void
}) {
  return (
    <button
      role="radio"
      aria-checked={checked}
      aria-label={label}
      title={label}
      onClick={onClick}
      style={colors && ({ '--l': colors.light, '--d': colors.dark } as CSSProperties)}
      className={`nib-tap size-6 shrink-0 cursor-pointer rounded-full ${
        colors
          ? 'bg-[var(--l)] dark:bg-[var(--d)]'
          : 'border border-line bg-[linear-gradient(135deg,transparent_46%,var(--color-faint)_46%,var(--color-faint)_54%,transparent_54%)]'
      } ${checked ? 'outline-2 outline-offset-2 outline-ink' : ''}`}
    />
  )
}

/**
 * Up to `max` of the pool, in order: the chosen ones first, each with a way
 * up and down, then the rest to add while there is room.
 */
function Tools({
  title,
  pool,
  max,
  chosen,
  onChange,
}: {
  title: string
  pool: { id: string; label: string }[]
  max: number
  chosen: string[]
  onChange: (chosen: string[]) => void
}) {
  const label = (id: string) => pool.find((tool) => tool.id === id)!.label
  const move = (index: number, by: number) => {
    const next = [...chosen]
    ;[next[index], next[index + by]] = [next[index + by], next[index]]
    onChange(next)
  }
  const arrow = 'cursor-pointer px-1 text-muted hover:text-ink disabled:cursor-default disabled:text-faint pointer-coarse:px-3'

  return (
    <div role="group" aria-label={title} className="mt-3">
      <div className="text-[11px] text-muted">
        {title} · up to {max}
      </div>
      <ul className="mt-1 flex flex-col">
        {chosen.map((id, index) => (
          <li key={id} className="flex items-center gap-1 py-0.5 text-[11.5px] pointer-coarse:py-1.5">
            <label className="flex flex-1 cursor-pointer items-center gap-2">
              <input type="checkbox" checked onChange={() => onChange(chosen.filter((other) => other !== id))} />
              {label(id)}
            </label>
            <button aria-label={`Move ${label(id)} earlier`} disabled={index === 0} onClick={() => move(index, -1)} className={arrow}>
              ↑
            </button>
            <button aria-label={`Move ${label(id)} later`} disabled={index === chosen.length - 1} onClick={() => move(index, 1)} className={arrow}>
              ↓
            </button>
          </li>
        ))}
        {pool
          .filter((tool) => !chosen.includes(tool.id))
          .map((tool) => (
            <li key={tool.id} className="py-0.5 text-[11.5px] text-muted pointer-coarse:py-1.5">
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={false} disabled={chosen.length >= max} onChange={() => onChange([...chosen, tool.id])} />
                {tool.label}
              </label>
            </li>
          ))}
      </ul>
    </div>
  )
}

function Lock() {
  return (
    <svg role="img" aria-label="Nib Plus" width="9" height="11" viewBox="0 0 9 11" fill="none" className="shrink-0 text-muted">
      <path d="M2 4.6V3a2.5 2.5 0 0 1 5 0v1.6" stroke="currentColor" strokeWidth="1" />
      <rect x=".5" y="4.6" width="8" height="5.9" rx="1.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}
