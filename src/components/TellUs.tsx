import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { count } from '../lib/counts'
import { FeedbackError, feedbackFits, feedbackLength, giftStillOpen, rememberGifted, sendFeedback } from '../lib/feedback'
import { FEEDBACK_MAX, FEEDBACK_MIN } from '../lib/reported'
import { Sheet } from './Sheet'

const quiet = 'nib-tap cursor-pointer text-[12px] text-muted hover:text-ink'
const strong = 'nib-tap cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper disabled:opacity-50'

/**
 * A card over everything, Settings included. It takes the keyboard on a Mac
 * and gives it back when it goes; on iPhone and iPad it isn't given back, which
 * would raise the keyboard unasked, and on itself the focus raises nothing and
 * tells VoiceOver it's there.
 */
function Card({ title, onDismiss, children }: { title: string; onDismiss: () => void; children: ReactNode }) {
  const heading = useId()
  return (
    <Sheet aria-labelledby={heading} onClose={onDismiss} z="z-[57]" top="pt-[10vh]" focusOnTouch className="nib-pop h-fit w-[min(380px,90vw)] rounded-lg border border-line bg-paper p-4">
      <h2 id={heading} className="text-[14px] font-medium">
        {title}
      </h2>
      {children}
    </Sheet>
  )
}

/** Asked once (lib/feedback). Nothing is counted before a yes. */
export function CountsAsk({ onAnswer }: { onAnswer: (yes: boolean) => void }) {
  return (
    <Card title="Help make Nib better?" onDismiss={() => onAnswer(false)}>
      <p className="mt-2 text-[12px] leading-[1.5] text-muted">
        Nib can send a daily count of which features get used, like how many times Export was used. Never your writing or your titles, and nothing that says who you are or which device it came from. You can change this in Settings.
      </p>
      <div className="mt-3 flex items-center justify-end gap-4">
        <button onClick={() => onAnswer(false)} className={quiet}>
          No thanks
        </button>
        <button onClick={() => onAnswer(true)} className={strong}>
          Send counts
        </button>
      </div>
    </Card>
  )
}

/** Shown once, ever, even after Nib is deleted and downloaded again (lib/feedback). */
export function FeedbackOffer({ gift, onSend, onLater }: { gift: boolean; onSend: () => void; onLater: () => void }) {
  return (
    <Card title="What should Nib do next?" onDismiss={onLater}>
      <p className="mt-2 text-[12px] leading-[1.5] text-muted">
        {gift ? 'Tell us what you’d like to see in Nib, and get 2 weeks of Nib Plus for free: everything but sync.' : 'Tell us what you’d like to see in Nib. We read every message.'} You’ll always find it in Settings, under Send feedback.
      </p>
      <div className="mt-3 flex items-center justify-end gap-4">
        <button onClick={onLater} className={quiet}>
          Not now
        </button>
        <button onClick={onSend} className={strong}>
          Send feedback
        </button>
      </div>
    </Card>
  )
}

/** Settings → Send feedback, Commands, or the offer. `subscribed`: Plus already, so nothing to give. */
export function FeedbackDialog({ subscribed, onGift, onClose }: { subscribed: boolean; onGift: () => number | null; onClose: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [done, setDone] = useState<{ until: number | null } | null>(null)
  const [gift, setGift] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  const counted = useId()

  useEffect(() => {
    count('feedback_opened')
    field.current?.focus()
    let live = true
    void giftStillOpen().then((open) => live && setGift(open && !subscribed))
    return () => {
      live = false
    }
  }, [subscribed])

  async function send() {
    setBusy(true)
    setMessage('')
    try {
      await sendFeedback(text)
    } catch (error) {
      setMessage(error instanceof FeedbackError ? error.message : 'That didn’t send. Please try again in a little while.')
      setBusy(false)
      return
    }
    count('feedback_sent')
    const until = gift ? onGift() : null
    if (gift) void rememberGifted()
    setDone({ until })
    setBusy(false)
  }

  // Not with words in the box: a stray tap or Escape shouldn't lose them.
  const leave = () => {
    if (done || !text.trim()) onClose()
  }

  if (done) {
    const until = done.until && new Date(done.until).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })
    return (
      <Card title="Thank you" onDismiss={onClose}>
        <p className="mt-2 text-[12px] leading-[1.5] text-muted" role="status">
          {until ? `Your message is on its way. Nib Plus is open until ${until}, everything but sync.` : 'Your message is on its way.'}
        </p>
        <div className="mt-3 flex justify-end">
          <button onClick={onClose} className={strong}>
            Done
          </button>
        </div>
      </Card>
    )
  }

  const typed = feedbackLength(text)
  return (
    <Card title="Send feedback" onDismiss={leave}>
      <p className="mt-2 text-[12px] leading-[1.5] text-muted">{gift ? 'What would you like to see in Nib? Your first message earns 2 weeks of Nib Plus, everything but sync.' : 'What would you like to see in Nib?'}</p>
      <textarea
        ref={field}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={4}
        aria-label="Your feedback"
        aria-describedby={counted}
        className="mt-2 w-full resize-none rounded-md border border-line bg-transparent px-2 py-1.5 text-[13px] leading-[1.45] text-ink outline-none focus:border-muted pointer-coarse:text-[16px]"
      />
      <p id={counted} className="mt-1 text-right text-[11px] text-muted tabular-nums">
        {typed < FEEDBACK_MIN ? `${typed} of at least ${FEEDBACK_MIN} characters` : typed > FEEDBACK_MAX ? `${typed.toLocaleString()} characters: that’s over ${FEEDBACK_MAX.toLocaleString()}` : `${typed.toLocaleString()} characters`}
      </p>
      <p className="mt-1.5 text-[11px] leading-[1.4] text-muted">Sent to Nib’s server with your kind of device and Nib’s version, and nothing about who you are. To hear back, include a way to reach you.</p>
      {message && (
        <p role="alert" className="mt-2 text-[12px] text-ink">
          {message}
        </p>
      )}
      <div className="mt-3 flex items-center justify-end gap-4">
        <button onClick={onClose} className={quiet}>
          Cancel
        </button>
        <button disabled={busy || !feedbackFits(text)} onClick={() => void send()} className={strong}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </Card>
  )
}
