import type { ReactNode } from 'react'
import badge from '../assets/plus-badge.png'
import blue from '../assets/icons/blue.png'
import green from '../assets/icons/green.png'
import ink from '../assets/icons/ink.png'
import paperIcon from '../assets/icons/paper.png'
import rose from '../assets/icons/rose.png'
import vellumIcon from '../assets/icons/vellum.png'
import sageIcon from '../assets/icons/sage.png'
import lilacIcon from '../assets/icons/lilac.png'
import emberIcon from '../assets/icons/ember.png'
import tideIcon from '../assets/icons/tide.png'
import merlotIcon from '../assets/icons/merlot.png'
import nibPlusIcon from '../assets/icons/nib-plus.png'
import inkwellIcon from '../assets/icons/inkwell.png'
import { touchApp } from '../lib/platform'
import { PRIVACY_URL, perMonth, TERMS_URL, type Entitlement } from '../lib/plus'
import { usePurchase } from '../lib/usePurchase'
import { Sheet } from './Sheet'

/**
 * Nib Plus, offered of its own accord (lib/upsell): what it is, shown rather
 * than listed, and the way to buy it there and then. Billing in Settings stays
 * the place to manage it. A bottom sheet on a phone; on a wide screen, the
 * looks on one side and the price on the other. In the badge's own colours
 * (index.css .nib-plus-night, .nib-plus-rim, .nib-plus-glow): graphite, and the
 * glow round its rim, sky blue to violet.
 */

