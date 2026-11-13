import { Component, type ReactNode } from 'react'
import { takeBackup } from '../lib/backup'

/**
 * Something Nib couldn't show, caught, where it left a blank window, on every
 * launch if what it couldn't show was stored. The writing is still in the
 * database: it offers a backup of it, as Settings makes, and to try again.
 * `save` hands the file over, as fileActions' exports do.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; save: (content: string, filename: string, type: string) => Promise<void> }, { failed: boolean; unsaved: boolean }> {
  state = { failed: false, unsaved: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error('Nib: something couldn’t be shown', error)
  }

  private async backUp() {
    try {
      const { content, filename, type } = await takeBackup()
      await this.props.save(content, filename, type)
      this.setState({ unsaved: false })
    } catch (error) {
      console.error('Nib: could not save a backup', error)
      this.setState({ unsaved: true })
    }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="flex h-dvh flex-col items-center justify-center gap-4 bg-paper px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-center text-ink">
        <h1 className="text-[17px] font-semibold">Nib couldn’t show this</h1>
        <p className="max-w-[340px] text-[14px] leading-[1.5] text-muted">Your writing is still here, on this device. Save a backup of it, then try again.</p>
        <div className="flex gap-2">
          <button onClick={() => void this.backUp()} className="nib-tap cursor-pointer rounded-md bg-ink px-3 py-1.5 text-[13px] font-medium text-paper">
            Save a backup
          </button>
          <button onClick={() => location.reload()} className="nib-tap cursor-pointer rounded-md border border-line px-3 py-1.5 text-[13px] font-medium">
            Try again
          </button>
        </div>
        {this.state.unsaved && <p role="status" className="text-[13px] text-muted">Couldn’t save a backup.</p>}
      </main>
    )
  }
}
