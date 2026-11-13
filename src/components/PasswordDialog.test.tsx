// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PasswordDialog } from './PasswordDialog'

afterEach(cleanup)

const open = (again = false) => {
  const onPassword = vi.fn()
  render(<PasswordDialog name="colornote-20241014.backup" again={again} onPassword={onPassword} />)
  return onPassword
}
const field = () => screen.getByLabelText<HTMLInputElement>('The backup’s password')

describe('the dialog that asks for a backup’s password', () => {
  it('names the file, says whose password it is and what Nib does with it, and hides what is typed', () => {
    open()
    expect(screen.getByText('colornote-20241014.backup')).toBeTruthy()
    expect(screen.getByText(/your ColorNote master password/)).toBeTruthy()
    expect(screen.getByText(/on this device/)).toBeTruthy()
    expect(screen.getByText(/doesn’t keep it/)).toBeTruthy()
    expect(field().type).toBe('password')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('hands over the password as typed, spaces and all, and nothing until there is one', () => {
    const onPassword = open()
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Open' })
    expect(submit.disabled).toBe(true)
    fireEvent.change(field(), { target: { value: ' my pass ' } })
    fireEvent.click(submit)
    expect(onPassword).toHaveBeenCalledTimes(1)
    expect(onPassword).toHaveBeenCalledWith(' my pass ')
  })

  it('hands over no password when it is cancelled', () => {
    const onPassword = open()
    fireEvent.change(field(), { target: { value: 'typed and thought better of' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onPassword).toHaveBeenCalledTimes(1)
    expect(onPassword).toHaveBeenCalledWith(null)
  })

  it('says the last password didn’t open it, when asked again', () => {
    open(true)
    expect(screen.getByRole('alert').textContent).toBe('That password didn’t open it.')
  })
})
