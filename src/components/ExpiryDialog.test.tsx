// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describeExpiry } from '../lib/expiry'
import { ExpiryDialog } from './ExpiryDialog'

// Noon: the test's days can't change under it.
beforeEach(() => void vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-10T12:00:00') }))
afterEach(() => void vi.useRealTimers())
afterEach(cleanup)

const open = (props: Partial<Parameters<typeof ExpiryDialog>[0]> = {}) => {
  const handlers = { onSet: vi.fn(async () => {}), onClear: vi.fn(async () => {}), onClose: vi.fn() }
  render(<ExpiryDialog what="note" canSet {...handlers} {...props} />)
  return { ...handlers, ...props }
}
const picker = () => screen.getByLabelText<HTMLInputElement>('Expires on')
const set = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Set' })

describe('the expiry date’s dialog', () => {
  it('says what a date does, and that the note can be put back', () => {
    open()
    expect(screen.getByText('On the day you choose, this note moves to the trash, where it can be put back.')).toBeTruthy()
    expect(screen.queryByText('Remove expiry date')).toBeNull()
  })

  it('sets a quick choice, then closes', async () => {
    const { onSet, onClose } = open()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^In a month/ })))
    expect(onSet).toHaveBeenCalledWith('2026-12-10')
    expect(onClose).toHaveBeenCalled()
  })

  it('sets the day picked, from tomorrow on and no earlier', async () => {
    const { onSet } = open()
    expect(picker().min).toBe('2026-11-11')
    for (const early of ['2026-11-10', '2026-01-01', '']) {
      fireEvent.change(picker(), { target: { value: early } })
      expect(set().disabled, early).toBe(true)
    }
    fireEvent.change(picker(), { target: { value: '2027-03-01' } })
    await act(async () => fireEvent.click(set()))
    expect(onSet).toHaveBeenCalledWith('2027-03-01')
  })

  // An iPhone's calendar offers the days before `min` like any others: Set was greyed over one with nothing to say why.
  it('says why a day too early can’t be set, and stops saying it over one that can', () => {
    open()
    const why = () => screen.queryByText('Choose a day from tomorrow on.')
    expect(why()).toBeNull()
    fireEvent.change(picker(), { target: { value: '2026-11-05' } })
    expect(why()).toBeTruthy()
    fireEvent.change(picker(), { target: { value: '2026-11-10' } })
    expect(why()).toBeTruthy()
    fireEvent.change(picker(), { target: { value: '2026-11-11' } })
    expect(why()).toBeNull()
    // Nothing picked isn't a day too early.
    fireEvent.change(picker(), { target: { value: '' } })
    expect(why()).toBeNull()
  })

  it('shows the date already set, in the picker too, and takes it off', async () => {
    const { onClear, onClose } = open({ current: '2026-11-20', what: 'page' })
    expect(screen.getByText(`Expires ${describeExpiry('2026-11-20')}. On that day this page moves to the trash, where it can be put back.`)).toBeTruthy()
    expect(picker().value).toBe('2026-11-20')
    await act(async () => fireEvent.click(screen.getByText('Remove expiry date')))
    expect(onClear).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('stays open and says so when the date can’t be kept', async () => {
    const { onClose } = open({ onSet: vi.fn(async () => Promise.reject(new Error('full'))) })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^In a week/ })))
    expect(screen.getByRole('alert').textContent).toBe('Couldn’t set the date.')
    expect(onClose).not.toHaveBeenCalled()
  })

  // Nib Plus has ended: a date set then still stands, and can be taken off; a new one can't be set.
  it('without Nib Plus, shows a date there is and takes it off, and sets none', async () => {
    const { onClear } = open({ current: '2026-11-20', canSet: false })
    expect(screen.queryByLabelText('Expires on')).toBeNull()
    expect(screen.queryByRole('button', { name: /^In a week/ })).toBeNull()
    expect(screen.getByText('Setting or changing a date is part of Nib Plus.')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByText('Remove expiry date')))
    expect(onClear).toHaveBeenCalled()
  })
})
