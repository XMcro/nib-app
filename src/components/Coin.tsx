import { useId } from 'react'

/** Nib's nib, as NibMark draws it, centred on a coin's face 64 across. */
const NIB =
  'M31.2 0.1L32.4 0L33.5 0.3L34.3 0.9L34.9 1.6L35.3 2.4L38.6 10.6L40.5 15L43.2 20.1L45.5 24.2L48.2 28.5L52.2 34L55.6 38.1L62.6 46.2L63.2 47L63.7 48.1L64 49.5L63.8 50.9L63.4 52L59.4 57.7L57.1 61.4L55 65.1L52.7 70L50.6 75.2L49.5 78.6L48.2 83.1L47.3 87.6L47 88.1L46.6 88.4L45.9 88.6L33.8 88.8L33.6 88.7L33.5 87.4L33.5 57.8L33.9 57.1L35.7 56L36.5 55.3L37.1 54.6L38 52.8L38.2 51.9L38.2 50.7L38.1 49.6L37.8 48.8L37.3 47.7L36.6 46.9L36 46.3L34.9 45.6L33.8 45.1L32.8 44.9L31.5 44.9L30.2 45.2L28.9 45.7L27.9 46.4L27.2 47.1L26.5 48.3L26 49.6L25.8 50.7L25.8 51.9L26 52.5L26.8 54.3L27.4 55.1L28.4 56L30 57L30.3 57.4L30.4 57.8L30.4 87.3L30.3 88.7L18.4 88.7L17.7 88.6L16.9 88.1L16.6 87.6L15.7 83.1L14.4 78.6L13 74.4L11.2 70L9.3 65.8L7.2 62L4.7 57.9L0.7 52.3L0.2 51L0 49.9L0 48.9L0.3 47.8L1.2 46.3L2.2 45.1L8 38.5L11.4 34.4L14.7 30L18 24.9L21.5 18.9L23.8 14.2L26 9.1L28.8 1.9L29.2 1.3L30 0.6Z'

/** The nib, scaled and placed on a face from (0, 0) to (64, 64). */
function Nib({ fill }: { fill: string }) {
  return (
    <g transform="translate(22.4 16.5) scale(0.3)" fill={fill}>
      <path d={NIB} />
      <rect x={10.5} y={90.1} width={42.9} height={13.3} rx={3.9} />
    </g>
  )
}

/**
 * A Nib coin: gold, a milled rim, and Nib's nib struck on its face. `plain`
 * draws it as a line icon in the text's colour, for the library's header.
 */
export function Coin({ size, plain = false }: { size: number; plain?: boolean }) {
  const id = useId().replace(/[^\w-]/g, '')
  if (plain) {
    return (
      <svg aria-hidden="true" width={size} height={size} viewBox="0 0 64 64" fill="none">
        <circle cx={32} cy={32} r={28} stroke="currentColor" strokeWidth={5} />
        <circle cx={32} cy={32} r={21} stroke="currentColor" strokeWidth={2} strokeDasharray="2 3" opacity={0.6} />
        <Nib fill="currentColor" />
      </svg>
    )
  }
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 64 64" className="block overflow-visible">
      <defs>
        <radialGradient id={`nib-coin-face-${id}`} cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#fff1b8" />
          <stop offset="0.45" stopColor="#f1c443" />
          <stop offset="1" stopColor="#b8860f" />
        </radialGradient>
        <linearGradient id={`nib-coin-rim-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe28a" />
          <stop offset="1" stopColor="#9a6b06" />
        </linearGradient>
      </defs>
      <circle cx={32} cy={32} r={31} fill={`url(#nib-coin-rim-${id})`} />
      <circle cx={32} cy={32} r={31} fill="none" stroke="#8a5d05" strokeOpacity={0.35} strokeWidth={2.4} strokeDasharray="1.3 1.7" />
      <circle cx={32} cy={32} r={25.5} fill={`url(#nib-coin-face-${id})`} />
      <circle cx={32} cy={32} r={25.5} fill="none" stroke="#a87412" strokeOpacity={0.45} strokeWidth={1} />
      {/* Struck into the gold: a shadow below, a highlight above. */}
      <g transform="translate(0.7 1)">
        <Nib fill="#8a5d05" />
      </g>
      <Nib fill="#fff4cc" />
    </svg>
  )
}
