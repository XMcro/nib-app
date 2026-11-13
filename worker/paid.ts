/** Room for a renewal to land when the device that would report it is offline. */
export const GRACE_MS = 7 * 86_400_000

/** Whether what was paid for up to `until` still counts, give or take the grace period. */
export const paidThrough = (until: number, now: number) => until + GRACE_MS > now

/** What's paid for only ever extends: a stale receipt from a second device must not cut short a renewal the first one already reported. */
export const extendsPaid = (current: unknown, until: number) => typeof current !== 'number' || until > current
