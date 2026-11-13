import { Fragment, useState } from 'react'
import type { Item } from '../db/db'
import * as items from '../db/items'
import { ACCENTS, type Accent } from '../lib/look'
import { canMake, makeCategory, makeFolder, MAX_NAME, sameName, split, treeOf, type Folder, type Library } from '../lib/folders'
import { CategoryDot, FolderMark } from './Places'
import { Sheet } from './Sheet'

/**
 * Where these documents are filed (lib/folders), one or several: a folder, one
 * or none, and categories, any number. Each choice is made as it's tapped; a
 * new folder or category typed here is made and chosen at once. With several,
 * a folder shows as chosen only if they're all in it, and a category only if
 * they all have it, and choosing one that only some have gives it to the rest.
 */
export function FilingDialog({
  targets,
  library,
  run,
  onClose,
  unlimited,
  onLimit,
  aside,
}: {
  targets: Item[]
  library: Library
  run: (action: () => Promise<unknown>) => void
  onClose: () => void
  /** Nib Plus: no limit on how many (lib/folders FREE_FOLDERS). */
  unlimited: boolean
  /** One more than free Nib makes was asked for. */
  onLimit: (kind: 'folder' | 'category') => void
  /** Said under the title: why some aren't here. */
  aside?: string
}) {
  const [folderName, setFolderName] = useState('')
  const [categoryName, setCategoryName] = useState('')
  const [color, setColor] = useState<Accent>('blue')
  const ids = targets.map((item) => item.id)
  const hasIn = (item: Item | undefined, name: string) => item?.categories?.some((category) => sameName(category.name, name)) ?? false
  const has = (name: string) => targets.every((item) => hasIn(item, name))
  const inFolder = (name: string | undefined) => targets.every((item) => (item.folder && name ? sameName(item.folder, name) : !item.folder && !name))

  const file = (folder: string | null) => run(() => items.setFolder(ids, folder))
  // From what's stored, not what's drawn: two taps before the list redraws both count.
  const toggle = (name: string, color: Accent) =>
    run(async () => {
      const stored = await Promise.all(ids.map(items.get))
      await items.fileInCategory(ids, { name, color }, !stored.every((item) => hasIn(item, name)))
    })

  const field =
    'h-[30px] min-w-0 flex-1 rounded-md border border-line bg-paper px-[9px] text-[12px] outline-none placeholder:text-muted pointer-coarse:h-11 pointer-coarse:text-[16px]'
  const quiet = 'nib-tap cursor-pointer text-[12px] text-muted hover:text-ink disabled:cursor-default disabled:opacity-50'
  const choice = 'nib-tap flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] hover:bg-item-hover pointer-coarse:py-2.5'

  // One inside another is under it, set in, by its own name.
  const folderChoice = (folder: Folder, name: string, inside?: string) => {
    const chosen = inFolder(folder.name)
    return (
      <button
        key={folder.name}
        role="radio"
        aria-checked={chosen}
        aria-label={inside === undefined ? undefined : `${name}, in ${inside}`}
        onClick={() => file(folder.name)}
        className={`${choice} ${inside === undefined ? '' : 'pl-7'} ${chosen ? 'bg-item-active font-medium' : ''}`}
      >
        <FolderMark look={folder} />
        <span className="truncate">{name}</span>
      </button>
    )
  }

  return (
    <Sheet label="Folder and categories" onClose={onClose} top="pt-[14vh]" className="nib-pop flex h-fit max-h-[72vh] w-[min(400px,90vw)] flex-col overflow-y-auto rounded-lg border border-line bg-paper p-4">
      <div className="text-[14px] font-medium">Folder and categories</div>
      {aside && <p className="mt-1 text-[12px] text-muted">{aside}</p>}

      <div role="radiogroup" aria-label="Folder" className="mt-3 flex flex-col gap-px">
        <div className="pb-1 text-[11px] font-medium text-muted">Folder</div>
        <button role="radio" aria-checked={inFolder(undefined)} onClick={() => file(null)} className={`${choice} ${inFolder(undefined) ? 'bg-item-active font-medium' : ''}`}>
          No folder
        </button>
        {treeOf(library).map(({ folder, inside }) => (
          <Fragment key={folder.name}>
            {folderChoice(folder, folder.name)}
            {inside.map((one) => folderChoice(one, split(one.name).name, folder.name))}
          </Fragment>
        ))}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const name = folderName.trim()
          if (!name) return
          // One already there by any case is chosen, not made twice.
          const known = library.folders.find((folder) => sameName(folder.name, name))
          if (!known && !canMake('folder', library, unlimited)) return onLimit('folder')
          // Made here, as in Folders and categories, so it stays once emptied.
          if (!known) makeFolder(name, library)
          file(known?.name ?? name)
          setFolderName('')
        }}
        className="mt-1.5 flex items-center gap-2"
      >
        <input value={folderName} maxLength={MAX_NAME} onChange={(event) => setFolderName(event.target.value)} placeholder="New folder" aria-label="New folder" className={field} />
        <button type="submit" disabled={!folderName.trim()} className={quiet}>
          Add
        </button>
      </form>

      <div role="group" aria-label="Categories" className="mt-4 flex flex-col gap-px">
        <div className="pb-1 text-[11px] font-medium text-muted">Categories</div>
        {library.categories.map((category) => (
          <button
            key={category.name}
            role="checkbox"
            aria-checked={has(category.name)}
            onClick={() => toggle(category.name, category.color)}
            className={`${choice} ${has(category.name) ? 'font-medium' : ''}`}
          >
            <span
              aria-hidden="true"
              className={`flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border ${has(category.name) ? 'border-ink bg-ink text-paper' : 'border-faint'}`}
            >
              {has(category.name) && (
                <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
                  <path d="M1 3l2 2 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </span>
            <CategoryDot color={category.color} />
            <span className="truncate">{category.name}</span>
          </button>
        ))}
        {library.categories.length === 0 && <p className="px-2 py-1 text-[12px] text-muted">None yet.</p>}
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const name = categoryName.trim()
          if (!name) return
          const known = library.categories.find((category) => sameName(category.name, name))
          if (!known && !canMake('category', library, unlimited)) return onLimit('category')
          if (!known) makeCategory(name, color, library)
          if (!known || !has(known.name)) toggle(known?.name ?? name, known?.color ?? color)
          setCategoryName('')
        }}
        className="mt-1.5"
      >
        <div className="flex items-center gap-2">
          <input value={categoryName} maxLength={MAX_NAME} onChange={(event) => setCategoryName(event.target.value)} placeholder="New category" aria-label="New category" className={field} />
          <button type="submit" disabled={!categoryName.trim()} className={quiet}>
            Add
          </button>
        </div>
        <div role="radiogroup" aria-label="Colour of the new category" className="grid grid-cols-8 justify-items-center gap-1 pt-2 pointer-coarse:grid-cols-4 pointer-coarse:gap-2">
          {(Object.keys(ACCENTS) as Accent[]).map((accent) => (
            <button
              key={accent}
              type="button"
              role="radio"
              aria-checked={accent === color}
              aria-label={ACCENTS[accent].label}
              onClick={() => setColor(accent)}
              className={`nib-tap flex size-[22px] cursor-pointer items-center justify-center rounded-full pointer-coarse:size-9 ${accent === color ? 'ring-2 ring-muted' : ''}`}
            >
              <CategoryDot color={accent} size={14} />
            </button>
          ))}
        </div>
      </form>

      <div className="mt-4 flex justify-end">
        <button onClick={onClose} className="nib-tap cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[12px] font-medium text-paper">
          Done
        </button>
      </div>
    </Sheet>
  )
}
