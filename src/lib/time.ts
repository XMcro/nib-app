const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

/**
 * A time Nib could have made, from 1970 to as late as a Date goes: taken
 * from sync, a backup, an import, iCloud or the server only if so. Any
 * other number is finite, but showing it throws, on every launch.
 */
export const isTime = (value: unknown): value is number => typeof value === 'number' && value >= 0 && value <= 8.64e15

/** A day as Nib writes them, `YYYY-MM-DD`: a month of 01 to 12, a date of 01 to 31. */
export const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)

export function startOfDay(ms: number): number {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

// Made once each: a formatter costs far more to build than to use, and the
// library dates every card it draws.
const formats = new Map<string, Intl.DateTimeFormat>()
function format(ts: number, options: Intl.DateTimeFormatOptions): string {
  // Stored before times were checked, and shown blank rather than not at all.
  if (!isTime(ts)) return ''
  const key = JSON.stringify(options)
  let made = formats.get(key)
  if (!made) formats.set(key, (made = new Intl.DateTimeFormat(undefined, options)))
  return made.format(ts)
}

/** now · 12m ago · 2h ago · yesterday · Tuesday · last week · March · Mar 2025 */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts
  if (diff < 45_000) return 'now'
  if (diff < HOUR) return `${Math.max(1, Math.floor(diff / MINUTE))}m ago`

  const days = Math.round((startOfDay(now) - startOfDay(ts)) / DAY)
  if (days === 0) return `${Math.floor(diff / HOUR)}h ago`
  if (days === 1) return 'yesterday'
  if (days < 7) return format(ts, { weekday: 'long' })
  if (days < 14) return 'last week'
  if (new Date(ts).getFullYear() === new Date(now).getFullYear()) {
    return format(ts, { month: 'long' })
  }
  return format(ts, { month: 'short', year: 'numeric' })
}

/** When exactly: Today, 4:12 PM · Yesterday, 9:03 AM · Mon, Nov 2, 4:12 PM · Oct 20, 4:12 PM · Nov 2, 2025, 4:12 PM */
export function momentOf(ts: number, now: number = Date.now()): string {
  const time = format(ts, { hour: 'numeric', minute: '2-digit' })
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / DAY)
  if (days === 0) return `Today, ${time}`
  if (days === 1) return `Yesterday, ${time}`
  if (days > 1 && days < 7) return `${format(ts, { weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`
  const thisYear = new Date(ts).getFullYear() === new Date(now).getFullYear()
  return `${format(ts, thisYear ? { month: 'short', day: 'numeric' } : { year: 'numeric', month: 'short', day: 'numeric' })}, ${time}`
}

/** A day as the writer's calendar has it: `YYYY-MM-DD` read as local, not UTC. */
export function dateOf(day: string): Date {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date)
}

/** A day as the writer would put it, in their own order: "Jun 12" or "12 Jun". */
export const shortDay = (day: string) => dateOf(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

/** "3 December", in the writer's own order. */
export const dayMonth = (day: string) => dateOf(day).toLocaleDateString(undefined, { day: 'numeric', month: 'long' })

/** A day, `YYYY-MM-DD`, as the writer's calendar has it, with its year. */
export const longDay = (day: string) => dateOf(day).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })

/** The writer's calendar day, not UTC's. */
export function localDay(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
