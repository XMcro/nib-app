/** Shows a count rising from `start` to `to`, easing out, over `span` ms, after `delay`. Returns what stops it. */
export function countUp(start: number, to: number, span: number, delay: number, show: (count: number) => void): () => void {
  let frame = 0
  const wait = window.setTimeout(() => {
    const began = performance.now()
    frame = requestAnimationFrame(function step(now) {
      const t = Math.min(1, (now - began) / span)
      show(Math.round(start + (to - start) * (1 - (1 - t) ** 3)))
      if (t < 1) frame = requestAnimationFrame(step)
    })
  }, delay)
  return () => {
    window.clearTimeout(wait)
    cancelAnimationFrame(frame)
  }
}
