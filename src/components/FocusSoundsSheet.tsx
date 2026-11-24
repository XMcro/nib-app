import { SOUNDS, type Choice, type Sound } from '../lib/focusSounds'
import { touchApp } from '../lib/platform'
import { Sheet } from './Sheet'

const SOUND_NAMES: Record<Sound, string> = { rain: 'Rain', cafe: 'Café', fire: 'Fire', typewriter: 'Typewriter keys' }

/**
 * Focus sounds (lib/focusSounds): Play or Pause, and each sound on or off at
 * its volume, as this device keeps them. Turning one on plays it. A change is
 * heard as it's made.
 */
export function FocusSoundsSheet({ choice, playing, failed, onChoose, onPlaying, onClose }: {
  choice: Choice
  /** Playing what's chosen now. */
  playing: boolean
  /** One of them couldn't be played. */
  failed: boolean
  onChoose: (sound: Sound, changes: Partial<Choice[Sound]>) => void
  onPlaying: (playing: boolean) => void
  onClose: () => void
}) {
  const any = SOUNDS.some((sound) => choice[sound].on)
  return (
    <Sheet label="Focus sounds" onClose={onClose} className="nib-pop h-fit w-[min(400px,90vw)] rounded-lg border border-line bg-paper p-4">
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-medium">Focus sounds</div>
        <button
          disabled={!any}
          aria-pressed={playing && any}
          onClick={() => onPlaying(!(playing && any))}
          className="nib-tap cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper disabled:cursor-default disabled:opacity-50 pointer-coarse:py-2.5"
        >
          {playing && any ? 'Pause' : 'Play'}
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-1">
        {SOUNDS.map((sound) => (
          <div key={sound} className="flex items-center gap-3 py-1 pointer-coarse:py-2">
            <label className="flex w-[128px] shrink-0 cursor-pointer items-center gap-2 text-[12px] text-ink">
              <input
                type="checkbox"
                checked={choice[sound].on}
                onChange={(event) => {
                  onChoose(sound, { on: event.target.checked })
                  if (event.target.checked) onPlaying(true)
                }}
              />
              {SOUND_NAMES[sound]}
            </label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              aria-label={`${SOUND_NAMES[sound]} volume`}
              disabled={!choice[sound].on}
              value={choice[sound].volume}
              onChange={(event) => onChoose(sound, { volume: Number(event.target.value) })}
              className="min-w-0 flex-1 cursor-pointer accent-current disabled:cursor-default disabled:opacity-40"
            />
          </div>
        ))}
      </div>

      {failed && (
        <p role="alert" className="mt-2 text-[12px] text-ink">
          Couldn’t play one of the sounds. Try turning it off and on again.
        </p>
      )}

      <p className="mt-3 text-[10.5px] leading-[1.5] text-faint">
        They play on this device, never by themselves when Nib opens, and stop while it’s off the screen.
        {touchApp && ' Rain, the café and the fire play with the ring switch on silent, and pause music from other apps; typewriter keys on their own follow the switch.'}
      </p>

      <div className="mt-3 flex border-t border-line pt-3">
        <span className="flex-1" />
        <button onClick={onClose} className="nib-tap cursor-pointer text-[12px] text-muted hover:text-ink">
          Close
        </button>
      </div>
    </Sheet>
  )
}

/** A speaker, sounding while they play. */
export function Speaker({ on }: { on: boolean }) {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 5 6 9H3v6h3l5 4z" />
      {on && (
        <>
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </>
      )}
    </svg>
  )
}
