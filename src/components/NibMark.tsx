import type { ReactNode, SVGProps } from 'react'

/**
 * The nib of the app icon, traced from it (brand/nib-icon-source.webp), as
 * the launch and loading screens draw it (LaunchScreen.storyboard,
 * index.html): its body, and the collar below. In the text's colour.
 * `children`: drawn over it, in its 64 by 103.4 box, as the writing buddy's
 * face is (components/Buddy). Anything else is the svg's, as the buddy's mood is.
 */
export function NibMark({ className, children, ...rest }: { className?: string; children?: ReactNode } & Omit<SVGProps<SVGSVGElement>, 'viewBox' | 'fill'>) {
  return (
    <svg aria-hidden="true" viewBox="0 0 64 103.4" className={className} fill="currentColor" {...rest}>
      <path d={BODY} />
      <rect x={10.5} y={90.1} width={42.9} height={13.3} rx={3.9} />
      {children}
    </svg>
  )
}

export const BODY =
  'M31.2 0.1L32.4 0L33.5 0.3L34.3 0.9L34.9 1.6L35.3 2.4L38.6 10.6L40.5 15L43.2 20.1L45.5 24.2L48.2 28.5L52.2 34L55.6 38.1L62.6 46.2L63.2 47L63.7 48.1L64 49.5L63.8 50.9L63.4 52L59.4 57.7L57.1 61.4L55 65.1L52.7 70L50.6 75.2L49.5 78.6L48.2 83.1L47.3 87.6L47 88.1L46.6 88.4L45.9 88.6L33.8 88.8L33.6 88.7L33.5 87.4L33.5 57.8L33.9 57.1L35.7 56L36.5 55.3L37.1 54.6L38 52.8L38.2 51.9L38.2 50.7L38.1 49.6L37.8 48.8L37.3 47.7L36.6 46.9L36 46.3L34.9 45.6L33.8 45.1L32.8 44.9L31.5 44.9L30.2 45.2L28.9 45.7L27.9 46.4L27.2 47.1L26.5 48.3L26 49.6L25.8 50.7L25.8 51.9L26 52.5L26.8 54.3L27.4 55.1L28.4 56L30 57L30.3 57.4L30.4 57.8L30.4 87.3L30.3 88.7L18.4 88.7L17.7 88.6L16.9 88.1L16.6 87.6L15.7 83.1L14.4 78.6L13 74.4L11.2 70L9.3 65.8L7.2 62L4.7 57.9L0.7 52.3L0.2 51L0 49.9L0 48.9L0.3 47.8L1.2 46.3L2.2 45.1L8 38.5L11.4 34.4L14.7 30L18 24.9L21.5 18.9L23.8 14.2L26 9.1L28.8 1.9L29.2 1.3L30 0.6Z'
