import { useMemo, useState, type FormEvent } from 'react'
import type { Item } from '../db/db'
import type { FindSeed } from '../editor/FindBar'
import { asCard, findSeedOf, mentionsIn, type CastCard, type CastKind } from '../lib/cast'
import { castOf, setCast, useFolderSettings } from '../lib/folderSettings'
import { SUMMARY_MAX } from '../lib/text'
import { isLocked, shownTitle } from '../lib/vault'

export const CAST_PLUS = 'A book’s characters and places, each with the chapters that name it, are part of Nib Plus.'

const KINDS: { kind: CastKind; heading: string; add: string; none: string }[] = [
  { kind: 'character', heading: 'Characters', add: 'Add a character', none: 'No characters yet.' },
  { kind: 'place', heading: 'Places', add: 'Add a place', none: 'No places yet.' },
]

/**
 * A book's characters and places (lib/cast, Nib Plus), the Manuscript's
 * third view: the writer's own cards, each its name, the other names it goes
 * by and a line about it, then the chapters that name it, in book order,
 * each with how many times. Pressing one opens it with its find bar on those
 * names (`onOpenAt`). Kept with the book's folder (lib/folderSettings), so on
 * the writer's other devices too. Without Plus, a book's cards are still
 * shown and can be changed or removed; new ones ask for Plus.
 */
export function CastView({ folder, chapters, plus, onPlus, onOpen, onOpenAt }: { folder: string; chapters: Item[]; plus: boolean; onPlus?: (reason: string) => void; onOpen: (id: string) => void; onOpenAt?: (id: string, seed: FindSeed) => void }) {
  const cast = castOf(useFolderSettings(), folder)
  // Which card is being written: one of the cast by its id, or a new one of a kind.
  const [writing, setWriting] = useState<string | CastKind | null>(null)
  const readable = useMemo(() => chapters.filter((item) => !isLocked(item)), [chapters])
  const mentions = useMemo(() => mentionsIn(cast, readable), [cast, readable])
  const number = new Map(chapters.map((item, index) => [item.id, index + 1]))
  const locked = chapters.length - readable.length

  function keep(card: CastCard) {
    setCast(folder, cast.some((one) => one.id === card.id) ? cast.map((one) => (one.id === card.id ? card : one)) : [...cast, card])
    setWriting(null)
  }

  return (
    <div className="flex flex-col gap-5 px-4 pt-1 pb-6 phone:pb-24">
      {locked > 0 && <p className="text-[11px] text-faint">{locked === 1 ? 'One locked chapter isn’t read. Open the vault to count it in.' : `${locked} locked chapters aren’t read. Open the vault to count them in.`}</p>}
      {KINDS.map(({ kind, heading, add, none }) => {
        const cards = cast.filter((card) => card.kind === kind)
        return (
          <section key={kind} aria-label={heading}>
            <h3 className="pb-1.5 text-[11px] font-medium text-muted">{heading}</h3>
            {cards.length === 0 && writing !== kind && <p className="pb-1.5 text-[12px] text-faint">{none}</p>}
            <ul className="flex flex-col gap-2">
              {cards.map((card) =>
                writing === card.id ? (
                  <li key={card.id}>
                    <CardForm card={card} onKeep={keep} onCancel={() => setWriting(null)} onRemove={() => setCast(folder, cast.filter((one) => one.id !== card.id))} />
                  </li>
                ) : (
                  <li key={card.id} className="rounded-md border border-line px-3 py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-[13px] font-medium">{card.name}</span>
                      <button onClick={() => setWriting(card.id)} aria-label={`Change ${card.name}`} className="nib-tap shrink-0 cursor-pointer text-[11px] text-muted hover:text-ink">
                        Change
                      </button>
                    </div>
                    {card.also.length > 0 && <p className="mt-0.5 text-[11.5px] text-muted">Also {card.also.join(', ')}</p>}
                    {card.line && <p className="mt-0.5 text-[11.5px] leading-[1.4] text-muted">{card.line}</p>}
                    <Mentions card={card} mentions={mentions.get(card.id) ?? []} chapters={chapters} number={number} onOpen={onOpen} onOpenAt={onOpenAt} />
                  </li>
                ),
              )}
              {writing === kind && (
                <li>
                  <CardForm kind={kind} onKeep={keep} onCancel={() => setWriting(null)} />
                </li>
              )}
            </ul>
            {writing !== kind && (
              <button onClick={() => (plus ? setWriting(kind) : onPlus?.(CAST_PLUS))} className="nib-tap mt-2 flex cursor-pointer items-center gap-2 text-[12px] font-medium text-ink hover:underline">
                + {add}
                {!plus && <span className="text-[10.5px] font-normal text-faint">Plus</span>}
              </button>
            )}
          </section>
        )
      })}
    </div>
  )
}

