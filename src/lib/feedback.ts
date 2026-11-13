import { buddyAsked } from './buddy'
import { countsAnswer } from './counts'
import { keychain } from './keychain'
import { CANT_REACH } from './notices'
import { deviceKind, nativeApp } from './platform'
import { FEEDBACK_MAX, FEEDBACK_MIN } from './reported'
import { SERVER } from './server'

/**
 * Feedback, kept on Nib's server until it's read (worker/feedback), and what
 * Nib asks unprompted: once, on the second launch, whether it may send counts
 * (lib/counts); once, from the third, for feedback, with two weeks of Plus's
 * features for the first message. The offer and the gift are remembered in the
 * Keychain, which outlives the app, so deleting and downloading Nib again
 * brings neither back (NibKeychainPlugin's lasting entries). The answer about
 * counts lives with the app, and goes with it.
 */

const LAUNCHES_KEY = 'nib-launches'
export const ASK_COUNTS_AT = 2
export const OFFER_FEEDBACK_AT = 3
/** A launch after feedback's: a writer who updates has passed both, and meets the writing buddy at the next launch. */
export const OFFER_BUDDY_AT = 4
const OFFERED = 'feedback-offered'
const GIFTED = 'feedback-gifted'

export function launches(): number {
  const n = Number(localStorage.getItem(LAUNCHES_KEY))
  return Number.isInteger(n) && n > 0 ? n : 0
}

/** Once, as Nib starts. */
export function countLaunch() {
  localStorage.setItem(LAUNCHES_KEY, String(launches() + 1))
}

/** Whether it's been recorded on this device, ever. Unknown counts as yes: better not to ask than to ask twice. */
const happened = (key: string) =>
  keychain
    .get({ key, lasting: true })
    .then(({ value }) => value !== null)
    .catch(() => true)

const remember = (key: string) => keychain.set({ key, value: '1', lasting: true }).catch((error: unknown) => console.warn('Nib: could not remember', key, error))

export const rememberOffered = () => remember(OFFERED)
export const rememberGifted = () => remember(GIFTED)
export const giftStillOpen = async () => nativeApp && !(await happened(GIFTED))

/** What's due to be asked at this launch, at most one. Last, the writing buddy (lib/buddy), once, with nothing else to ask. */
export async function askDue(): Promise<'counts' | 'feedback' | 'buddy' | null> {
  const n = launches()
  if (n >= ASK_COUNTS_AT && countsAnswer() === null) return 'counts'
  if (n >= OFFER_FEEDBACK_AT && !(await happened(OFFERED))) return 'feedback'
  if (n >= OFFER_BUDDY_AT && !buddyAsked()) return 'buddy'
  return null
}

export const feedbackLength = (text: string) => [...text.trim()].length
export const feedbackFits = (text: string) => feedbackLength(text) >= FEEDBACK_MIN && feedbackLength(text) <= FEEDBACK_MAX

export class FeedbackError extends Error {}

/** Resolves once the server has kept it; throws a FeedbackError saying what to tell the writer. */
export async function sendFeedback(text: string) {
  const response = await fetch(`${SERVER}/v1/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: text.trim(), device: deviceKind(), version: __APP_VERSION__ }),
  }).catch(() => null)
  if (!response) throw new FeedbackError(CANT_REACH)
  if (response.status === 429) throw new FeedbackError('Too many messages from here today. Please try again tomorrow.')
  if (!response.ok) throw new FeedbackError('That didn’t send. Please try again in a little while.')
}
