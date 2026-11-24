import badge from '../assets/plus-badge.png'
import { nativeApp } from '../lib/platform'
import { PRIVACY_URL, store, TERMS_URL, type Entitlement, type PlusProduct } from '../lib/plus'
import { usePurchase } from '../lib/usePurchase'

// Each a plain string: nibprivacy.com's Plus list is read from these (website/build_site.py).
// Held back till it's in the browsers' stores (lib/clipperOut), and then after the inbox's line:
// 'Nib Web Clipper for Chrome, Edge and Firefox: web pages saved from your computer, encrypted before they leave your browser',
const FEATURES = [
  'Your library on your iPhone, iPad and Mac',
  'Encrypted backup, off this device',
  'A backup once a day to a folder you choose, on iCloud Drive, Dropbox or a drive: Markdown, and a full backup beside it',
  'Shared drafts with readers’ notes, a password, and more than one at a time',
  'A shared draft that deletes itself after one reading, and a count of how many times a link is opened',
  'Files attached to your notes and pages, and your pictures kept at full quality',
  'From the share sheet on iPhone and iPad: a web page from Safari saved whole, as its article or as the part on screen, and files kept as attachments',
  'An inbox: an address other apps and services can send notes to',
  'Export to Word, PDF and HTML',
  'A note or page sent to your own WordPress, Ghost or Micro.blog blog as a draft, its pictures with it, and changed there when you send it again',
  'A folder’s pages compiled into one book: Word, PDF or EPUB',
  'For each book, a title page, standard manuscript format for agents and editors, and a word goal with a deadline',
  'Where each piece has been sent, what came back, and a reminder to follow up',
  'Find and replace across a whole book, chapter by chapter, with an Undo',
  'A book’s chapters as index cards, each with a one-line summary and a status, and the book’s progress by status',
  'A book’s characters and places, each with its other names and a line, and every chapter that names it',
  'A book’s inside ready to print and sell through Amazon KDP or IngramSpark: three trim sizes, running heads, page numbers and chapters opening on the right',
  'Screenplays, set out as you type, exported as an industry-format PDF, Final Draft, Word or HTML, and Final Draft and Fountain files brought in as screenplays',
  'A second document open beside the one you’re writing, on iPad and Mac',
  'Several documents open in tabs, on iPad and Mac',
  'All your version history, not just the last 30 days, each version compared with now and a paragraph brought back on its own',
  'Your writing read aloud, a sentence at a time',
  'A note, a page or a whole book saved as audio in the same voice, to proofread by ear away from the screen',
  'Sounds to write to: rain, a café and a fire, together at their own volumes, and a typewriter’s keys as you type',
  'Reminders that come again: daily, weekly, monthly or yearly',
  'Every note to self and TK in a document, in one list',
  'A picture added from a link',
  'Deadlines, sprints, a calendar of your writing, and your year’s stats: your best day, your longest run, your busiest hour, and the books and folders the words went into',
  'On iPhone and iPad, widgets for your daily goal, your streak, a book and a pinned note, and Shortcuts to append to a note, start a sprint or hear today’s words',
  'Expiry dates: a note or page moves itself to the trash on the day you choose',
  'Nib opening where you choose, and a folder for what you write next',
  'The style check’s suggestions, underlined in your text',
  'A vault for chosen notes, with its own passcode',
  'Fourteen more themes: Gruvbox Dark, Gruvbox Light, Green Olive, Pastel Pink, Purple Green, Alien Pink, drcl, Nib Plus in its badge’s colours, and six of Nib’s own, Vellum, Sage, Lilac, Ember, Tide and Merlot',
  'Saved looks on all your devices: your fonts, colours and theme under a name, ready on each',
  'As many folders and categories as you like, past the three of each that are free',
  'A colour and an icon for each folder',
  'On iPhone and iPad, twelve more app icons: Paper, Blue, Green, Rose, one for each of Nib’s six themes, Nib Plus and Inkwell',
  'As many templates as you like, past the one that’s free',
]

const PERIOD = { month: 'Monthly', year: 'Yearly' } as const

