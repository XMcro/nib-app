import { touchApp } from './platform'

/** iOS's body text at its default size, in points. */
const BODY = 17
/** At the largest of iOS's ordinary sizes. The Larger Accessibility Sizes go up to three times, and Nib's rows, sheets and fixed-height buttons don't survive that. */
const MOST = 23 / BODY

/**
 * iOS's Larger Text, for Nib's own words: its buttons, rows and sheets. They're
 * set in px, which a root font size doesn't move and a text size adjustment
 * does, and the system's body font says how large iOS is set. Not the writing,
 * which has Customize's size, or the fields, 16 points on touch already
 * (index.css). Nothing on a Mac, which doesn't have the setting, or at iOS's
 * default size or below it. Nothing on an iPad either: its web view, a
 * desktop one, ignores the adjustment.
 */
export function followLargerText() {
  if (!touchApp) return
  const probe = document.createElement('span')
  probe.hidden = true
  probe.style.font = '-apple-system-body'
  // Or it reads as scaled by what this sets, and grows each time it's read.
  probe.style.setProperty('-webkit-text-size-adjust', '100%')
  document.body.append(probe)
  const follow = () => {
    const scale = Math.min(parseFloat(getComputedStyle(probe).fontSize) / BODY, MOST)
    if (scale > 1) document.documentElement.style.setProperty('-webkit-text-size-adjust', `${Math.round(scale * 100)}%`)
    else document.documentElement.style.removeProperty('-webkit-text-size-adjust')
  }
  follow()
  // Changed in Settings while Nib was away.
  document.addEventListener('visibilitychange', follow)
}
