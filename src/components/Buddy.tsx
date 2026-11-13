import { useEffect, useId, useState } from 'react'
import { spoke, useCheer } from '../lib/cheers'
import { touchApp } from '../lib/platform'
import { NibMark } from './NibMark'
import { BuddyAsk } from './BuddyAsk'
import { Sheet } from './Sheet'

/** How the buddy is moved, for a moment: perking up as it's opened or speaks, thinking as a question is typed, nodding as it answers. None, it just lives. */
export type Mood = 'perk' | 'think' | 'nod' | null

/**
 * The writing buddy (lib/buddy): the nib of the app icon (components/NibMark),
 * with two eyes and a smile in the paper's colour, so it reads in a dark theme
 * as in a light one. Alive (index.css .nib-buddy): breathing, blinking now
 * and then, and as `mood` moves it; `onSettled` once a perk or a nod is done.
 * With Nib Plus (`plus`), in its badge's colours (assets/plus-badge.png): the
 * glow round the badge, sky blue to violet, down its body and collar.
 */
export function BuddyFace({ className, mood = null, onSettled, plus = false }: { className?: string; mood?: Mood; onSettled?: () => void; plus?: boolean }) {
  // useId's characters aren't all safe in url(#…); letters and digits are.
  const glow = `nib-buddy-glow${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <NibMark
      className={`nib-buddy ${className ?? ''}`}
      data-mood={mood ?? undefined}
      data-plus={plus || undefined}
      style={plus ? { fill: `url(#${glow})` } : undefined}
      onAnimationEnd={(event) => event.target === event.currentTarget && onSettled?.()}
    >
      {plus && (
        <defs>
          <linearGradient id={glow} gradientUnits="userSpaceOnUse" x1={0} y1={0} x2={64} y2={103.4}>
            <stop offset={0} stopColor="#65aefe" />
            <stop offset={0.5} stopColor="#8097fc" />
            <stop offset={1} stopColor="#987df8" />
          </linearGradient>
        </defs>
      )}
      <g className="nib-buddy-eyes">
        <circle className="nib-buddy-eye" cx={23} cy={31} r={4.2} fill="var(--color-paper)" />
        <circle className="nib-buddy-eye" cx={41} cy={31} r={4.2} fill="var(--color-paper)" />
      </g>
      <path d="M25.5 38.5 Q32 43.5 38.5 38.5" stroke="var(--color-paper)" strokeWidth={3.2} fill="none" strokeLinecap="round" />
    </NibMark>
  )
}

/** On an iPhone or iPad, whether the cursor is in the writing: the keyboard is up, and the corner is the writing's. */
function useWritingOnTouch() {
  const [writing, setWriting] = useState(false)
  useEffect(() => {
    if (!touchApp) return
    const inText = (target: EventTarget | null) => target instanceof Element && target.closest('.ProseMirror') !== null
    const onIn = (event: FocusEvent) => setWriting(inText(event.target))
    const onOut = (event: FocusEvent) => setWriting(inText(event.relatedTarget))
    document.addEventListener('focusin', onIn)
    document.addEventListener('focusout', onOut)
    return () => {
      document.removeEventListener('focusin', onIn)
      document.removeEventListener('focusout', onOut)
    }
  }, [])
  return writing
}

/** How long a cheer stays by the corner before it fades. */
export const SAY_MS = 6000

/**
 * A cheer waiting (lib/cheers), said once the screen is clear: no card or
 * sheet up, and the corner showing. It fades by itself.
 */
function useSaying(showing: boolean) {
  const line = useCheer()
  const [text, setText] = useState<string | null>(null)
  const [going, setGoing] = useState(false)
  useEffect(() => {
    if (!line || !showing || text) return
    const timer = setInterval(() => {
      if (document.querySelector('[role="dialog"]')) return
      setText(line)
      setGoing(false)
      spoke()
    }, 1000)
    return () => clearInterval(timer)
  }, [line, showing, text])
  useEffect(() => {
    if (!text) return
    const fade = setTimeout(() => setGoing(true), SAY_MS)
    const gone = setTimeout(() => setText(null), SAY_MS + 500)
    return () => {
      clearTimeout(fade)
      clearTimeout(gone)
    }
  }, [text])
  return { text, going, quiet: () => setText(null) }
}

/**
 * The buddy in its corner, bottom left, clear of the library's last line and
 * the way back to it: tapped, it opens. Over the library, which covers the
 * screen (components/Library, z-30), and under every sheet. Not drawn while
 * the writing has the keyboard on an iPhone or iPad; the App leaves it out in
 * focus mode. Now and then it has something to say (lib/cheers), just above.
 */