export function Billing({
  entitlement,
  onEntitlement,
  onBack,
  onOpenSync,
}: {
  entitlement: Entitlement
  onEntitlement: (entitlement: Entitlement) => void
  onBack: () => void
  onOpenSync: () => void
}) {
  const { products, load, list, monthly, yearly, selected, saving, setChosen, busy, message, setMessage, run, subscribe, restore } = usePurchase(onEntitlement, nativeApp)

  const manage = () =>
    run(async () => {
      try {
        await store.manage()
        // Turning off renewal there creates no transaction, so nothing else
        // would tell this screen. Ask again now the sheet has closed.
        onEntitlement(await store.entitlement())
      } catch {
        setMessage('Couldn’t open your subscription settings.')
      }
    })

  const button =
    'nib-tap w-full cursor-pointer rounded-md py-2 text-[12px] font-medium disabled:cursor-default disabled:opacity-50'
  const quiet = 'nib-tap cursor-pointer text-[11px] text-muted hover:text-ink disabled:cursor-default'

  return (
    <div>
      <div className="flex items-center justify-between">
        <button onClick={onBack} className={quiet}>
          ← Back
        </button>
        <span className="text-[11px] text-faint">Billing</span>
      </div>

      <div className="mt-3 flex items-center gap-2.5">
        <img src={badge} alt="" className="size-9" />
        <div>
          <div className="text-[13px] font-medium">Nib Plus</div>
          <div className="text-[11px] text-muted">
            {entitlement.active ? 'Active on this Apple Account' : 'Sync and backup for your writing'}
          </div>
        </div>
      </div>

      <ul className="mt-3 flex flex-col gap-[3px] text-[11px] leading-[1.4] text-muted">
        {FEATURES.map((feature) => (
          <li key={feature}>{feature}</li>
        ))}
      </ul>

      <div className="mt-3">
        {!nativeApp ? (
          <p className="text-[11px] leading-[1.5] text-muted">
            Nib Plus is sold in the Nib app for iPhone, iPad and Mac.
          </p>
        ) : entitlement.active ? (
          <>
            <p className="text-[11px] leading-[1.5] text-muted">
              {describePlan(entitlement, list)}
            </p>
            <button onClick={onOpenSync} className={`${button} mt-2 bg-ink text-paper`}>
              Sync settings
            </button>
            <button
              onClick={manage}
              disabled={busy}
              className={`${button} mt-1.5 border border-line hover:bg-item-hover`}
            >
              Manage subscription
            </button>
          </>
        ) : products === 'loading' ? (
          <p className="text-[11px] text-muted">Checking the App Store…</p>
        ) : products === 'unreachable' ? (
          <p className="text-[11px] leading-[1.5] text-muted">
            Couldn’t reach the App Store.{' '}
            <button onClick={load} className={quiet}>
              Try again
            </button>
          </p>
        ) : list.length === 0 ? (
          <p className="text-[11px] text-muted">Nib Plus isn’t available yet.</p>
        ) : (
          <>
            <div role="radiogroup" aria-label="Plan" className="flex flex-col gap-1.5">
              {[yearly, monthly].filter((product) => product !== undefined).map((product) => {
                const active = product.id === selected?.id
                return (
                  <button
                    key={product.id}
                    role="radio"
                    aria-checked={active}
                    onClick={() => setChosen(product.id)}
                    className={`nib-tap flex cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left ${
                      active ? 'border-accent bg-item-active' : 'border-line hover:bg-item-hover'
                    }`}
                  >
                    <span className="flex flex-col">
                      <span className="text-[12px] font-medium">{PERIOD[product.period]}</span>
                      {(product.trialDays || (product.period === 'year' && saving > 0)) && (
                        <span className="text-[10.5px] text-muted">
                          {[
                            product.trialDays && `${product.trialDays} days free`,
                            product.period === 'year' && saving > 0 && `Save ${saving}%`,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                    </span>
                    <span className="shrink-0 text-right text-[12px]">
                      {product.displayPrice}
                      <span className="text-[11px] text-muted"> / {product.period}</span>
                    </span>
                  </button>
                )
              })}
            </div>
            <button
              onClick={subscribe}
              disabled={busy || !selected}
              className={`${button} mt-2.5 bg-ink text-paper`}
            >
              {selected?.trialDays ? `Start ${selected.trialDays}-day free trial` : 'Subscribe'}
            </button>
            <p className="mt-2 text-[10.5px] leading-[1.5] text-muted">
              {selected?.trialDays
                ? `Free for ${selected.trialDays} days, then ${selected.displayPrice} a ${selected.period}. `
                : ''}
              Renews automatically until you cancel. Cancel any time in your App Store
              account settings, at least a day before it renews.{' '}
              <a href={TERMS_URL} target="_blank" rel="noreferrer" className="underline">
                Terms of Use
              </a>{' '}
              ·{' '}
              <a href={PRIVACY_URL} target="_blank" rel="noreferrer" className="underline">
                Privacy Policy
              </a>
            </p>
          </>
        )}
      </div>

      {message && (
        <p role="status" className="mt-2 text-[11px] leading-[1.5] text-ink">
          {message}
        </p>
      )}

      {nativeApp && (
        <button onClick={restore} disabled={busy} className={`${quiet} mt-3`}>
          Restore purchases
        </button>
      )}
    </div>
  )
}

function describePlan(entitlement: Entitlement, products: PlusProduct[]): string {
  const product = products.find((candidate) => candidate.id === entitlement.productId)
  const plan = product ? `${PERIOD[product.period]} plan` : 'Your plan'
  if (entitlement.expiresAt === undefined) return `${plan}.`
  const date = new Date(entitlement.expiresAt).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
  return entitlement.willRenew === false ? `${plan}, ends ${date}.` : `${plan}, renews ${date}.`
}
