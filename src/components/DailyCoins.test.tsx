// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DailyCoins } from './DailyCoins'

describe('today’s coins card', () => {
  // It said the coins it came up with, and kept those worked out afresh: another device's yesterday, come meanwhile, made them more.
  it('says the coins kept once collected', async () => {
    render(<DailyCoins login={{ step: 1, coins: 10, rest: 0 }} points={0} subscribed={false} onCollect={() => 20} onClose={() => {}} />)
    expect(screen.getByText('+10')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Collect 10 coins' }))
    expect(screen.getByText('+20')).toBeTruthy()
  })
})
