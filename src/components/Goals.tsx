import { useEffect, useId, useState } from 'react'
import { type DailyReminder, DEFAULT_TIME } from '../lib/dailyReminder'
import { invitationsHere } from '../lib/invitationSwitch'
import { CALENDAR_DAYS, readCalendar } from '../lib/goal'
import { localDay } from '../lib/time'
import { ReminderError } from '../lib/reminders'
import { download, SaveRefused } from '../lib/download'
import { macApp } from '../lib/platform'
import { hourOf, readFolders, readHours, summarize, type Summary } from '../lib/writingStats'
import { cardDue } from '../lib/yearCard'
import { Sheet } from './Sheet'
import { type Card, cardTitle, drawCard } from './yearCard'

const WEEKS = CALENDAR_DAYS / 7
/** The books and folders listed, most words first. */
const BOOKS_SHOWN = 5

const wordsOf = (words: number) => `${words.toLocaleString()} word${words === 1 ? '' : 's'}`
const daysOf = (days: number) => `${days.toLocaleString()} ${days === 1 ? 'day' : 'days'}`
const dayOf = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

/**
 * The daily goal and the daily reminder, free, and with Nib Plus a calendar
 * of words written each day for the last 26 weeks on this device, a week to
 * a column, Sunday at the top; and under it the year's stats (lib/writingStats).
 */
export function Goals({
  goal,
  onGoalChange,
  daily,
  plus,
  onOpenBilling,
  onBack,
}: {
  goal: number
  onGoalChange: (goal: number) => void
  /** Where notifications can ring: the app. */
  daily?: Pick<DailyReminder, 'time' | 'change' | 'invitations' | 'changeInvitations'>
  plus: boolean
  onOpenBilling: () => void
  onBack: () => void
}) {
  // Read once on opening: nothing is written while the writer is in here.
  const [calendar] = useState(readCalendar)
  const [stats] = useState(() => summarize(calendar, readFolders(), readHours(), Date.now()))
  const today = new Date()
  const first = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay() - (WEEKS - 1) * 7)
  const days: { label: string; words: number }[] = []
  for (const date = new Date(first); date <= today; date.setDate(date.getDate() + 1)) {
    const words = calendar[localDay(date.getTime())] ?? 0
    const day = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    days.push({ label: `${day}: ${words.toLocaleString()} word${words === 1 ? '' : 's'}`, words })
  }
  const most = Math.max(0, ...days.map((day) => day.words))
  const total = days.reduce((sum, day) => sum + day.words, 0)
  const written = days.filter((day) => day.words > 0).length
  const summary = total
    ? `${total.toLocaleString()} word${total === 1 ? '' : 's'} on ${written} ${written === 1 ? 'day' : 'days'} in the last 26 weeks`
    : 'Nothing written in the last 26 weeks yet'

  return (
    <div>
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="nib-tap cursor-pointer text-[11px] text-muted hover:text-ink">
          ← Back
        </button>
        <span className="text-[11px] text-faint">Goals</span>
      </div>

      {/* Free: the year's card, in December, once there's a word to put on it. */}
      {cardDue(Date.now()) && stats.total > 0 && <YearCard sums={stats} calendar={calendar} />}

      {/* Empty means no goal. */}
      <label className="mt-3 flex w-full items-center gap-2 rounded-md border border-line px-2 py-1.5">
        <span className="flex-1 text-[12px] font-medium whitespace-nowrap">Daily goal</span>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={50}
          value={goal || ''}
          placeholder="Off"
          onChange={(event) => onGoalChange(Number(event.target.value))}
          aria-label="Daily goal, in words"
          className="w-12 min-w-0 bg-transparent text-right text-[11px] outline-none placeholder:text-faint pointer-coarse:text-[16px]"
        />
        {goal > 0 && <span className="text-[11px] text-muted">words</span>}
      </label>
      {daily && <DailyRow daily={daily} />}
      {daily && invitationsHere && <InvitationsRow daily={daily} />}

      {!plus ? (
        <button
          onClick={onOpenBilling}
          className="nib-tap mt-3 flex w-full cursor-pointer items-center justify-between gap-2 text-left text-[11px] text-muted hover:text-ink"
        >
          <span>Words each day, and your year’s stats</span>
          <span>Plus ›</span>
        </button>
      ) : (
        <>
          <div className="mt-3 text-[11px] text-muted">Words each day</div>
          <div
            role="img"
            aria-label={summary}
            className="mt-1.5 grid grid-flow-col grid-rows-7 gap-[2px]"
            style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }}
          >
            {days.map((day) => (
              <span
                key={day.label}
                title={day.label}
                className="aspect-square rounded-[1px] bg-ink"
                // Shaded against the writer's own best day, so a quiet writer's
                // calendar isn't all pale. An empty day is a faint outline of one.
                style={{ opacity: day.words ? 0.25 + (0.75 * day.words) / most : 0.07 }}
              />
            ))}
          </div>
          <p className="mt-1.5 text-[11px] leading-[1.5] text-muted">
            {summary}. Kept on this device.
          </p>
          <Stats sums={stats} />
        </>
      )}
    </div>
  )
}

