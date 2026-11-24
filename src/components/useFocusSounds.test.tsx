// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { choose, SOUNDS, SOUNDS_PLUS, type Mix } from '../lib/focusSounds'
import { useFocusSounds } from './useFocusSounds'

/** Focus sounds' sheet, its Commands row and focus mode's button (components/useFocusSounds), with the player stood in for (lib/focusSounds has its own tests). */

const at = vi.hoisted(() => ({ mixes: [] as Mix[], fail: false, listening: 0 }))
vi.mock('../lib/focusSounds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/focusSounds')>()),
  setMix: async (mix: Mix) => {
    at.mixes.push(mix)
    if (at.fail) throw new Error('offline')
  },
  listenForFocusSounds: () => {
    at.listening += 1
    return () => (at.listening -= 1)
  },
}))

function Harness({ features, focusMode = true }: { features: boolean; focusMode?: boolean }) {
  const sounds = useFocusSounds({ features, focusMode })
  // As App's plusRow: the row itself with Plus, and without it one that asks for Plus.
  const rows = sounds.commands((row, reason) => [features ? row : { ...row, label: `${row.label} (${reason})` }])
  return (
    <>
      {sounds.button}
      {rows.map((row) => (
        <button key={row.id} onClick={row.run}>
          {row.label}
        </button>
      ))}
      {sounds.dialog}
    </>
  )
}

const playing = () => at.mixes.at(-1)

beforeEach(() => {
  at.mixes = []
  at.fail = false
  for (const sound of SOUNDS) choose(sound, { on: false, volume: 0.6 })
})
afterEach(cleanup)

describe('focus sounds, for the writer (components/useFocusSounds)', () => {
  it('without Plus: its row asks for Plus, focus mode has no button, and nothing listens or plays', () => {
    render(<Harness features={false} />)
    expect(screen.getByRole('button', { name: `Focus sounds… (${SOUNDS_PLUS})` })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /focus sounds$/ })).toBeNull()
    expect(at.listening).toBe(0)
    expect(at.mixes).toEqual([{}])
  })

  it('opens from Commands, plays a sound as it’s turned on, at its volume as that’s moved, and pauses', async () => {
    render(<Harness features focusMode={false} />)
    expect(screen.queryByRole('button', { name: 'Play focus sounds' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Focus sounds…' }))
    expect(screen.getByRole('button', { name: 'Play' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('slider', { name: 'Rain volume' }).hasAttribute('disabled')).toBe(true)

    await userEvent.click(screen.getByRole('checkbox', { name: 'Rain' }))
    await waitFor(() => expect(playing()).toEqual({ rain: 0.6 }))
    fireEvent.change(screen.getByRole('slider', { name: 'Rain volume' }), { target: { value: '0.3' } })
    await userEvent.click(screen.getByRole('checkbox', { name: 'Typewriter keys' }))
    await waitFor(() => expect(playing()).toEqual({ rain: 0.3, typewriter: 0.6 }))

    await userEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(playing()).toEqual({}))
    await userEvent.click(screen.getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(playing()).toEqual({ rain: 0.3, typewriter: 0.6 }))
  })

  it('in focus mode, its button plays and pauses what’s chosen, or with nothing chosen opens the sheet', async () => {
    render(<Harness features />)
    await userEvent.click(screen.getByRole('button', { name: 'Play focus sounds' }))
    expect(screen.getByRole('dialog', { name: 'Focus sounds' })).toBeTruthy()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Fire' }))
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))

    await userEvent.click(screen.getByRole('button', { name: 'Pause focus sounds' }))
    await waitFor(() => expect(playing()).toEqual({}))
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Play focus sounds' }))
    await waitFor(() => expect(playing()).toEqual({ fire: 0.6 }))
  })

  it('keeps the choice for next time, playing nothing until asked', async () => {
    const { unmount } = render(<Harness features />)
    await userEvent.click(screen.getByRole('button', { name: 'Play focus sounds' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Café' }))
    await waitFor(() => expect(playing()).toEqual({ cafe: 0.6 }))
    unmount()

    at.mixes = []
    render(<Harness features />)
    expect(at.mixes).toEqual([{}])
    await userEvent.click(screen.getByRole('button', { name: 'Play focus sounds' }))
    await waitFor(() => expect(playing()).toEqual({ cafe: 0.6 }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('stops when Plus ends, and says when one couldn’t be played', async () => {
    choose('rain', { on: true })
    const { rerender } = render(<Harness features />)
    await userEvent.click(screen.getByRole('button', { name: 'Play focus sounds' }))
    await waitFor(() => expect(playing()).toEqual({ rain: 0.6 }))
    rerender(<Harness features={false} />)
    await waitFor(() => expect(playing()).toEqual({}))
    expect(at.listening).toBe(0)

    at.fail = true
    rerender(<Harness features />)
    await userEvent.click(screen.getByRole('button', { name: 'Focus sounds…' }))
    await userEvent.click(screen.getByRole('button', { name: 'Play' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Couldn’t play one of the sounds')
  })
})
