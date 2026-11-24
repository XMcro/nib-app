import { useState } from 'react'
import type { Item } from '../db/db'
import { useCounted } from '../lib/counts'
import { describeReminder, forget, remind, reminderOf, remindersAvailable, repeatWord, silentHere, snoozedFor, useReminders } from '../lib/reminders'
import { ReminderDialog } from './ReminderDialog'

const REPEAT_PLUS = 'A reminder that comes again, daily, weekly, monthly or yearly, is part of Nib Plus. One that rings once is free.'

/** The open document's reminder (lib/reminders): its dialog, the row under its text, and its row in the palette. In the app, which is what can ring. */
export function useDocumentReminder(activeItem: Item | undefined, focusMode: boolean, plus: { features: boolean; askPlus: (reason: string) => void }) {
  const [reminding, setReminding] = useState(false)
  useReminders()
  useCounted(reminding, 'reminder_opened')
  const current = remindersAvailable ? reminderOf(activeItem) : undefined
  // Put off from its notification, on this device: it waits though the note's own time has passed.
  const snoozed = remindersAvailable && activeItem ? snoozedFor(activeItem.id) : undefined
  const set = current !== undefined || snoozed !== undefined
  return {
    dialog: reminding && activeItem && (
      <ReminderDialog
        current={current}
        repeat={activeItem.reminder?.repeat}
        snoozed={snoozed}
        silentHere={current !== undefined && silentHere()}
        repeats={plus.features}
        onPlus={() => {
          setReminding(false)
          plus.askPlus(REPEAT_PLUS)
        }}
        // A locked note's title is sealed with it, and a notification shows on the lock screen: `remind` says "A locked note".
        onSet={(at, repeat) => remind(activeItem, at, repeat)}
        onClear={() => forget(activeItem.id)}
        onClose={() => setReminding(false)}
      />
    ),
    row: set && !focusMode && (
      <button
        onClick={() => setReminding(true)}
        className="nib-tap mt-10 cursor-pointer text-[12px] text-muted hover:text-ink"
      >
        Reminder · {describeReminder((snoozed ?? current)!)}
        {snoozed !== undefined ? ' · snoozed' : repeatWord(activeItem?.reminder) && ` · ${repeatWord(activeItem?.reminder)}`}
      </button>
    ),
    /** Its row in the palette, with a document open and where reminders can ring. */
    commands: activeItem && remindersAvailable ? [{ id: 'remind', label: set ? 'Change reminder…' : 'Remind me…', run: () => setReminding(true) }] : [],
  }
}
