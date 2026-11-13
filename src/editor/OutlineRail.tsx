import { useEffect, useState } from 'react'
import { type Editor, useEditorState } from '@tiptap/react'
import { scrollerOf } from './scroller'

type Entry = { level: number; text: string; pos: number }

/**
 * Read straight from the rendered document rather than resolving stored
 * positions: an edit anywhere above a heading shifts its position, and a
 * captured list goes stale the moment the user types.
 */
function headingElements(editor: Editor): HTMLElement[] {
  return [...editor.view.dom.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')].filter(
    (el) => el.textContent?.trim(),
  )
}

export function OutlineRail({ editor }: { editor: Editor }) {
  const headings = useEditorState({
    editor,
    selector: ({ editor }) => {
      const found: Entry[] = []
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading' && node.textContent.trim()) {
          found.push({ level: node.attrs.level as number, text: node.textContent, pos })
        }
      })
      return found
    },
  })

  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    const scroller = scrollerOf(editor)
    if (!scroller) return

    function update() {
      const threshold = scroller!.getBoundingClientRect().top + 24
      let index = 0
      headingElements(editor).forEach((el, i) => {
        // One folded out of sight (fold.ts) is nowhere, and would count as above everything.
        if (el.offsetParent !== null && el.getBoundingClientRect().top <= threshold) index = i
      })
      setActiveIndex(index)
    }

    update()
    scroller.addEventListener('scroll', update, { passive: true })
    return () => scroller.removeEventListener('scroll', update)
    // `headings` is a dependency so adding or renaming one re-runs update()
    // immediately, rather than leaving the rail stale until the next scroll.
  }, [editor, headings])

  if (!headings?.length) return null

  return (
    // The outer box is the hover target: the whole left gutter, full height.
    // The inner box is the rail itself, so its rule only spans the entries.
    // The gutter is what is left of main beside the text, so a phone, an iPad,
    // or any narrow window can leave it too narrow to read, or
    // negative. The rail queries its own box, not the viewport, and steps aside.
    // The text is centred in main, or in its left half with a document beside (App).
    <div className="group @container absolute top-[calc(118px+var(--nib-tabs,0px))] right-[calc(var(--nib-centre,50%)_+_364px)] bottom-0 left-[22px]">
      <div className="nib-rail flex flex-col @max-[96px]:hidden gap-[10px] border-l border-line pl-[11px] opacity-0 transition-opacity duration-[180ms] group-focus-within:opacity-100 group-hover:opacity-100">
        {headings.map((heading, index) => (
          <button
            key={heading.pos}
            onClick={() => {
              editor.chain().focus().setTextSelection(heading.pos + 1).run()
              // ProseMirror's own scrollIntoView scrolls minimally, which leaves
              // the heading pinned to the bottom edge with none of its section
              // visible. Put it at the top instead.
              headingElements(editor)[index]?.scrollIntoView({ block: 'start' })
            }}
            style={{ paddingLeft: (heading.level - 1) * 11 }}
            aria-current={index === activeIndex ? 'location' : undefined}
            className={`cursor-pointer truncate text-left text-[11px] leading-[1.35] ${
              index === activeIndex
                ? 'font-medium text-ink'
                : 'text-[#8E8E8A] dark:text-[#8B8B90]'
            }`}
          >
            {heading.text}
          </button>
        ))}
      </div>
    </div>
  )
}