/** What Plus gives; `fresh`, new in this release (1.10.15), marked New. */
const FEATURES: { title: string; line: string; icon: ReactNode; fresh?: true }[] = [
  {
    title: 'On every device',
    line: 'iPhone, iPad and Mac, always in step.',
    icon: (
      <>
        <rect x="2" y="5" width="13" height="9" rx="1.5" />
        <path d="M1 17.5h15" />
        <rect x="17" y="8" width="6" height="12" rx="1.5" />
      </>
    ),
  },
  {
    title: 'Encrypted backup',
    line: 'Our server can’t read a word of it.',
    icon: (
      <>
        <path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z" />
        <path d="M9 12l2 2 4-4" />
      </>
    ),
  },
  {
    title: 'Backup to a folder',
    line: 'Markdown, once a day, where you choose.',
    fresh: true,
    icon: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 10v6M9.5 13.5L12 16l2.5-2.5" />,
  },
  {
    title: 'Word, PDF and HTML',
    line: 'Hand in a page the way it looks.',
    icon: (
      <>
        <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
        <path d="M14 3v5h5M12 18v-6M9.5 14.5L12 12l2.5 2.5" />
      </>
    ),
  },
  {
    title: 'To your own blog',
    line: 'A draft on WordPress, Ghost or Micro.blog.',
    fresh: true,
    icon: <path d="M21 3L3 10.5l7.5 3 3 7.5zM10.5 13.5L15 9" />,
  },
  {
    title: 'Your book, ready to send',
    line: 'A title page, manuscript format and a word goal.',
    icon: (
      <>
        <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" />
        <path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9.5 7.5h5" />
      </>
    ),
  },
  {
    title: 'Find across a book',
    line: 'Replace a name in every chapter, with an Undo.',
    icon: <path d="M15 15l5.5 5.5M16.5 10.5a6 6 0 1 1-12 0 6 6 0 0 1 12 0zM8 10.5h5" />,
  },
  {
    title: 'Your chapters on cards',
    line: 'A summary and a status on each, and progress.',
    fresh: true,
    icon: (
      <>
        <rect x="3" y="4" width="8" height="7" rx="1" />
        <rect x="13" y="4" width="8" height="7" rx="1" />
        <rect x="3" y="13" width="8" height="7" rx="1" />
        <path d="M5.5 7h3M15.5 7h3M5.5 16h3M13 16.5h8" />
      </>
    ),
  },
  {
    title: 'Your book in print',
    line: 'Ready for Amazon KDP or IngramSpark.',
    fresh: true,
    icon: <path d="M12 6.5C10 5 7 4.5 3 5v13c4-.5 7 0 9 1.5 2-1.5 5-2 9-1.5V5c-4-.5-7 0-9 1.5zM12 6.5v13" />,
  },
  {
    title: 'Submissions, tracked',
    line: 'Where it went, and when to follow up.',
    fresh: true,
    icon: <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5zM3.5 6l8.5 6.5L20.5 6" />,
  },
  {
    title: 'Your book, read to you',
    line: 'Read aloud, or saved as audio to proofread by ear.',
    fresh: true,
    icon: <path d="M4 16v-4a8 8 0 0 1 16 0v4M4 16a2 2 0 0 1 2-2h1.5v6H6a2 2 0 0 1-2-2zM20 16a2 2 0 0 0-2-2h-1.5v6H18a2 2 0 0 0 2-2z" />,
  },
  {
    title: 'Sounds to write to',
    line: 'Rain, a café, a fire, typewriter keys.',
    fresh: true,
    icon: <path d="M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />,
  },
  {
    title: 'Widgets and Shortcuts',
    line: 'Your goal, streak and book on the Home Screen.',
    fresh: true,
    icon: (
      <>
        <rect x="3" y="3" width="8" height="8" rx="2" />
        <circle cx="17" cy="7" r="3.5" />
        <rect x="3" y="13" width="18" height="8" rx="2" />
      </>
    ),
  },
  {
    title: 'Characters and places',
    line: 'Who and where, chapter by chapter.',
    fresh: true,
    icon: (
      <>
        <circle cx="8.5" cy="8" r="3.5" />
        <path d="M2.5 20a6 6 0 0 1 12 0M18.5 20.5s-3.5-3.2-3.5-6a3.5 3.5 0 0 1 7 0c0 2.8-3.5 6-3.5 6z" />
        <circle cx="18.5" cy="14.5" r="1" />
      </>
    ),
  },
  {
    title: 'Screenplays',
    line: 'Set out as you type; PDF and Final Draft.',
    fresh: true,
    icon: (
      <>
        <path d="M4 10h16v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
        <path d="m4 10-.6-3.4 15.8-2.8.6 3.4zM8.4 5.9l2 2.9M13.4 5l2 2.9" />
      </>
    ),
  },
  {
    title: 'Side by side, and tabs',
    line: 'More than one document open, on iPad and Mac.',
    icon: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M12 4v16M6 8.5h3M15 8.5h3" />
      </>
    ),
  },
  {
    title: 'Files with your writing',
    line: 'Attachments, and pictures at full quality.',
    icon: <path d="M20 11.5l-7.8 7.8a5 5 0 0 1-7.1-7.1l8.1-8.1a3.3 3.3 0 0 1 4.7 4.7l-8.1 8.1a1.7 1.7 0 0 1-2.4-2.4l7.5-7.5" />,
  },
  {
    title: 'Folders your way',
    line: 'As many as you like, each with a colour and icon.',
    icon: (
      <>
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <circle cx="12" cy="13" r="2" />
      </>
    ),
  },
  {
    title: 'Templates, without limit',
    line: 'As many as you like, past the one that’s free.',
    icon: (
      <>
        <rect x="7" y="3" width="13" height="15" rx="1.5" />
        <path d="M4 7v12a2 2 0 0 0 2 2h10M10 7.5h7M10 11h7M10 14.5h4" />
      </>
    ),
  },
  {
    title: 'Every version, kept',
    line: 'All your history, compared with now.',
    icon: <path d="M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2" />,
  },
  {
    title: 'Sprints and deadlines',
    line: 'A calendar, and your year’s stats.',
    icon: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4M9 15.5l2 2 4-4" />
      </>
    ),
  },
  {
    title: 'Style check, underlined',
    line: 'Each suggestion marked in your text.',
    icon: <path d="M4 7h16M4 12h10M4 18c1.3-1.3 2.7-1.3 4 0s2.7 1.3 4 0 2.7-1.3 4 0 2.7 1.3 4 0" />,
  },
  {
    title: 'A private vault',
    line: 'Chosen notes behind their own passcode.',
    icon: (
      <>
        <rect x="5" y="11" width="14" height="10" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3M12 15v2" />
      </>
    ),
  },
  {
    title: 'Shared drafts, fuller',
    line: 'Several at once, with readers’ notes.',
    icon: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12zM9 11h6M9 14h4" />,
  },
]

