// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TOOLBAR_MAX, resetLook, setLook, setLookPlus, useChosenLook } from '../lib/look'
import { download } from '../lib/download'
import { DEFAULT_OWN, palette } from '../lib/ownTheme'
import { DEFAULT_START, setStart, useStart } from '../lib/startAt'
import { THEME_FILE_MAX, themeFile } from '../lib/themeFile'
import { Customize } from './Customize'

vi.mock('../lib/download', () => ({ download: vi.fn(async () => {}) }))

const group = (name: string) => within(screen.getByRole('radiogroup', { name }))
const checked = (name: string) => group(name).getByRole('radio', { checked: true }).getAttribute('aria-label') ?? group(name).getByRole('radio', { checked: true }).textContent

const chosenLook = () => renderHook(() => useChosenLook()).result.current

function show(plus: boolean, onThemeChange = vi.fn(), folders?: string[]) {
  setLookPlus({ active: plus, known: true })
  const onOpenBilling = vi.fn()
  render(<Customize plus={plus} theme="light" onThemeChange={onThemeChange} folders={folders} onOpenBilling={onOpenBilling} onBack={vi.fn()} />)
  return onOpenBilling
}
const chosenStart = () => renderHook(() => useStart()).result.current

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.mocked(download).mockClear()
  resetLook()
  act(() => setStart(DEFAULT_START))
  localStorage.removeItem('nib-looks')
  setLookPlus({ active: false, known: false })
})

