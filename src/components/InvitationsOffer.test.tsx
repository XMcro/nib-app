// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReminderError } from '../lib/reminders'
import { Goals } from './Goals'
import { InvitationsOffer } from './InvitationsOffer'

afterEach(cleanup)

describe('invitations to write, offered', () => {
  it('turns them on with Yes, says why it couldn’t, and Not now turns them down', async () => {
    const onYes = vi.fn().mockRejectedValueOnce(new ReminderError('denied', 'Notifications are off for Nib. Turn them on in Settings, under Notifications.')).mockResolvedValue(undefined)
    const onNo = vi.fn()
    render(<InvitationsOffer onYes={onYes} onNo={onNo} />)
    expect(screen.getByText('A nudge now and then?')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Yes, nudge me' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Notifications are off for Nib')
    await userEvent.click(screen.getByRole('button', { name: 'Yes, nudge me' }))
    expect(onYes).toHaveBeenCalledTimes(2)
    await userEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onNo).toHaveBeenCalledOnce()
  })
})

describe('invitations to write, in Settings → Goals', () => {
  const daily = (invitations: boolean, changeInvitations = vi.fn().mockResolvedValue(undefined)) => ({ time: null, change: vi.fn(), invitations, changeInvitations })

  it('sit under the daily reminder, switched on and off', async () => {
    const off = daily(false)
    const { unmount } = render(<Goals goal={0} onGoalChange={vi.fn()} daily={off} plus={false} onOpenBilling={vi.fn()} onBack={vi.fn()} />)
    const switches = screen.getAllByRole('switch').map((one) => one.getAttribute('aria-label'))
    expect(switches.indexOf('Invitations to write')).toBe(switches.indexOf('Daily reminder') + 1)
    const toggle = screen.getByRole('switch', { name: 'Invitations to write' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    await userEvent.click(toggle)
    expect(off.changeInvitations).toHaveBeenCalledWith(true)
    unmount()
    const on = daily(true, vi.fn().mockRejectedValue(new ReminderError('denied', 'Notifications are off for Nib.')))
    render(<Goals goal={0} onGoalChange={vi.fn()} daily={on} plus={false} onOpenBilling={vi.fn()} onBack={vi.fn()} />)
    await userEvent.click(screen.getByRole('switch', { name: 'Invitations to write' }))
    expect(on.changeInvitations).toHaveBeenCalledWith(false)
    expect((await screen.findByRole('alert')).textContent).toBe('Notifications are off for Nib.')
  })

  it('aren’t there where notifications can’t ring', () => {
    render(<Goals goal={0} onGoalChange={vi.fn()} plus={false} onOpenBilling={vi.fn()} onBack={vi.fn()} />)
    expect(screen.queryByRole('switch', { name: 'Invitations to write' })).toBeNull()
  })
})