/** The chapters that name a card, each pressed to open it there; or that none do yet. */
function Mentions({ card, mentions, chapters, number, onOpen, onOpenAt }: { card: CastCard; mentions: { id: string; count: number }[]; chapters: Item[]; number: Map<string, number>; onOpen: (id: string) => void; onOpenAt?: (id: string, seed: FindSeed) => void }) {
  if (mentions.length === 0) return <p className="mt-1.5 text-[11px] text-faint">Not named in a chapter yet.</p>
  const byId = new Map(chapters.map((item) => [item.id, item]))
  return (
    <ul aria-label={`Chapters that name ${card.name}`} className="mt-1.5 flex flex-col">
      {mentions.map(({ id, count }) => {
        const title = shownTitle(byId.get(id)!)
        return (
          <li key={id}>
            <button
              onClick={() => (onOpenAt ? onOpenAt(id, findSeedOf(card)) : onOpen(id))}
              aria-label={`${number.get(id)}. ${title}, named ${count === 1 ? 'once' : `${count} times`}`}
              className="nib-tap flex w-full cursor-pointer items-baseline gap-2 py-0.5 text-left text-[11.5px] hover:text-ink pointer-coarse:min-h-11 pointer-coarse:items-center"
            >
              <span className="w-5 shrink-0 text-right text-faint tabular-nums">{number.get(id)}</span>
              <span className="min-w-0 flex-1 truncate text-ink">{title}</span>
              <span className="shrink-0 text-muted tabular-nums">{count === 1 ? 'once' : `${count} times`}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** A card being written: its name, its other names (commas between them) and a line about it. A new one is given an id when it's kept. */
function CardForm({ card, kind, onKeep, onCancel, onRemove }: { card?: CastCard; kind?: CastKind; onKeep: (card: CastCard) => void; onCancel: () => void; onRemove?: () => void }) {
  const [removing, setRemoving] = useState(false)
  const what = (card?.kind ?? kind) === 'place' ? 'place' : 'character'

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const kept = asCard({
      id: card?.id ?? crypto.randomUUID(),
      kind: card?.kind ?? kind,
      name: form.get('name'),
      also: String(form.get('also') ?? '').split(','),
      line: form.get('line'),
    })
    if (kept) onKeep(kept)
  }

  const field = 'mt-0.5 block w-full rounded-sm border border-line bg-transparent px-2 py-1 text-[12px] text-ink outline-none focus:border-muted pointer-coarse:text-[16px]'
  return (
    <form onSubmit={submit} onKeyDown={(event) => event.key === 'Escape' && (event.stopPropagation(), onCancel())} aria-label={card ? `Change ${card.name}` : `A new ${what}`} className="flex flex-col gap-2 rounded-md border border-line px-3 py-2.5 text-[11px] text-muted">
      <label>
        Name
        <input name="name" required maxLength={80} defaultValue={card?.name} autoFocus className={field} />
      </label>
      <label>
        Other names, with commas between
        <input name="also" maxLength={1000} defaultValue={card?.also.join(', ')} placeholder={what === 'place' ? 'The old mill, the mill' : 'Mrs Lee, Gran'} className={field} />
      </label>
      <label>
        A line about {what === 'place' ? 'it' : 'them'}
        <input name="line" maxLength={SUMMARY_MAX} defaultValue={card?.line} className={field} />
      </label>
      <div className="flex items-center gap-3 pt-0.5">
        <button type="submit" className="nib-tap cursor-pointer rounded-md bg-ink px-3 py-1 text-[12px] font-medium text-paper">
          Keep
        </button>
        <button type="button" onClick={onCancel} className="nib-tap cursor-pointer text-[12px] text-muted hover:text-ink">
          Cancel
        </button>
        {onRemove && (
          <button type="button" onClick={() => (removing ? onRemove() : setRemoving(true))} className="nib-tap ml-auto cursor-pointer text-[12px] text-muted hover:text-ink">
            {removing ? `Remove ${card?.name}?` : 'Remove'}
          </button>
        )}
      </div>
    </form>
  )
}
