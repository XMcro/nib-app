// @vitest-environment jsdom
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describeReminder, ReminderError, suggestedTimes, toLocalInput } from '../lib/reminders'
import { ReminderDialog } from './ReminderDialog'

afterEach(cleanup)

const open = (props: Partial<Parameters<typeof ReminderDialog>[0]> = {}) => {
  const handlers = { onSet: vi.fn(async () => {}), onClear: vi.fn(async () => {}), onClose: vi.fn() }
  render(<ReminderDialog {...handlers} {...props} />)
  return { ...handlers, ...props }
}

describe('a reminder that repeats, in its dialog', () => {
  const repeats = () => screen.getByLabelText<HTMLSelectElement>('Repeat')

  it('is offered daily, weekly, monthly or yearly, and set with the time chosen', async () => {
    const { onSet } = open()
    expect([...repeats().options].map((option) => option.textContent)).toEqual(['Doesn’t repeat', 'Daily', 'Weekly', 'Monthly', 'Yearly'])
    expect(repeats().value).toBe('')
    fireEvent.change(repeats(), { target: { value: 'week' } })
    const first = suggestedTimes()[0]
    await act(async () => fireEvent.click(screen.getByText(first.label)))
    expect(onSet).toHaveBeenCalledWith(first.at, 'week')
  })

  it('shows how the one set repeats, and sets it again another way at the time picked', async () => {
    const at = new Date(Date.now() + 2 * 86_400_000).setHours(7, 15, 0, 0)
    const { onSet } = open({ current: at, repeat: 'month' })
    expect(screen.getByText(/, monthly\. It rings on every device/)).toBeTruthy()
    expect(repeats().value).toBe('month')
    fireEvent.change(repeats(), { target: { value: '' } })
    await act(async () => fireEvent.click(screen.getByText('Set')))
    expect(onSet).toHaveBeenCalledWith(at, null)
  })
})

describe('a reminder snoozed on this device, in its dialog', () => {
  it('says until when, and can be removed though the note’s own time has passed', async () => {
    const until = Date.now() + 3_600_000
    const { onClear } = open({ snoozed: until })
    expect(screen.getByText(new RegExp(`^Snoozed on this device until ${describeReminder(until).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.`))).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByText('Remove reminder')))
    expect(onClear).toHaveBeenCalled()
  })

  it('says both for one that repeats', () => {
    open({ current: Date.now() + 86_400_000, repeat: 'day', snoozed: Date.now() + 3_600_000 })
    expect(screen.getByText(/, daily\. It rings on every device/)).toBeTruthy()
    expect(screen.getByText(/^Snoozed on this device until /)).toBeTruthy()
  })
})

describe('ReminderDialog', () => {
  it('says where it rings, and that this device won’t when its notifications are off', () => {
    open({ current: Date.now() + 3_600_000 })
    expect(screen.getByText(/It rings on every device your library is on\.$/)).toBeTruthy()
    expect(screen.queryByText(/Not on this one/)).toBeNull()
    cleanup()
    open({ current: Date.now() + 3_600_000, silentHere: true })
    expect(screen.getByText('Not on this one: notifications are off for Nib here. Turn them on in Settings, under Notifications.')).toBeTruthy()
  })


  it('sets a quick choice, then closes', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-04T12:00:00') }) // noon: the test's days can't change under it
    onTestFinished(() => void vi.useRealTimers())
    const { onSet, onClose } = open()
    const first = suggestedTimes()[0]
    await act(async () => fireEvent.click(screen.getByText(first.label)))
    expect(onSet).toHaveBeenCalledWith(first.at, null)
    expect(onClose).toHaveBeenCalled()
  })

  it('sets the time picked, read as local time', async () => {
    const { onSet } = open()
    const when = new Date(Date.now() + 2 * 86_400_000).setHours(7, 15, 0, 0)
    fireEvent.change(screen.getByLabelText('Remind me at'), { target: { value: toLocalInput(when) } })
    await act(async () => fireEvent.click(screen.getByText('Set')))
    expect(onSet).toHaveBeenCalledWith(when, null)
  })

  it('stays open and says why when notifications are off', async () => {
    const onSet = vi.fn(async () => Promise.reject(new ReminderError('denied', 'Notifications are off for Nib.')))
    const { onClose } = open({ onSet })
    await act(async () => fireEvent.click(screen.getByText('Set')))
    expect(screen.getByRole('alert').textContent).toBe('Notifications are off for Nib.')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('offers removal only when a reminder is set', async () => {
    open()
    expect(screen.queryByText('Remove reminder')).toBeNull()
    cleanup()
    const { onClear } = open({ current: Date.now() + 3_600_000 })
    expect(screen.getByText(/^Set for /)).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByText('Remove reminder')))
    expect(onClear).toHaveBeenCalled()
  })
})
