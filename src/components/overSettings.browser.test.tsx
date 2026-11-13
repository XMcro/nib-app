import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '../index.css'
import { ImportReport } from './ImportReport'
import { PasswordDialog } from './PasswordDialog'
import { Sheet } from './Sheet'

afterEach(cleanup)

/**
 * An import is started from Settings, which stays open: what the import then
 * shows, the question for a backup's password and the report of what was left
 * out, has to come up over it. Both are drawn before Settings in the app, so
 * at Settings' own level they were under it: seen, in the built app, as a
 * question nobody could answer.
 */
describe('what an import shows while Settings is open', () => {
  // Settings as the app draws it (components/Settings `Screen`), after the dialog as in App.
  const settings = (
    <Sheet label="Settings" onClose={() => {}} overlay="z-50 flex items-center justify-center bg-black/30 phone:items-stretch" className="h-[80vh] w-[min(460px,calc(100vw-2rem))] bg-paper">
      <p>Settings</p>
    </Sheet>
  )
  const onTop = (button: HTMLElement) => {
    const box = button.getBoundingClientRect()
    return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === button
  }

  it('asks for a backup’s password over Settings, where it can be answered', () => {
    render(
      <>
        <PasswordDialog name="colornote-20241014.backup" again={false} onPassword={() => {}} />
        {settings}
      </>,
    )
    expect(onTop(screen.getByRole('button', { name: 'Cancel' }))).toBe(true)
    expect(onTop(screen.getByLabelText('The backup’s password'))).toBe(true)
  })

  it('says what an import left out over Settings, where it can be read', () => {
    render(
      <>
        <ImportReport imported={['note']} skipped={['1 note in Keep’s trash']} onClose={() => {}} />
        {settings}
      </>,
    )
    expect(onTop(screen.getByRole('button', { name: 'OK' }))).toBe(true)
  })
})