describe('Customize without Nib Plus', () => {
  it('changes the free options', async () => {
    show(false)
    await userEvent.click(group('Width').getByRole('radio', { name: 'Narrow' }))
    await userEvent.click(group('Size').getByRole('radio', { name: 'Large' }))
    await userEvent.click(group('Line spacing').getByRole('radio', { name: 'Airy' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Linked from' }))
    expect(checked('Width')).toBe('Narrow')
    expect(checked('Size')).toBe('Large')
    expect(checked('Line spacing')).toBe('Airy')
    expect((screen.getByRole('checkbox', { name: 'Linked from' }) as HTMLInputElement).checked).toBe(false)
  })

  it('leads a Plus option to Billing, and leaves it as it was', async () => {
    const onOpenBilling = show(false)
    await userEvent.click(group('Notes in').getByRole('radio', { name: 'Serif' }))
    await userEvent.click(group('Accent').getByRole('radio', { name: 'Teal' }))
    await userEvent.click(group('Highlight').getByRole('radio', { name: 'Green' }))
    await userEvent.click(group('Paragraphs on pages').getByRole('radio', { name: 'Indented' }))
    await userEvent.click(group('Page edges').getByRole('radio', { name: 'Justified' }))
    await userEvent.click(screen.getByRole('checkbox', { name: /mid-screen/ }))
    await userEvent.click(screen.getByRole('button', { name: /Toolbar buttons/ }))
    await userEvent.click(screen.getByRole('button', { name: /Saved looks/ }))
    await userEvent.click(screen.getByRole('button', { name: /Choose your page, text and accent/ }))
    expect(onOpenBilling).toHaveBeenCalledTimes(9)
    expect(screen.queryByLabelText('Page colour')).toBeNull()
    expect((screen.getByRole('checkbox', { name: /mid-screen/ }) as HTMLInputElement).checked).toBe(false)
    expect(checked('Paragraphs on pages')).toBe('Lines')
    expect(checked('Highlight')).toBe('The theme’s own')
    expect(checked('Notes in')).toBe('Mono')
    expect(checked('Accent')).toBe('The theme’s own')
    expect(screen.queryByText('Selection toolbar · up to 7')).toBeNull()
  })

  // What shows selected is what is drawn: a lapsed subscriber's serif isn't.
  it('shows a Plus choice as it is drawn', () => {
    setLook({ notesFont: 'serif' })
    show(false)
    expect(checked('Notes in')).toBe('Mono')
  })
})

describe('Customize with Nib Plus', () => {
  it('changes the Plus options', async () => {
    const onOpenBilling = show(true)
    await userEvent.click(group('Page edges').getByRole('radio', { name: 'Justified' }))
    await userEvent.click(group('Accent').getByRole('radio', { name: 'Purple' }))
    expect(checked('Page edges')).toBe('Justified')
    await userEvent.click(screen.getByRole('checkbox', { name: /fade all but/ }))
    expect((screen.getByRole('checkbox', { name: /fade all but/ }) as HTMLInputElement).checked).toBe(true)
    expect(checked('Accent')).toBe('Purple')
    expect(onOpenBilling).not.toHaveBeenCalled()
  })

  it('chooses, orders and caps the toolbar’s buttons', async () => {
    show(true)
    await userEvent.click(screen.getByRole('button', { name: /Toolbar buttons/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Move Italic earlier' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Code' }))

    const on = () => within(screen.getByRole('group', { name: 'Selection toolbar' })).getAllByRole<HTMLInputElement>('checkbox', { checked: true }).map((box) => box.labels![0].textContent)
    expect(on()).toEqual(['Italic', 'Bold', 'Strikethrough', 'Link', 'Heading (pages)', 'Quote'])

    await userEvent.click(screen.getByRole('checkbox', { name: 'Underline' }))
    expect(on()).toHaveLength(TOOLBAR_MAX)
    expect((screen.getByRole('checkbox', { name: 'Highlight' }) as HTMLInputElement).disabled).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: 'Put the buttons back' }))
    expect(on()).toEqual(['Bold', 'Italic', 'Strikethrough', 'Link', 'Heading (pages)', 'Quote', 'Code'])
  })

  it('saves a look, theme and all, uses it again, and deletes it', async () => {
    const onThemeChange = vi.fn()
    show(true, onThemeChange)
    await userEvent.click(group('Size').getByRole('radio', { name: 'Larger' }))
    await userEvent.click(screen.getByRole('button', { name: /Saved looks/ }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Name this look' }), 'Editing{Enter}')
    expect(screen.getByText('Editing')).toBeTruthy()
    expect(screen.getByText('In use')).toBeTruthy()

    // Changed since, it can be used again: the size comes back, and the theme it was saved with.
    act(() => setLook({ size: 'small' }))
    await userEvent.click(screen.getByRole('button', { name: 'Use' }))
    expect(onThemeChange).toHaveBeenCalledWith('light')
    expect(screen.getByText('In use')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '← Customize' }))
    expect(checked('Size')).toBe('Larger')

    await userEvent.click(screen.getByRole('button', { name: /Saved looks/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete Editing' }))
    expect(screen.queryByText('Editing')).toBeNull()
  })

  it('makes a theme of one’s own, refusing colours that would not read', async () => {
    const onThemeChange = vi.fn()
    show(true, onThemeChange)
    const page = screen.getByLabelText('Page colour')
    fireEvent.change(page, { target: { value: '#14161a' } })
    // Dark page, dark text: shown, said so, and not kept.
    expect(screen.getByRole('status').textContent).toMatch(/text would read at 1\.\d:1/)
    expect(chosenLook().ownTheme.paper).toBe(DEFAULT_OWN.paper)

    fireEvent.change(screen.getByLabelText('Text colour'), { target: { value: '#e8e4da' } })
    fireEvent.change(screen.getByLabelText('Accent colour'), { target: { value: '#7fb4d6' } })
    expect(screen.queryByRole('status')).toBeNull()
    expect(chosenLook().ownTheme).toEqual({ paper: '#14161a', ink: '#e8e4da', accent: '#7fb4d6' })

    await userEvent.click(screen.getByRole('button', { name: 'Use it' }))
    expect(onThemeChange).toHaveBeenCalledWith('custom')
  })

  it('lets the library and the highlight be chosen too, or worked out again', async () => {
    show(true)
    const library = () => screen.getByLabelText<HTMLInputElement>('Library colour')
    const highlight = () => screen.getByLabelText<HTMLInputElement>('Highlight colour')
    // Until one is chosen, each shows what it's worked out to be, and says so.
    const worked = palette(DEFAULT_OWN).vars
    expect([library().value, highlight().value]).toEqual([worked.shell, worked.highlight])
    expect(screen.getByText('Library · worked out')).toBeTruthy()
    expect(screen.getByText('Highlight · worked out')).toBeTruthy()

    fireEvent.change(library(), { target: { value: '#efe9dc' } })
    fireEvent.change(highlight(), { target: { value: '#f3d9a4' } })
    expect(chosenLook().ownTheme).toEqual({ ...DEFAULT_OWN, shell: '#efe9dc', highlight: '#f3d9a4' })
    expect(screen.queryByText(/worked out/)).toBeNull()
    // The sample shows both: the library around the page, the highlight in it.
    expect(screen.getByText('a highlight').style.background).toBe('rgb(243, 217, 164)')

    // One the text wouldn't read on is shown and said, and not kept.
    fireEvent.change(library(), { target: { value: '#33312c' } })
    expect(screen.getByRole('status').textContent).toMatch(/^The text would read at 1\.\d:1 on the library, and needs 4\.5:1\. Nothing changes until it reads\.$/)
    expect(chosenLook().ownTheme.shell).toBe('#efe9dc')
    // Still the colour that was picked, in its field and around the sample, not one worked out in its place.
    expect(library().value).toBe('#33312c')
    fireEvent.change(highlight(), { target: { value: '#33312c' } })
    expect(highlight().value).toBe('#33312c')
    fireEvent.change(library(), { target: { value: '#efe9dc' } })
    expect(screen.getByRole('status').textContent).toMatch(/on the highlight, and needs 4\.5:1\./)

    // Worked out again: gone from what's kept, not kept as the colour it comes to.
    await userEvent.click(screen.getByRole('button', { name: 'Work out the highlight colour' }))
    expect(screen.queryByRole('status')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Work out the library colour' }))
    expect(chosenLook().ownTheme).toEqual(DEFAULT_OWN)
    expect(JSON.parse(localStorage.getItem('nib-look')!).ownTheme).toStrictEqual(DEFAULT_OWN)
    expect(library().value).toBe(worked.shell)
  })

  describe('where Nib opens', () => {
    const FOLDERS = ['Letters', 'Novel', 'Novel/Part 1']
    const showing = () => screen.getByLabelText<HTMLSelectElement>('Showing')
    const newIn = () => screen.getByLabelText<HTMLSelectElement>('New notes and pages go in')

    it('is on Notes with everything showing until chosen otherwise, and each choice is kept', async () => {
      show(true, undefined, FOLDERS)
      expect(checked('Nib opens on')).toBe('Notes')
      expect([showing().value, newIn().value]).toEqual(['', ''])
      // A folder inside another is said as it is everywhere else.
      expect([...showing().options].map((option) => option.textContent)).toEqual(['Everything', 'Letters', 'Novel', 'Novel › Part 1'])
      expect([...newIn().options].map((option) => option.textContent)).toEqual(['No folder', 'Letters', 'Novel', 'Novel › Part 1'])

      await userEvent.click(group('Nib opens on').getByRole('radio', { name: 'Where I left off' }))
      await userEvent.selectOptions(showing(), 'Novel › Part 1')
      await userEvent.selectOptions(newIn(), 'Letters')
      expect(chosenStart()).toEqual({ on: 'last', folder: 'Novel/Part 1', newIn: 'Letters' })
      expect(checked('Nib opens on')).toBe('Where I left off')

      await userEvent.selectOptions(showing(), 'Everything')
      await userEvent.selectOptions(newIn(), 'No folder')
      expect(chosenStart()).toEqual({ on: 'last', folder: null, newIn: null })
    })

    it('shows a folder that has since gone as none, which is what it now counts for', () => {
      act(() => setStart({ folder: 'Gone', newIn: 'novel' }))
      show(true, undefined, FOLDERS)
      expect(showing().value).toBe('')
      // Still there under another case: the one it is.
      expect(newIn().value).toBe('Novel')
    })

    it('is part of Nib Plus: without it a choice leads to Billing, and what was chosen with it shows as Nib opens now', async () => {
      act(() => setStart({ on: 'pages', folder: 'Novel', newIn: 'Letters' }))
      const onOpenBilling = show(false, undefined, FOLDERS)
      expect(checked('Nib opens on')).toBe('Notes')
      expect([showing().value, newIn().value]).toEqual(['', ''])
      await userEvent.click(group('Nib opens on').getByRole('radio', { name: 'Pages' }))
      await userEvent.selectOptions(showing(), 'Letters')
      await userEvent.selectOptions(newIn(), 'Novel')
      expect(onOpenBilling).toHaveBeenCalledTimes(3)
      // Kept as it was, for when Plus comes back.
      expect(chosenStart()).toEqual({ on: 'pages', folder: 'Novel', newIn: 'Letters' })
    })
  })

  describe('a theme as a file', () => {
    const NIGHT = { paper: '#14161a', ink: '#e8e4da', accent: '#7fb4d6', shell: '#0b0c0e' }
    const file = (text: string, name = 'Night.json') => new File([text], name, { type: 'application/json' })
    const pick = (chosen: File) => userEvent.upload(screen.getByLabelText('Install from a file…'), chosen)

    it('saves one’s own theme as it’s kept, colours only', async () => {
      act(() => setLook({ ownTheme: NIGHT }))
      show(true)
      // A draft that doesn't read isn't what's saved: the theme as it last read is.
      fireEvent.change(screen.getByLabelText('Text colour'), { target: { value: '#14161a' } })
      await userEvent.click(screen.getByRole('button', { name: 'Save as a file' }))
      // A .json file, and the field asks for those: iOS's file picker greys out a kind of file it doesn't know,
      // and "Nib theme.nibtheme", saved from here to Files on an iPhone, couldn't be chosen to install.
      expect(download).toHaveBeenCalledWith(themeFile(NIGHT), 'Nib theme.json', 'application/json')
      expect(screen.getByLabelText('Install from a file…').getAttribute('accept')).toBe('.json,application/json')
      expect(JSON.parse(vi.mocked(download).mock.calls[0][0] as string)).toEqual({ nib: 'theme', page: '#14161a', text: '#e8e4da', accent: '#7fb4d6', library: '#0b0c0e' })
    })

    it('says so if the file can’t be saved', async () => {
      vi.mocked(download).mockRejectedValueOnce(new Error('no room'))
      show(true)
      await userEvent.click(screen.getByRole('button', { name: 'Save as a file' }))
      expect(await screen.findByText('Couldn’t save the file.')).toBeTruthy()
    })

    it('installs one from a file: its colours become one’s own theme, in the fields too', async () => {
      const confirmed = vi.spyOn(window, 'confirm')
      show(true)
      await pick(file(themeFile(NIGHT)))
      expect(await screen.findByText('Installed.')).toBeTruthy()
      expect(chosenLook().ownTheme).toEqual(NIGHT)
      expect(screen.getByLabelText<HTMLInputElement>('Page colour').value).toBe('#14161a')
      expect(screen.getByLabelText<HTMLInputElement>('Library colour').value).toBe('#0b0c0e')
      // Over the theme Nib starts with there was nothing to ask about; and it isn't switched to unasked.
      expect(confirmed).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Use it' })).toBeTruthy()
    })

    it('asks before replacing a theme made here, and leaves it if the answer is no', async () => {
      const mine = { paper: '#fdf6e3', ink: '#3b3a36', accent: '#1c6f8a' }
      act(() => setLook({ ownTheme: mine }))
      const confirmed = vi.spyOn(window, 'confirm').mockReturnValue(false)
      show(true)
      await pick(file('not a theme'))
      await screen.findByText('That isn’t a Nib theme file.')
      await pick(file(themeFile(NIGHT)))
      await vi.waitFor(() => expect(confirmed).toHaveBeenCalledWith('Replace your own theme’s colours with this file’s?'))
      expect(chosenLook().ownTheme).toEqual(mine)
      // Nothing is said of a file that was let go, and what was said of the last one doesn't stay.
      expect(screen.queryByText(/Installed|theme file/)).toBeNull()

      confirmed.mockReturnValue(true)
      await pick(file(themeFile(NIGHT)))
      expect(await screen.findByText('Installed.')).toBeTruthy()
      expect(chosenLook().ownTheme).toEqual(NIGHT)
      // The same theme again is no replacement to ask about.
      confirmed.mockClear()
      await pick(file(themeFile(NIGHT)))
      await screen.findByText('Installed.')
      expect(confirmed).not.toHaveBeenCalled()
    })

    it('installs nothing from a file that isn’t a theme, is too big to be one, or wouldn’t read, and says which', async () => {
      const confirmed = vi.spyOn(window, 'confirm')
      show(true)
      await pick(file('{"notes":[]}', 'backup.json'))
      expect(await screen.findByText('That isn’t a Nib theme file.')).toBeTruthy()

      await pick(file(JSON.stringify({ nib: 'theme', page: '#14161a', text: '#33312c', accent: '#7fb4d6' })))
      expect(await screen.findByText('That theme’s text wouldn’t read on its colours, so it isn’t installed.')).toBeTruthy()
      expect(screen.queryByText('That isn’t a Nib theme file.')).toBeNull()

      // A real theme, padded out past any size a theme could be: not read at all.
      await pick(file(themeFile(NIGHT) + ' '.repeat(THEME_FILE_MAX)))
      expect(await screen.findByText('That isn’t a Nib theme file.')).toBeTruthy()

      expect(chosenLook().ownTheme).toEqual(DEFAULT_OWN)
      expect(confirmed).not.toHaveBeenCalled()
    })

    it('is part of Nib Plus: without it there’s nothing to save or install', () => {
      show(false)
      expect(screen.queryByRole('button', { name: 'Save as a file' })).toBeNull()
      expect(screen.queryByLabelText('Install from a file…')).toBeNull()
      expect(screen.getByRole('button', { name: 'Choose your page, text and accent, or install a theme ›' })).toBeTruthy()
    })
  })

  it('resets everything, and only once something has changed', async () => {
    show(true)
    const reset = screen.getByRole('button', { name: 'Reset to default' }) as HTMLButtonElement
    expect(reset.disabled).toBe(true)
    await userEvent.click(group('Pages in').getByRole('radio', { name: 'Serif' }))
    await userEvent.click(group('Motion').getByRole('radio', { name: 'None' }))
    expect(reset.disabled).toBe(false)
    await userEvent.click(reset)
    expect(checked('Pages in')).toBe('Sans')
    expect(checked('Motion')).toBe('Full')
    expect(reset.disabled).toBe(true)
  })
})
