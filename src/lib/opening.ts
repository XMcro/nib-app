import { useEffect } from 'react'
import { coveredNow } from './lock'
import { nativeApp } from './platform'

/** The most the line of ink is waited for: it starts once the page is on screen and takes half a second (index.html). */
const LINE_MS = 800

/**
 * The loading screen (index.html's #nib-opening): the launch screen's own
 * frame, up from the first paint till Nib has its lists to show. Then, once
 * its line of ink is drawn, it fades away. Launched locked, it waits behind
 * Lock Nib's cover and plays once that is down. Later calls do nothing.
 */
export function endOpening() {
  const cover = document.getElementById('nib-opening')
  if (!cover || cover.dataset.ending !== undefined) return
  cover.dataset.ending = ''
  if (!nativeApp) return finish(cover)
  void coveredNow().then((locked) => {
    if (!locked) return finish(cover)
    window.addEventListener('nibunlock', () => finish(cover), { once: true })
  })
}

function finish(cover: HTMLElement) {
  // Launched locked, the line was held back till now (index.html).
  cover.classList.add('drawing')
  const fade = () => {
    if (cover.classList.contains('opened')) return
    cover.classList.add('opened')
    // Its fade is 0.35s (index.html).
    setTimeout(() => cover.remove(), 400)
  }
  const line = cover.querySelector('.nib-line path')
  const drawn = cover.classList.contains('drawing') && line?.getAnimations().every((animation) => animation.playState === 'finished')
  if (!line || drawn || matchMedia('(prefers-reduced-motion: reduce)').matches) return fade()
  line.addEventListener('animationend', fade, { once: true })
  setTimeout(fade, LINE_MS)
}

/**
 * The loading screen goes once both lists are here, so Nib never opens on an
 * empty one first; or after a moment regardless, so nothing Nib has to say (a
 * database another tab holds, say) stays behind it.
 */
export function useEndOpening(listed: unknown) {
  useEffect(() => {
    if (listed) endOpening()
  }, [listed])
  useEffect(() => {
    const timer = setTimeout(endOpening, 2000)
    return () => clearTimeout(timer)
  }, [])
}
