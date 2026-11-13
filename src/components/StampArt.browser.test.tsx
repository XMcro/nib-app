import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import '../index.css'
import { stampFor } from '../lib/rewards'
import type { Rarity } from '../lib/stampbook'
import { MOTIFS } from '../lib/stampWords'
import { StampArt } from './StampArt'

/** Each rarity's finish (components/StampArt), as drawn: plain, patterned, framed, gold, shimmering. */

const draw = (rarity: Rarity, width = 120, ground = rarity === 'common' ? ('plain' as const) : ('dots' as const)) =>
  render(<StampArt stamp={{ ...stampFor('2026-11-04'), rarity, ground }} width={width} />).container.querySelector('svg')!

afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.motion
})

describe('StampArt', () => {
  it('prints NIB in the corners', () => {
    expect(draw('common').textContent).toContain('NIB')
  })

  it('is patterned from rare up, and framed twice with corner diamonds from unique up', () => {
    expect(draw('common').querySelector('pattern')).toBeNull()
    expect(draw('rare').querySelector('pattern')).not.toBeNull()
    const frames = (rarity: Rarity) => draw(rarity).querySelectorAll('rect').length
    expect(frames('unique')).toBeGreaterThan(frames('rare'))
  })

  it('is in gold foil when legendary, and in a rainbow that moves when mythic', () => {
    expect(draw('legendary').querySelector('linearGradient stop')).not.toBeNull()
    expect(draw('mythic').querySelector('animateTransform, animate')).not.toBeNull()
  })

  it('keeps the mythic shimmer still with Motion at none', () => {
    document.documentElement.dataset.motion = 'none'
    const mythic = draw('mythic')
    expect(mythic.querySelector('animateTransform')).toBeNull()
    expect(mythic.querySelectorAll('path > animate')).toHaveLength(0)
  })

  it('drops the fine print and the ground when too small to read them', () => {
    const small = draw('rare', 30)
    expect(small.querySelector('pattern')).toBeNull()
    expect(small.textContent).not.toContain('NIB')
    expect(small.getAttribute('data-rarity')).toBe('rare')
  })

  it('draws every motif about the middle of its stamp', () => {
    // Each drawing is placed by its 0 0; a box whose middle is more than three quarters of a unit from that shows as off-centre.
    const off = MOTIFS.filter((_, motif) => {
      const box = render(<StampArt stamp={{ ...stampFor('2026-11-04'), motif }} width={120} />).container.querySelector<SVGPathElement>('path[transform="translate(30 31)"]')!.getBBox()
      cleanup()
      return Math.max(Math.abs(box.x + box.width / 2), Math.abs(box.y + box.height / 2)) > 0.75
    })
    expect(off).toEqual([])
  })
})