const LOOKS = ['Serif and mono fonts', '8 accents', 'A theme of your own', 'Highlight colours', 'Indented paragraphs', 'Focus dimming', 'Your own toolbar', 'Saved looks']

// The fourteen Plus themes, as their tiles in Settings draw them: paper, ink, accent.
const THEMES = [
  { label: 'Gruvbox Dark', paper: '#282828', ink: '#ebdbb2', accent: '#d65d0e' },
  { label: 'Green Olive', paper: '#252525', ink: '#bfdce5', accent: '#8fb02a' },
  { label: 'Gruvbox Light', paper: '#fbf1c7', ink: '#3c3836', accent: '#af3a03' },
  { label: 'Pastel Pink', paper: '#fbe1ea', ink: '#5c0a29', accent: '#b63a69' },
  { label: 'Purple Green', paper: '#252525', ink: '#e7e7e7', accent: '#a7ff00' },
  { label: 'Alien Pink', paper: '#0a1722', ink: '#e5e5e5', accent: '#ff5a9f' },
  { label: 'drcl', paper: '#282a36', ink: '#e8eaf6', accent: '#50fa7b' },
  { label: 'Nib Plus', paper: '#18181c', ink: '#f2f2f7', accent: '#8097fc' },
  { label: 'Vellum', paper: '#f7f0e5', ink: '#3a2a1f', accent: '#8e2f3c' },
  { label: 'Sage', paper: '#eff3ec', ink: '#1f3326', accent: '#2c6847' },
  { label: 'Lilac', paper: '#f4f1f8', ink: '#2b2238', accent: '#6146b5' },
  { label: 'Ember', paper: '#1c1714', ink: '#eee2d4', accent: '#e6a246' },
  { label: 'Tide', paper: '#0f1c1e', ink: '#dcebea', accent: '#4cc3b5' },
  { label: 'Merlot', paper: '#1d1416', ink: '#f1e3e4', accent: '#ee8a86' },
]

const ICONS = [
  { label: 'Ink', src: ink },
  { label: 'Paper', src: paperIcon },
  { label: 'Blue', src: blue },
  { label: 'Green', src: green },
  { label: 'Rose', src: rose },
  { label: 'Vellum', src: vellumIcon },
  { label: 'Sage', src: sageIcon },
  { label: 'Lilac', src: lilacIcon },
  { label: 'Ember', src: emberIcon },
  { label: 'Tide', src: tideIcon },
  { label: 'Merlot', src: merlotIcon },
  { label: 'Nib Plus', src: nibPlusIcon },
  { label: 'Inkwell', src: inkwellIcon },
]

