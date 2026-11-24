import { readJson, writeJson } from './jsonStorage'
import { macApp } from './platform'

/**
 * Invitations to write (lib/invitations) on or off, and whether they've been
 * offered: on their own, so what asks (lib/feedback askDue) needn't bring in
 * all that works them out.
 */

const ON_KEY = 'nib-invitations'
const ASKED_KEY = 'nib-invitations-asked'

/**
 * Where there are invitations: on iPhone and iPad, not the Mac. Each device
 * counts its own writing, so a writer with both had one on each, a day; and
 * the phone is where a nudge back to the page is wanted.
 */
export const invitationsHere = !macApp

/** On, from Settings or their offer (offered once, on its own, as promotional notifications are: App Store guideline 4.5.4). Off till then. */
export const invitationsOn = () => invitationsHere && readJson<boolean>(ON_KEY, false) === true
export const setInvitationsOn = (on: boolean) => {
  writeJson(ON_KEY, on)
  writeJson(ASKED_KEY, true)
}
/** Offered already, whatever the answer, or set in Settings: not offered again (lib/feedback askDue). */
export const invitationsAsked = () => readJson<boolean>(ASKED_KEY, false) === true
export const declineInvitations = () => writeJson(ASKED_KEY, true)
