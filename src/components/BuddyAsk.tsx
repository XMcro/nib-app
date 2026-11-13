import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ask, know, MY_STORY, related, TOPICS, wordsOf, type Answer, type Knowledge, type Topic } from '../buddy/search'
import { keepInkwell } from '../lib/buddy'
import { inkwellStamp } from '../lib/keepsakes'
import { touchApp } from '../lib/platform'
import { localDay } from '../lib/time'
import { StampArt } from './StampArt'
import type { Mood } from './Buddy'

const chip = 'nib-tap cursor-pointer rounded-full border border-line px-2.5 py-1 text-[12px] text-ink hover:bg-item-hover'
const link = 'nib-tap cursor-pointer text-[12px] text-muted hover:text-ink'

/**
 * Asking the writing buddy (buddy/search): a question in your own words and
 * the answer it's closest to, with a few to go on to; or, with nothing asked,
 * its topics to look through; or something to write from. What it knows is
 * loaded as it's opened, so none of it is in the way before. Each screen
 * slides in, deeper from the right and back from the left, and an answer
 * writes itself out (index.css .nib-buddy-screen, .nib-buddy-word); `onMood`
 * has the buddy think as a question's typed, and nod at an answer. Each time
 * `storyAsked` goes up (its panel's My story), Inkwell tells its own story.
 */
export function BuddyAsk({ onMood, storyAsked = 0 }: { onMood?: (mood: Mood) => void; storyAsked?: number }) {
  const [known, setKnown] = useState<{ knowledge: Knowledge; prompts: string[] } | null>(null)
  useEffect(() => {
    let live = true
    void import('../buddy/answers').then(({ ANSWERS, PROMPTS }) => live && setKnown({ knowledge: know(ANSWERS), prompts: PROMPTS }))
    return () => {
      live = false
    }
  }, [])

  const [question, setQuestion] = useState('')
  const [topic, setTopic] = useState<Topic | null>(null)
  // One chosen from a list, over what the question found.
  const [chosen, setChosen] = useState<Answer | null>(null)
  const [prompt, setPrompt] = useState<string | null>(null)

  const found = useMemo(() => (known && question.trim() ? ask(known.knowledge, question) : []), [known, question])
  const asksForPrompt = useMemo(() => wordsOf(question).includes('prompt'), [question])
  const shown = chosen ?? found[0] ?? null
  // Which way the next screen comes in: deeper, back, or in place as a question's typed.
  const [way, setWay] = useState<'on' | 'back' | 'here'>('here')
  const screen = !known
    ? 'waiting'
    : prompt || (asksForPrompt && !chosen)
      ? `prompt:${prompt ?? known.prompts[0]}`
      : shown
        ? `answer:${shown.id}`
        : question.trim()
          ? 'unknown'
          : topic
            ? `topic:${topic}`
            : 'topics'

  // Inkwell's keepsake (lib/keepsakes), given the first time it tells its story, and said once, under it.
  const [given, setGiven] = useState<string | null>(null)
  useEffect(() => {
    if (shown?.id !== MY_STORY) return
    const day = localDay(Date.now())
    if (keepInkwell(day)) setGiven(day)
  }, [shown?.id])

  // Thinking while a question's typed; a nod once it rests on an answer.
  useEffect(() => {
    if (!known || !question.trim()) return
    onMood?.('think')
    const timer = setTimeout(() => onMood?.(found.length > 0 ? 'nod' : null), 450)
    return () => clearTimeout(timer)
  }, [known, question, found, onMood])

  function another() {
    if (!known) return
    const others = known.prompts.filter((one) => one !== prompt)
    setWay('on')
    onMood?.('nod')
    setPrompt(others[Math.floor(Math.random() * others.length)] ?? null)
  }
  function choose(answer: Answer) {
    setWay('on')
    onMood?.('nod')
    setChosen(answer)
    setPrompt(null)
  }
  function open(next: Topic) {
    setWay('on')
    setTopic(next)
  }

  // Its own story, asked for from the panel, told once what it knows is in.
  useEffect(() => {
    const story = storyAsked > 0 ? known?.knowledge.byId.get(MY_STORY) : undefined
    if (!story) return
    setQuestion('')
    setTopic(null)
    choose(story)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- told for each asking, not for each render
  }, [storyAsked, known])
  function anew() {
    setChosen(null)
    setTopic(null)
    setPrompt(null)
  }
  /** Back: from an answer chosen in a topic's list, to the list; from anything else, to the topics, the question cleared. */
  function back() {
    setWay('back')
    if (chosen && topic) return setChosen(null)
    anew()
    setQuestion('')
  }

  return (
    <div className="mt-3">
      <input
        // On an iPhone or iPad, the keyboard waits to be asked for.
        autoFocus={!touchApp}
        value={question}
        onChange={(event) => {
          anew()
          setWay('here')
          setQuestion(event.target.value)
        }}
        aria-label="Ask Inkwell"
        placeholder="Ask me anything about Nib or writing"
        autoCapitalize="sentences"
        className="h-[34px] w-full rounded-md border border-line bg-paper px-[10px] text-[13px] text-ink outline-none placeholder:text-muted pointer-coarse:h-11 pointer-coarse:text-[16px]"
      />
      <div role="region" aria-live="polite" aria-label="What Inkwell says" className="mt-3 overflow-x-clip">
        <div key={screen} data-way={way} className="nib-buddy-screen">
        {!known ? (
          <p className="text-[12px] text-muted">One moment…</p>
        ) : prompt || (asksForPrompt && !chosen) ? (
          <Prompt text={prompt ?? known.prompts[0]} onAnother={another} onBack={back} />
        ) : shown ? (
          <Shown
            answer={shown}
            next={related(known.knowledge, shown, found)}
            onChoose={choose}
            onBack={back}
            backTo={chosen && topic ? TOPICS.find((one) => one.topic === topic)!.name : 'Topics'}
            gift={shown.id === MY_STORY ? given : null}
          />
        ) : question.trim() ? (
          <>
            <p className="text-[12px] leading-[1.5] text-muted">I don’t know that one yet. Try other words, or look through these:</p>
            <Topics onTopic={open} onPrompt={another} />
          </>
        ) : topic ? (
          <Questions topic={topic} answers={known.knowledge.answers} onChoose={choose} onBack={back} />
        ) : (
          <Topics onTopic={open} onPrompt={another} />
        )}
        </div>
      </div>
    </div>
  )
}

