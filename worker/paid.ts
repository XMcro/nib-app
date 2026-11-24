/** Room for a renewal to land when the device that would report it is offline. */
export const GRACE_MS = 7 * 86_400_000

/** Whether what was paid for up to `until` still counts, give or take the grace period. */
export const paidThrough = (until: number, now: number) => until + GRACE_MS > now

/** What's paid for only ever extends: a stale receipt from a second device must not cut short a renewal the first one already reported. */
export const extendsPaid = (current: unknown, until: number) => typeof current !== 'number' || until > current

/** Past the end of what was paid for and its grace, a lapsed library is kept this long, and then it is deleted; and so is what's kept of the subscription itself (worker/subscriber). */
export const KEPT_MONTHS = 12

/** When what stopped being paid for at `ended` is deleted: KEPT_MONTHS past it and its grace. */
export function keptTo(ended: number): number {
  const date = new Date(ended + GRACE_MS)
  date.setUTCMonth(date.getUTCMonth() + KEPT_MONTHS)
  return date.getTime()
}
