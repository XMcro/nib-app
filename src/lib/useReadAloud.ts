import { useEffect, useRef, useState, type RefObject } from 'react'
import type { Editor as TiptapEditor } from '@tiptap/react'
import { foldedAway } from '../editor/fold'
import { showReading } from '../editor/reading'
import { count } from './counts'
import { canReadAloud, readAloud, savedRate, saveRate, toRead, type Reader } from './readAloud'

/** Read aloud (lib/readAloud), from starting it to all that stops it: the bar's props (components/ReadingBar) and its row in the palette with it. */
export function useReadAloud(editorRef: RefObject<TiptapEditor | null>, docKey: string, setNotice: (notice: string) => void, covered: boolean) {
  // While it reads.
  const [reading, setReading] = useState<false | 'on' | 'paused'>(false)
  const reader = useRef<Reader | null>(null)
  const [rate, setRate] = useState(savedRate)

  /** Read aloud from the caret, or the words selected (lib/readAloud). */
  function startReading() {
    const editor = editorRef.current
    const sentences = editor ? toRead(editor.state.doc, editor.state.selection, foldedAway(editor.state)) : []
    if (!editor || !sentences.length) return setNotice('There’s nothing here to read.')
    count('read_aloud')
    reader.current?.stop()
    setReading('on')
    reader.current = readAloud(sentences, {
      rate,
      onSentence: (index) => showReading(editor, sentences[index]),
      onEnd: (finished) => {
        reader.current = null
        setReading(false)
        showReading(editor, null)
        if (!finished) setNotice('Nib couldn’t read aloud just then.')
      },
    })
  }

  function stopReading() {
    reader.current?.stop()
    reader.current = null
    setReading(false)
    if (editorRef.current) showReading(editorRef.current, null)
  }

  function changeRate(next: number) {
    setRate(next)
    saveRate(next)
    reader.current?.setRate(next)
  }

  // It stops with the document it was reading, and when Nib leaves the screen.
  useEffect(() => stopReading, [docKey])
  // And when the library comes over the text: its bar goes under with it, and the voice went on with nothing to stop it.
  useEffect(() => {
    if (covered && reader.current) stopReading()
  }, [covered])
  // And when Lock Nib covers it: on a Mac the window stays on the screen, so it isn't hidden, and went on reading aloud behind the cover.
  useEffect(() => {
    if (!reading) return
    const onHidden = () => document.visibilityState === 'hidden' && stopReading()
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('niblock', stopReading)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('niblock', stopReading)
    }
  }, [reading])
  // And with a tap in the text, or any change to it: the writer has heard something to fix.
  useEffect(() => {
    const editor = editorRef.current
    if (!reading || !editor) return
    const text = editor.view.dom
    text.addEventListener('pointerdown', stopReading)
    editor.on('update', stopReading)
    return () => {
      text.removeEventListener('pointerdown', stopReading)
      editor.off('update', stopReading)
    }
  }, [reading])

  return {
    reading,
    /** ReadingBar's props, all but where it goes. */
    bar: {
      paused: reading === 'paused',
      rate,
      onPause: () => {
        reader.current?.pause()
        setReading('paused')
      },
      onResume: () => {
        reader.current?.resume()
        setReading('on')
      },
      onRate: changeRate,
      onStop: stopReading,
    },
    /** Its row in the palette, where the device can read aloud. */
    commands: canReadAloud ? [reading ? { id: 'read-stop', label: 'Stop reading', run: stopReading } : { id: 'read-aloud', label: 'Read aloud', run: startReading }] : [],
  }
}