function Topics({ onTopic, onPrompt }: { onTopic: (topic: Topic) => void; onPrompt: () => void }) {
  return (
    <div role="group" aria-label="Topics" className="mt-2 flex flex-wrap gap-1.5">
      {TOPICS.map(({ topic, name }) => (
        <button key={topic} onClick={() => onTopic(topic)} className={chip}>
          {name}
        </button>
      ))}
      <button onClick={onPrompt} className={chip}>
        Give me a prompt
      </button>
    </div>
  )
}

function Questions({ topic, answers, onChoose, onBack }: { topic: Topic; answers: Answer[]; onChoose: (answer: Answer) => void; onBack: () => void }) {
  const name = TOPICS.find((one) => one.topic === topic)!.name
  return (
    <div>
      <button onClick={onBack} className={link}>
        ← Topics
      </button>
      <ul aria-label={name} className="mt-1.5 flex flex-col">
        {answers
          .filter((answer) => answer.topic === topic)
          .map((answer) => (
            <li key={answer.id}>
              <button onClick={() => onChoose(answer)} className="nib-tap w-full cursor-pointer rounded-md px-1.5 py-1.5 text-left text-[13px] text-ink hover:bg-item-hover">
                {answer.q}
              </button>
            </li>
          ))}
      </ul>
    </div>
  )
}

function Shown({ answer, next, onChoose, onBack, backTo, gift = null }: { answer: Answer; next: Answer[]; onChoose: (answer: Answer) => void; onBack: () => void; backTo: string; gift?: string | null }) {
  return (
    <article aria-label={answer.q}>
      <h3 className="text-[13px] font-medium text-ink">{answer.q}</h3>
      <AnswerText text={answer.a} />
      {/* Its keepsake, handed over once the story's told (index.css .nib-buddy-gift). */}
      {gift && (
        <div role="note" className="nib-buddy-gift mt-3 flex items-center gap-3 rounded-md border border-line p-2.5">
          <StampArt stamp={inkwellStamp(gift)} width={48} />
          <p className="text-[12px] leading-[1.5] text-muted">For listening, my own stamp. It’s with the keepsakes in the Stampbook.</p>
        </div>
      )}
      {next.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted">Also:</span>
          {next.map((one) => (
            <button key={one.id} onClick={() => onChoose(one)} className={chip}>
              {one.q}
            </button>
          ))}
        </div>
      )}
      <button onClick={onBack} className={`${link} mt-3 block`}>
        ← {backTo}
      </button>
    </article>
  )
}

/**
 * Words that come one after another, as if being written (index.css
 * .nib-buddy-word), all of it in the page at once for a screen reader. Each
 * a `step` after the last, the whole of it in about a second however long.
 */
function written(text: string) {
  const total = text.split(/\s+/).filter(Boolean).length
  let at = 0
  return {
    style: { '--step': `${Math.min(30, 1100 / Math.max(1, total))}ms` } as CSSProperties,
    words: (line: string) =>
      line.split(/(\s+)/).map((part, index) =>
        part.trim() ? (
          <span key={index} className="nib-buddy-word" style={{ '--w': at++ } as CSSProperties}>
            {part}
          </span>
        ) : (
          part
        ),
      ),
  }
}

/** An answer's paragraphs; in one, a run of lines starting "- " is a list, and any other line words of its own. Written out. */
function AnswerText({ text }: { text: string }) {
  const runs = text.split('\n\n').flatMap((paragraph) =>
    paragraph.split('\n').reduce<{ listed: boolean; lines: string[] }[]>((all, line) => {
      const listed = line.startsWith('- ')
      const last = all.at(-1)
      if (last && listed && last.listed) last.lines.push(line.slice(2))
      else all.push({ listed, lines: [listed ? line.slice(2) : line] })
      return all
    }, []),
  )
  const { style, words } = written(text)
  return (
    <div style={style} className="mt-1 text-[13px] leading-[1.55] text-ink">
      {runs.map((run, index) =>
        run.listed ? (
          <ul key={index} className="mt-1.5 list-disc pl-5">
            {run.lines.map((line) => (
              <li key={line}>{words(line)}</li>
            ))}
          </ul>
        ) : (
          <p key={index} className="mt-1.5">
            {words(run.lines[0])}
          </p>
        ),
      )}
    </div>
  )
}

function Prompt({ text, onAnother, onBack }: { text: string; onAnother: () => void; onBack: () => void }) {
  const { style, words } = written(text)
  return (
    <div>
      <h3 className="text-[13px] font-medium text-ink">Something to write from</h3>
      <p style={style} className="mt-1.5 text-[13px] leading-[1.55] text-ink">
        {words(text)}
      </p>
      <div className="mt-3 flex items-center gap-4">
        <button onClick={onAnother} className={chip}>
          Another
        </button>
        <button onClick={onBack} className={link}>
          ← Topics
        </button>
      </div>
    </div>
  )
}
