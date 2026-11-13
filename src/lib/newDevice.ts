/**
 * Whether this device has been welcomed (components/Welcome), which asks
 * whether Nib is on another device, or never needed to be. The key is the
 * one the question asked on its own before the welcome, so no device that
 * answered it is welcomed now.
 */

const ASKED_KEY = 'nib-device-asked'

export function askedAboutDevices(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === '1'
  } catch {
    return true // storage off: it would ask on every launch
  }
}

export function markAskedAboutDevices() {
  try {
    localStorage.setItem(ASKED_KEY, '1')
  } catch {
    // Storage off: not asked again this session, which is all there is.
  }
}