/**
 * The year's card, offered once a year in December without being asked
 * (lib/feedback askDue): drawn as it comes up, as the picture is the offer.
 * It's in Goals all month.
 */
export function YearCardOffer({ onDone }: { onDone: () => void }) {
  const [calendar] = useState(readCalendar)
  const [sums] = useState(() => summarize(calendar, readFolders(), readHours(), Date.now()))
  const heading = useId()
  return (
    <Sheet aria-labelledby={heading} onClose={onDone} z="z-[57]" top="pt-[6vh]" focusOnTouch className="nib-pop h-fit w-[min(380px,90vw)] rounded-lg border border-line bg-paper p-4">
      {/* Not the card's own title, which is just below. */}
      <h2 id={heading} className="text-[14px] font-medium">
        Your {sums.year}, as a card
      </h2>
      <p className="mt-2 text-[12px] leading-[1.5] text-muted">Made from what you wrote on this device, to save or share. You’ll find it in Settings, under Goals, all December.</p>
      <YearCard sums={sums} calendar={calendar} onClose={onDone} />
    </Sheet>
  )
}

/**
 * The year's card (components/yearCard): drawn when asked for, shown, then
 * saved on the Mac or shared on iPhone and iPad. `onClose`: offered, drawn
 * at once, and closing closes the offer.
 */
function YearCard({ sums, calendar, onClose }: { sums: Summary; calendar: Record<string, number>; onClose?: () => void }) {
  const [card, setCard] = useState<Card | null>(null)
  const [message, setMessage] = useState('')
  const title = cardTitle(calendar, sums.year)
  // Drawn once on coming up: what it's drawn from is read once too.
  useEffect(() => {
    if (onClose) void show()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drawn once, as it comes up
  }, [])

  async function show() {
    setMessage('')
    try {
      setCard(await drawCard(sums, calendar, Date.now()))
    } catch {
      setMessage('Couldn’t make the card.')
    }
  }

  async function hand(made: Card) {
    setMessage('')
    try {
      await download(made.png, `${made.title} ${sums.year}.png`, 'image/png')
    } catch (error) {
      setMessage(error instanceof SaveRefused ? 'That folder wouldn’t take the card. Try another, such as Downloads.' : 'Couldn’t save the card.')
    }
  }

  return (
    <div className="mt-3">
      {!card && onClose ? (
        // The card's own shape, till it's drawn.
        <div className="aspect-[4/5] w-full rounded-md border border-line" />
      ) : !card ? (
        <button
          onClick={() => void show()}
          className="nib-tap flex w-full cursor-pointer items-center gap-2 rounded-md border border-line px-2 py-1.5 text-left hover:bg-item-hover"
        >
          <span className="flex-1">
            <span className="block text-[12px] font-medium">{title}</span>
            <span className="block text-[11px] leading-[1.4] text-muted">Your {sums.year}, as a card to save or share.</span>
          </span>
          <span className="text-[11px] text-muted">›</span>
        </button>
      ) : (
        <>
          <img src={card.src} alt={card.alt} className="w-full rounded-md border border-line" />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <button onClick={onClose ?? (() => setCard(null))} className="nib-tap cursor-pointer text-[11px] text-muted hover:text-ink">
              {onClose ? 'Not now' : 'Close'}
            </button>
            <button
              onClick={() => void hand(card)}
              className="nib-tap cursor-pointer rounded-md bg-ink px-2.5 py-1 text-[11px] font-medium text-paper"
            >
              {macApp ? 'Save…' : 'Share…'}
            </button>
          </div>
        </>
      )}
      {message && (
        <p role="alert" className="mt-1.5 text-[11px] leading-[1.4] text-ink">
          {message}
        </p>
      )}
    </div>
  )
}