export function UpgradeDialog({
  reason,
  onEntitlement,
  onClose,
}: {
  /** Why it opened, when something asked for Plus: the free folders used up, say. */
  reason?: string
  onEntitlement: (entitlement: Entitlement) => void
  onClose: () => void
}) {
  const { products, load, list, monthly, yearly, selected, saving, setChosen, busy, message, subscribe, restore } = usePurchase(onEntitlement)
  const trialDays = selected?.trialDays

  const link = 'nib-tap cursor-pointer text-muted underline-offset-2 hover:text-ink hover:underline disabled:cursor-default'

  return (
    <Sheet
      aria-labelledby="nib-plus-title"
      onClose={onClose}
      overlay="z-50 flex items-center justify-center bg-black/40 backdrop-blur-[3px] phone:items-end"
      focusOnTouch
      className="nib-pop nib-plus-sheet relative flex max-h-[calc(100dvh-2rem)] w-[min(520px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[18px] bg-paper text-ink shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_30px_80px_rgba(10,20,40,0.3)] lg:max-h-[min(740px,calc(100dvh-2rem))] lg:w-[min(960px,calc(100vw-2rem))] lg:flex-row phone:max-h-[calc(100dvh-env(safe-area-inset-top)-0.75rem)] phone:w-full phone:rounded-b-none phone:pr-[env(safe-area-inset-right)] phone:pl-[env(safe-area-inset-left)]"
    >
      <button onClick={onClose} aria-label="Close" className="nib-tap absolute top-2 right-2 z-10 flex size-11 cursor-pointer items-center justify-center phone:right-[calc(env(safe-area-inset-right)+0.5rem)]">
        <span className="flex size-[30px] items-center justify-center rounded-full bg-white/12 text-white lg:bg-item-hover lg:text-muted">
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </span>
      </button>

      {/* The wide screen's left side: a look of one's own. */}
      <div className="nib-plus-night hidden w-[360px] shrink-0 flex-col gap-5 overflow-y-auto px-8 pt-7 pb-8 lg:flex">
        <div className="flex items-center gap-4">
          <img src={badge} alt="" className="size-[72px] rounded-[16px] shadow-[0_12px_36px_rgba(128,151,252,0.45)]" />
          <div>
            <div className="text-[21px] font-semibold tracking-[-0.015em]">Nib Plus</div>
            <div className="mt-0.5 text-[12.5px] text-[#9a9cab]">For iPhone, iPad and Mac</div>
          </div>
        </div>
        <Looks />
        <div>
          <div className="text-[13px] font-semibold">Make Nib entirely yours</div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {LOOKS.map((look) => (
              <span key={look} className="rounded-full border border-white/12 bg-white/6 px-2.5 py-1 text-[11.5px] text-[#dde2ff]">
                {look}
              </span>
            ))}
          </div>
        </div>
        {touchApp ? (
          <Icons night />
        ) : (
          <div>
            <div className="text-[13px] font-semibold">Fourteen more themes</div>
            <div className="mt-2 grid grid-cols-5 gap-2">
              {THEMES.map((theme) => (
                <div key={theme.label} className="flex flex-col gap-1.5">
                  <div className="flex h-10 items-center justify-center gap-1.5 rounded-lg text-[14px] font-semibold shadow-[0_0_0_1px_rgba(255,255,255,0.12)]" style={{ background: theme.paper, color: theme.ink }}>
                    Aa
                    <span className="h-1 w-3.5 rounded-sm" style={{ background: theme.accent }} />
                  </div>
                  <span className="text-center text-[10.5px] text-[#9a9cab]">{theme.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {/* Narrower: the looks as a band across the top, the badge on its edge. */}
          <div className="nib-plus-night relative h-[214px] lg:hidden">
            <span aria-hidden="true" className="absolute top-1.5 left-1/2 hidden h-[5px] w-9 -translate-x-1/2 rounded-full bg-white/25 phone:block" />
            <div className="absolute top-[22px] left-1/2 origin-top -translate-x-1/2 scale-[0.8]">
              <Looks bare />
            </div>
            <img src={badge} alt="" className="absolute -bottom-9 left-1/2 size-[72px] -translate-x-1/2 rounded-[16px] shadow-[0_0_0_4px_var(--color-paper),0_10px_28px_rgba(128,151,252,0.45)]" />
          </div>

          <div className="flex flex-col items-center px-6 pt-[52px] text-center lg:items-start lg:px-10 lg:pt-9 lg:text-left">
            {reason && <p className="mb-3 rounded-lg bg-plus-wash px-3 py-2 text-[13px] leading-[1.45] text-plus-ink lg:mr-8">{reason}</p>}
            {trialDays ? <span className="mb-3 rounded-full bg-plus-wash px-2.5 py-1 text-[12px] font-semibold text-plus-ink">Free for {trialDays} days</span> : null}
            <h2 id="nib-plus-title" className="text-[27px] leading-[1.12] font-bold tracking-[-0.025em] lg:max-w-[400px] lg:text-[30px]">
              Write anywhere. Make it entirely yours.
            </h2>
            <p className="mt-2.5 text-[15px] leading-[1.45] text-muted lg:max-w-[420px] lg:text-[14.5px]">
              Your whole library on every device, encrypted so only you can read it, and every tool Nib has to give.
            </p>
          </div>

          {touchApp && (
            <div className="px-6 pt-6 lg:hidden">
              <Icons />
            </div>
          )}

          <ul className="grid gap-x-5 gap-y-4 px-6 pt-6 pb-6 sm:grid-cols-2 lg:px-10 lg:pt-6">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="flex items-center gap-3 sm:items-start">
                <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[9px] bg-[#1d1d23] text-[#8fa3fd] shadow-[inset_0_0_0_1px_rgba(128,151,252,0.28)] lg:size-8">
                  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                    {feature.icon}
                  </svg>
                </span>
                <span>
                  <span className="flex items-center gap-1.5 text-[14px] font-semibold lg:text-[13.5px]">
                    {feature.title}
                    {feature.fresh && <span className="nib-plus-glow rounded-full px-1.5 text-[10px] leading-[16px] font-semibold">New</span>}
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-[1.45] text-muted lg:text-[12.5px]">{feature.line}</span>
                </span>
              </li>
            ))}
          </ul>
          {/* Says there's more below where the price cuts it off. */}
          <div aria-hidden="true" className="pointer-events-none sticky bottom-0 -mt-8 h-8 bg-linear-to-t from-paper" />
        </div>

        <div className="shrink-0 border-t border-line px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:border-t-0 lg:px-10 lg:pt-5 lg:pb-6">
          {products === 'loading' ? (
            <p className="py-6 text-center text-[13px] text-muted">Checking the App Store…</p>
          ) : products === 'unreachable' ? (
            <p className="py-6 text-center text-[13px] text-muted">
              Couldn’t reach the App Store.{' '}
              <button onClick={load} className={link}>
                Try again
              </button>
            </p>
          ) : list.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted">Nib Plus isn’t available yet.</p>
          ) : (
            <>
              <div role="radiogroup" aria-label="Plan" className="grid grid-cols-2 gap-2.5 pt-1.5">
                {[yearly, monthly]
                  .filter((product) => product !== undefined)
                  .map((product) => {
                    const active = product.id === selected?.id
                    const year = product.period === 'year'
                    const month = year ? perMonth(product) : null
                    return (
                      <button
                        key={product.id}
                        role="radio"
                        aria-checked={active}
                        onClick={() => setChosen(product.id)}
                        className={`nib-tap relative flex cursor-pointer flex-col gap-0.5 rounded-[14px] border-[1.5px] px-3.5 py-3 text-left transition-[border-color,background-color,box-shadow] duration-150 ${
                          active ? 'border-[#8097fc] bg-[#8097fc]/8 shadow-[0_0_0_3px_rgba(128,151,252,0.2)]' : 'border-line hover:bg-item-hover'
                        }`}
                      >
                        <span className="text-[13px] font-semibold">{year ? 'Yearly' : 'Monthly'}</span>
                        <span className="text-[17px] font-bold tracking-[-0.01em]">
                          {product.displayPrice}
                          <span className="text-[12px] font-normal text-muted"> / {product.period}</span>
                        </span>
                        <span className="text-[12px] text-muted">{year ? (month ? `Just ${month} a month` : 'Billed once a year') : 'Cancel any time'}</span>
                        {year && (
                          <span className="nib-plus-glow absolute -top-2.5 right-3 rounded-full px-2 py-0.5 text-[10.5px] font-semibold">
                            {saving > 0 ? `Save ${saving}%` : 'Best value'}
                          </span>
                        )}
                      </button>
                    )
                  })}
              </div>
              <button
                onClick={subscribe}
                disabled={busy || !selected}
                className="nib-tap nib-plus-rim mt-3.5 h-[52px] w-full cursor-pointer rounded-[14px] text-[16px] font-semibold disabled:cursor-default disabled:opacity-60 lg:h-[50px] lg:rounded-xl lg:text-[15px]"
              >
                {trialDays ? `Try it free for ${trialDays} days` : 'Get Nib Plus'}
              </button>
              {selected && (
                <p className="mt-2 text-center text-[11.5px] leading-[1.45] text-muted">
                  {trialDays ? `Free for ${trialDays} days, then ${selected.displayPrice} a ${selected.period}. ` : `${selected.displayPrice} a ${selected.period}. `}
                  Renews automatically until you cancel, at least a day before it renews, in your App Store account settings.
                </p>
              )}
            </>
          )}

          {message && (
            <p role="status" className="mt-2 text-center text-[12px] leading-[1.5] text-ink">
              {message}
            </p>
          )}

          <div className="mt-3 flex items-center justify-center gap-4 text-[11.5px] lg:justify-between">
            <button onClick={onClose} className={`${link} hidden lg:block`}>
              Not now
            </button>
            <span className="flex gap-4">
              <button onClick={restore} disabled={busy} className={link}>
                Restore purchases
              </button>
              <a href={TERMS_URL} target="_blank" rel="noreferrer" className={link}>
                Terms of Use
              </a>
              <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className={link}>
                Privacy Policy
              </a>
            </span>
          </div>
        </div>
      </div>
    </Sheet>
  )
}

/** The same page in three looks Plus opens up, fanned like cards. Pictures, so hidden from screen readers but for their label. */
function Looks({ bare = false }: { bare?: boolean }) {
  const card = 'absolute rounded-[10px] box-border overflow-hidden'
  const title = 'mb-[7px] text-[10.5px] font-semibold leading-[1.25]'
  return (
    <div role="img" aria-label="The same page in three looks: Alien Pink, Literata justified, and a theme of your own with focus dimming" className="flex flex-col gap-2.5">
      <div aria-hidden="true" className="relative h-[236px] w-[296px] text-[8.5px] leading-[1.6]">
        <div className={`${card} top-7 left-0 h-[190px] w-[148px] -rotate-8 bg-[#0a1722] p-3.5 text-[#e5e5e5] shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_10px_24px_rgba(0,0,0,0.4)]`}>
          <div className={title}>The Lighthouse Keeper</div>
          Every evening at six, Mara climbed the ninety-one steps with <span className="rounded-[2px] bg-[#5b2240] px-px">a tin of oil</span> and a
          notebook. The light did not need her. It had been automatic for <span className="text-[#ff5a9f] underline">eleven years</span>.
        </div>
        <div className={`${card} top-7 left-[148px] h-[190px] w-[148px] rotate-8 bg-[#f6efe6] p-3.5 text-[#2e2622] shadow-[0_10px_24px_rgba(46,38,34,0.18)]`}>
          <div className={`${title} text-[#9b3d5a]`}>The Lighthouse Keeper</div>
          <span className="opacity-30">Every evening at six, Mara climbed the ninety-one steps.</span> The light did not need her.{' '}
          <span className="opacity-30">It had been automatic for eleven years. She went anyway.</span>
        </div>
        <div className={`${card} top-1 left-[70px] h-[206px] w-[156px] bg-white px-[15px] py-4 text-justify font-['Literata_Variable',Georgia,serif] text-[9px] leading-[1.65] text-[#1a1a1a] hyphens-auto shadow-[0_0_0_1px_rgba(0,0,0,0.05),0_16px_34px_rgba(24,68,118,0.22)]`}>
          <div className={`${title} text-left text-[12px]`}>The Lighthouse Keeper</div>
          <p>Every evening at six, Mara climbed the ninety-one steps with a tin of oil and a notebook.</p>
          <p className="indent-[1.5em]">The light did not need her. It had been automatic for eleven years. She went anyway.</p>
        </div>
      </div>
      {!bare && (
        <div aria-hidden="true" className="grid grid-cols-3 text-center text-[10.5px] text-[#9a9cab]">
          <span>Alien Pink</span>
          <span>Literata, justified</span>
          <span>Your own, dimmed</span>
        </div>
      )}
    </div>
  )
}

/** Alternate app icons: iPhone and iPad only, where Customize can change them. `night`, on the graphite side. */
function Icons({ night = false }: { night?: boolean }) {
  return (
    <div>
      <div className="text-[13px] font-semibold lg:text-left">Pick your app icon</div>
      <div className="mt-2.5 grid grid-cols-5 gap-2.5">
        {ICONS.map((icon) => (
          <div key={icon.label} className={`flex flex-col items-center gap-1.5 text-[11px] ${night ? 'text-[#9a9cab]' : 'text-muted'}`}>
            <img src={icon.src} alt="" className="aspect-square w-full max-w-[52px] rounded-[22%] shadow-[0_0_0_1px_rgba(0,0,0,0.06)]" />
            {icon.label}
          </div>
        ))}
      </div>
    </div>
  )
}
