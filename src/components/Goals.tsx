import { useState } from 'react'
import { type DailyReminder, DEFAULT_TIME } from '../lib/dailyReminder'
import { CALENDAR_DAYS, readCalendar } from '../lib/goal'
import { localDay } from '../lib/time'
import { ReminderError } from '../lib/reminders'

const WEEKS = CALENDAR_DAYS / 7

/**
 * The daily goal and the daily reminder, free, and with Nib Plus a calendar
 * of words written each day for the last 26 weeks on this device. A week to
 * a column, Sunday at the top.
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
  daily?: Pick<DailyReminder, 'time' | 'change'>
  plus: boolean
  onOpenBilling: () => void
  onBack: () => void
}) {
  // Read once on opening: nothing is written while the writer is in here.
  const [calendar] = useState(readCalendar)
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

      {!plus ? (
        <button
          onClick={onOpenBilling}
          className="nib-tap mt-3 flex w-full cursor-pointer items-center justify-between gap-2 text-left text-[11px] text-muted hover:text-ink"
        >
          <span>Words each day, for the last 26 weeks</span>
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
        </>
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
