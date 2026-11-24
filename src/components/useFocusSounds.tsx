import { useEffect, useState } from 'react'
import { choose, listenForFocusSounds, mixOf, setMix, SOUNDS, SOUNDS_PLUS, useFocusChoice } from '../lib/focusSounds'
import { FocusSoundsSheet, Speaker } from './FocusSoundsSheet'

type Row = { id: string; label: string; run: () => void }

/**
 * Focus sounds, with Nib Plus (lib/focusSounds): its sheet, its row in
 * Commands, and in focus mode a button that plays or pauses what's chosen,
 * or, with nothing chosen yet, opens the sheet. Nothing plays until asked,
 * and nothing without Plus.
 */
export function useFocusSounds({ features, focusMode }: { features: boolean; focusMode: boolean }) {
  const choice = useFocusChoice()
  const [playing, setPlaying] = useState(false)
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const any = SOUNDS.some((sound) => choice[sound].on)
  // Plus ended: what was playing stopped, and not to start again by itself if it comes back.
  if (!features && playing) setPlaying(false)
  const on = features && playing && any

  useEffect(() => (features ? listenForFocusSounds() : undefined), [features])
  useEffect(() => {
    let live = true
    setMix(on ? mixOf(choice) : {}).then(
      () => live && setFailed(false),
      () => live && setFailed(true),
    )
    return () => {
      live = false
    }
  }, [on, choice])

  return {
    dialog: open && features && <FocusSoundsSheet choice={choice} playing={on} failed={failed} onChoose={choose} onPlaying={setPlaying} onClose={() => setOpen(false)} />,
    button: focusMode && features && (
      <button
        aria-label={on ? 'Pause focus sounds' : 'Play focus sounds'}
        aria-pressed={on}
        onClick={() => (any ? setPlaying(!on) : setOpen(true))}
        className={`nib-tap pointer-events-auto flex size-8 cursor-pointer items-center justify-center rounded-md hover:text-muted ${on ? 'text-muted' : 'text-faint'}`}
      >
        <Speaker on={on} />
      </button>
    ),
    /** Its row, as Plus's rows are (`plusRow`, App). */
    commands: (plusRow: (row: Row, reason: string) => Row[]): Row[] => plusRow({ id: 'focus-sounds', label: 'Focus sounds…', run: () => setOpen(true) }, SOUNDS_PLUS),
  }
}
