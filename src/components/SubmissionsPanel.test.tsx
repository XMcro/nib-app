// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { addSubmission, readSubmissions, replaceSubmissions } from '../lib/submissions'
import { localDay } from '../lib/time'
import { SubmissionsPanel } from './SubmissionsPanel'

const titleOf = (piece: { document: string } | { book: string }) => ('book' in piece ? piece.book : piece.document === 'p' ? 'Salt and weed' : 'Ideas')
const words = (day: string) => {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

beforeEach(() => {
  localStorage.clear()
  replaceSubmissions({})
})
afterEach(cleanup)

describe('a piece’s submissions', () => {
  it('are added where they went, sent today and followed up 90 days on by default', async () => {
    render(<SubmissionsPanel piece={{ document: 'p' }} titleOf={titleOf} onBack={vi.fn()} onOpen={vi.fn()} />)
    expect(screen.getByText(/Not sent anywhere yet/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Add a submission' }))
    const add = screen.getByRole<HTMLButtonElement>('button', { name: 'Add' })
    expect(add.disabled).toBe(true)
    expect(screen.getByLabelText<HTMLInputElement>('Sent').value).toBe(localDay(Date.now()))
    await userEvent.type(screen.getByRole('textbox', { name: 'Where it went' }), 'Granta')
    await userEvent.click(add)
    const [one] = Object.values(readSubmissions())
    expect(one).toMatchObject({ piece: { document: 'p' }, where: 'Granta', sent: localDay(Date.now()), answer: 'waiting' })
    expect(screen.getByText('Granta')).toBeTruthy()
    expect(screen.getByText(`Waiting · sent ${words((one as { sent: string }).sent)} · follow up ${words((one as { followUp: string }).followUp)}`)).toBeTruthy()
  })

  it('are changed when something comes back, and deleted', async () => {
    const id = addSubmission({ document: 'p' }, { where: 'Granta', sent: '2026-09-01', followUp: '2026-12-01' })
    render(<SubmissionsPanel piece={{ document: 'p' }} titleOf={titleOf} onBack={vi.fn()} onOpen={vi.fn()} />)
    await userEvent.click(screen.getByText('Granta'))
    expect(screen.queryByLabelText('When')).toBeNull()
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'What came back' }), 'declined')
    expect(screen.getByLabelText<HTMLInputElement>('When').value).toBe(localDay(Date.now()))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(readSubmissions()[id]).toMatchObject({ answer: 'declined', answered: localDay(Date.now()) })
    expect(screen.getByText(`Declined · sent ${words('2026-09-01')} · ${words(localDay(Date.now()))}`)).toBeTruthy()
    await userEvent.click(screen.getByText('Granta'))
    await userEvent.click(screen.getByRole('button', { name: 'Delete this submission' }))
    expect(readSubmissions()[id]).toMatchObject({ gone: true })
    expect(screen.queryByText('Granta')).toBeNull()
  })
})

describe('without Nib Plus', () => {
  afterEach(cleanup)
  it('those already kept are read, changed and deleted; only adding one asks for Plus', async () => {
    const id = addSubmission({ document: 'p' }, { where: 'Granta', sent: '2026-09-01', followUp: '2026-12-01' })
    const onPlus = vi.fn()
    render(<SubmissionsPanel piece={{ document: 'p' }} titleOf={titleOf} onBack={vi.fn()} onOpen={vi.fn()} onPlus={onPlus} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add a submission' }))
    expect(onPlus).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    await userEvent.click(screen.getByText('Granta'))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'What came back' }), 'accepted')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(readSubmissions()[id]).toMatchObject({ answer: 'accepted' })
    await userEvent.click(screen.getByText('Granta'))
    await userEvent.click(screen.getByRole('button', { name: 'Delete this submission' }))
    expect(readSubmissions()[id]).toMatchObject({ gone: true })
  })
})

describe('every submission', () => {
  it('lists those still waiting first, soonest follow-up first, each with its piece to open, and adds none', async () => {
    addSubmission({ document: 'p' }, { where: 'Declined one', sent: '2026-11-01', answer: 'declined' })
    addSubmission({ document: 'q' }, { where: 'Later', sent: '2026-08-01', followUp: '2027-01-01' })
    addSubmission({ book: 'The Lighthouse' }, { where: 'Sooner', sent: '2026-07-01', followUp: '2026-12-01', answer: 'more' })
    const onOpen = vi.fn()
    render(<SubmissionsPanel titleOf={titleOf} onBack={vi.fn()} onOpen={onOpen} />)
    expect(screen.queryByRole('button', { name: 'Add a submission' })).toBeNull()
    expect([...document.querySelectorAll('li span:first-child')].map((one) => one.textContent)).toEqual(['Sooner', 'Later', 'Declined one'])
    await userEvent.click(screen.getByRole('button', { name: 'Open The Lighthouse' }))
    expect(onOpen).toHaveBeenCalledWith({ book: 'The Lighthouse' })
  })
})
