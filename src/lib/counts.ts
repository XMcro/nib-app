import { useEffect } from 'react'
import { deviceKind, nativeApp } from './platform'
import type { Counted } from './reported'
import { SERVER } from './server'
import { localDay } from './time'

/**
 * Daily totals of which features get used, only for a writer who said yes
 * (components/TellUs, Settings). Each day's totals wait on the device and go
 * once the day is over, with the day, the kind of device and the version, and
 * no id of any kind, so nothing says two days came from one device.
 * Never anything written, nor any title.
 */

const ANSWER_KEY = 'nib-counts-answer'
const COUNTS_KEY = 'nib-counts'

type Kept = Record<string, Partial<Record<Counted, number>>>

/** Null until asked. */
export function countsAnswer(): 'yes' | 'no' | null {
  const answer = localStorage.getItem(ANSWER_KEY)
  return answer === 'yes' || answer === 'no' ? answer : null
}

/** Saying no forgets whatever was waiting to go. */
export function setCountsAnswer(yes: boolean) {
  localStorage.setItem(ANSWER_KEY, yes ? 'yes' : 'no')
  if (!yes) localStorage.removeItem(COUNTS_KEY)
}

function kept(): Kept {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(COUNTS_KEY) ?? '{}')
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? (stored as Kept) : {}
  } catch {
    return {}
  }
}

/** One more of `event` today, if the writer said yes. Never gets in the way of what's being counted. */
export function count(event: Counted, now = Date.now()) {
  try {
    if (countsAnswer() !== 'yes') return
    const all = kept()
    const day = localDay(now)
    const totals = (all[day] ??= {})
    totals[event] = (totals[event] ?? 0) + 1
    localStorage.setItem(COUNTS_KEY, JSON.stringify(all))
  } catch (error) {
    console.warn('Nib: could not keep a count', error)
  }
}

/** Counts `event` each time `when` comes true: a panel opening, a mode going on. */
export function useCounted(when: boolean, event: Counted) {
  useEffect(() => {
    if (when) count(event)
  }, [when, event])
}

/** Sends every finished day that's waiting, one request each. Offline or refused for now, they wait for the next launch. */
export async function sendCounts(now = Date.now()) {
  if (!nativeApp || countsAnswer() !== 'yes') return
  const today = localDay(now)
  for (const day of Object.keys(kept()).sort()) {
    if (day >= today) continue
    const response = await fetch(`${SERVER}/v1/counts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day, device: deviceKind(), version: __APP_VERSION__, counts: kept()[day] }),
    }).catch(() => null)
    if (!response || response.status === 429 || response.status >= 500) return
    // Taken, or refused for good (a day too old): either way it's done with.
    const all = kept()
    delete all[day]
    localStorage.setItem(COUNTS_KEY, JSON.stringify(all))
  }
}