export function BuddyCorner({ onOpen, plus = false }: { onOpen: () => void; plus?: boolean }) {
  const writing = useWritingOnTouch()
  const saying = useSaying(!writing)
  // It perks up as it has something to say.
  const [mood, setMood] = useState<Mood>(null)
  useEffect(() => {
    if (saying.text) setMood('perk')
  }, [saying.text])
  if (writing) return null
  const open = () => {
    saying.quiet()
    onOpen()
  }
  return (
    <>
      <div role="status" className="fixed bottom-[calc(env(safe-area-inset-bottom)+6.5rem)] left-[calc(env(safe-area-inset-left)+0.75rem)] z-[35]">
        {saying.text && (
          <button
            onClick={open}
            style={{ opacity: saying.going ? 0 : 1 }}
            className="nib-pop relative block max-w-[min(260px,70vw)] cursor-pointer rounded-lg border border-line bg-paper px-3 py-2 text-left text-[12.5px] leading-[1.45] text-ink shadow-[0_8px_20px_rgba(0,0,0,0.12)] transition-opacity duration-500"
          >
            {saying.text}
            <span aria-hidden className="absolute -bottom-[5px] left-5 size-2.5 rotate-45 border-r border-b border-line bg-paper" />
          </button>
        )}
      </div>
      <button
        aria-label="Inkwell"
        onClick={open}
        className="nib-tap fixed bottom-[calc(env(safe-area-inset-bottom)+3rem)] left-[calc(env(safe-area-inset-left)+0.75rem)] z-[35] flex size-12 cursor-pointer items-center justify-center rounded-full text-ink opacity-85 transition-opacity hover:opacity-100"
      >
        <BuddyFace className="h-[40px]" mood={mood} onSettled={() => setMood(null)} plus={plus} />
      </button>
    </>
  )
}

/** The buddy, opened: what it knows, to ask (components/BuddyAsk). */
export function BuddyPanel({ onClose, plus = false }: { onClose: () => void; plus?: boolean }) {
  const heading = useId()
  // Opened, it perks up; then it's moved by what's asked (components/BuddyAsk).
  const [mood, setMood] = useState<Mood>('perk')
  // Its own story, from My story, how many times it's been asked for.
  const [storyAsked, setStoryAsked] = useState(0)
  return (
    <Sheet aria-labelledby={heading} onClose={onClose} top="pt-[8vh]" focusOnTouch className="nib-pop h-fit w-[min(480px,92vw)] rounded-lg border border-line bg-paper p-4">
      <div className="flex items-start gap-3">
        <BuddyFace className="h-[44px] shrink-0 text-ink" mood={mood} onSettled={() => setMood(null)} plus={plus} />
        <div className="min-w-0 flex-1">
          <h2 id={heading} className="text-[14px] font-medium">
            Inkwell
          </h2>
          <p className="mt-0.5 text-[12px] leading-[1.5] text-muted">Ask me about Nib, or about writing.</p>
          <button onClick={() => setStoryAsked((times) => times + 1)} className="nib-tap mt-0.5 cursor-pointer text-[12px] text-muted underline underline-offset-2 hover:text-ink">
            My story
          </button>
        </div>
        <button onClick={onClose} className="nib-tap cursor-pointer text-[12px] text-muted hover:text-ink">
          Done
        </button>
      </div>
      <BuddyAsk onMood={setMood} storyAsked={storyAsked} />
    </Sheet>
  )
}

/** Offered once (lib/buddy): Say hello turns it on, and anything else leaves it off. */
export function BuddyOffer({ onAnswer, plus = false }: { onAnswer: (yes: boolean) => void; plus?: boolean }) {
  const heading = useId()
  return (
    <Sheet aria-labelledby={heading} onClose={() => onAnswer(false)} z="z-[57]" top="pt-[10vh]" focusOnTouch className="nib-pop h-fit w-[min(380px,90vw)] rounded-lg border border-line bg-paper p-4">
      <div className="flex items-start gap-3">
        <BuddyFace className="h-[52px] shrink-0 text-ink" plus={plus} />
        <div className="min-w-0 flex-1">
          <h2 id={heading} className="text-[14px] font-medium">
            Meet Inkwell?
          </h2>
          <p className="mt-2 text-[12px] leading-[1.5] text-muted">
            Inkwell is a small nib in the corner that answers questions about Nib and about writing, and cheers you on now and then. It’s free, and everything it does stays on this device. You can turn it off in Settings.
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-4">
        <button onClick={() => onAnswer(false)} className="nib-tap cursor-pointer text-[12px] text-muted hover:text-ink">
          Not now
        </button>
        <button onClick={() => onAnswer(true)} className="nib-tap cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper">
          Say hello
        </button>
      </div>
    </Sheet>
  )
}