/** The year so far, Nib Plus: what it adds up to, its best day and runs, its busiest hour, and where the words went. */
function Stats({ sums }: { sums: Summary }) {
  if (sums.total === 0) return <p className="mt-3 text-[11px] leading-[1.5] text-muted">Nothing written in {sums.year} yet.</p>
  const { best, busiestHour } = sums
  const rows = (
    [
      ['This week', wordsOf(sums.thisWeek)],
      ['This month', wordsOf(sums.thisMonth)],
      [`${sums.year} so far`, `${wordsOf(sums.total)} on ${daysOf(sums.days)}`],
      best && ['Best day', `${dayOf(best.day)}: ${wordsOf(best.words)}`],
      ['Longest run', daysOf(sums.longestRun)],
      sums.currentRun > 0 && ['Run going now', daysOf(sums.currentRun)],
      busiestHour !== undefined && ['Busiest hour', `${hourOf(busiestHour)} to ${hourOf((busiestHour + 1) % 24)}`],
    ] as const
  ).filter((row) => !!row)
  const books = sums.books.slice(0, BOOKS_SHOWN)
  return (
    <>
      <div className="mt-3 text-[11px] text-muted">Your year</div>
      <dl className="mt-1.5 rounded-md border border-line px-2 py-1">
        {rows.map(([name, value]) => (
          <div key={name} className="flex items-baseline justify-between gap-2 py-0.5 text-[11px]">
            <dt className="text-muted">{name}</dt>
            <dd className="text-right tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {books.length > 0 && (
        <>
          <div className="mt-3 text-[11px] text-muted">Books and folders</div>
          <dl className="mt-1.5 rounded-md border border-line px-2 py-1">
            {books.map(({ name, words }) => (
              <div key={name} className="flex items-baseline justify-between gap-2 py-0.5 text-[11px]">
                <dt className={`min-w-0 truncate ${name ? '' : 'text-muted'}`}>{name || 'In no folder'}</dt>
                <dd className="shrink-0 text-right tabular-nums">{wordsOf(words)}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
      <p className="mt-1.5 text-[11px] leading-[1.5] text-muted">
        Kept on this device. Books, folders and hours are counted from this update on.
      </p>
    </>
  )
}

/** Invitations to write (lib/invitations, free): on or off. Their time is the daily reminder's when that's on. */
function InvitationsRow({ daily }: { daily: Pick<DailyReminder, 'invitations' | 'changeInvitations'> }) {
  const [message, setMessage] = useState('')
  const on = daily.invitations

  async function change(next: boolean) {
    setMessage('')
    try {
      await daily.changeInvitations(next)
    } catch (error) {
      setMessage(error instanceof ReminderError ? error.message : 'Couldn’t turn them on.')
    }
  }

  return (
    <div className="mt-1.5 rounded-md border border-line px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className="flex-1">
          <span className="block text-[12px] font-medium">Invitations to write</span>
          <span className="block text-[11px] leading-[1.4] text-muted">A short line to bring you back: your streak, your book, today’s pack. One a day at most, the reminder included, and none once you’ve written. On this device only.</span>
        </span>
        <button
          role="switch"
          aria-checked={on}
          aria-label="Invitations to write"
          onClick={() => void change(!on)}
          className={`nib-tap relative h-[18px] w-[30px] shrink-0 cursor-pointer rounded-full transition-colors ${on ? 'bg-ink' : 'bg-line'}`}
        >
          <span
            aria-hidden
            className={`absolute top-[2px] left-0 size-[14px] rounded-full bg-paper transition-transform ${on ? 'translate-x-[14px]' : 'translate-x-[2px]'}`}
          />
        </button>
      </div>
      {message && (
        <p role="alert" className="mt-1.5 text-[11px] leading-[1.4] text-ink">
          {message}
        </p>
      )}
    </div>
  )
}

/** The daily reminder (lib/dailyReminder): on or off, and when. */
function DailyRow({ daily }: { daily: Pick<DailyReminder, 'time' | 'change'> }) {
  // The time it would ring, kept while it's off, for when it's on again.
  const [time, setTime] = useState(daily.time ?? DEFAULT_TIME)
  const [message, setMessage] = useState('')
  const on = daily.time !== null

  async function change(next: string | null) {
    setMessage('')
    try {
      await daily.change(next)
    } catch (error) {
      setMessage(error instanceof ReminderError ? error.message : 'Couldn’t set the reminder.')
    }
  }

  return (
    <div className="mt-1.5 rounded-md border border-line px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className="flex-1">
          <span className="block text-[12px] font-medium">Daily reminder</span>
          <span className="block text-[11px] leading-[1.4] text-muted">On each day your pack is still waiting. On this device only.</span>
        </span>
        <button
          role="switch"
          aria-checked={on}
          aria-label="Daily reminder"
          onClick={() => void change(on ? null : time)}
          className={`nib-tap relative h-[18px] w-[30px] shrink-0 cursor-pointer rounded-full transition-colors ${on ? 'bg-ink' : 'bg-line'}`}
        >
          <span
            aria-hidden
            className={`absolute top-[2px] left-0 size-[14px] rounded-full bg-paper transition-transform ${on ? 'translate-x-[14px]' : 'translate-x-[2px]'}`}
          />
        </button>
      </div>
      {on && (
        <label className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-muted">
          <span>At</span>
          <input
            type="time"
            value={time}
            onChange={(event) => {
              setTime(event.target.value)
              if (event.target.value) void change(event.target.value)
            }}
            aria-label="Daily reminder at"
            className="bg-transparent text-right text-[11px] text-ink outline-none pointer-coarse:text-[16px]"
          />
        </label>
      )}
      {message && (
        <p role="alert" className="mt-1.5 text-[11px] leading-[1.4] text-ink">
          {message}
        </p>
      )}
    </div>
  )
}
