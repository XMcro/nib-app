import type { CSSProperties } from 'react'

/** Falling pieces, each its own colour, place, speed, drift and spin: `seconds` to twice that to fall, already up to `started` seconds under way. */
export function confetti(count: number, colours: string[], seconds: number, started: number): CSSProperties[] {
  return Array.from({ length: count }, (_, i) => ({
    left: `${Math.random() * 100}%`,
    background: colours[i % colours.length],
    animationDuration: `${seconds + Math.random() * seconds}s`,
    animationDelay: `${-Math.random() * started}s`,
    '--drift': `${-40 + Math.random() * 80}px`,
    '--spin': `${(Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540)}deg`,
  })) as CSSProperties[]
}
