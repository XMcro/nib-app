// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readSort, writeSort } from './sort'
import { SHELL, applyTheme, readTheme, writeTheme } from './theme'

/**
 * Both readers run as `useState` initialisers, so a throw here is a throw
 * during App's first render — and with no error boundary that is a blank page
 * while the user's notes sit intact in IndexedDB. Storage throws whenever the
 * origin has site data blocked, which index.html already guards against for
 * this very key.
 */
function blockStorage() {
  const blocked = () => {
    throw new DOMException('access denied', 'SecurityError')
  }
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
}

afterEach(() => vi.restoreAllMocks())

describe('preferences with storage blocked', () => {
  it('reads the documented fallback rather than throwing', () => {
    blockStorage()
    expect(readTheme()).toBe('system')
    expect(readSort()).toBe('updated')
  })

  it('accepts a write it cannot persist', () => {
    blockStorage()
    expect(() => writeTheme('dark')).not.toThrow()
    expect(() => writeSort('title')).not.toThrow()
  })

  it('still round-trips a real preference', () => {
    writeTheme('dark')
    writeSort('title')
    expect(readTheme()).toBe('dark')
    expect(readSort()).toBe('title')
  })
})

/**
 * Installed, `theme-color` is the colour the browser paints its own chrome
 * with — the title bar on Android, the status bar on iOS — so it has to follow
 * the app rather than the system.
 */
describe('applyTheme and the installed window chrome', () => {
  const meta = () => document.querySelector('meta[name="theme-color"]')

  afterEach(() => {
    meta()?.remove()
    document.documentElement.classList.remove('dark')
  })

  function withMeta() {
    const tag = document.createElement('meta')
    tag.setAttribute('name', 'theme-color')
    tag.setAttribute('content', SHELL.light)
    document.head.append(tag)
    return tag
  }

  it('repaints the chrome to match an explicit dark choice', () => {
    const tag = withMeta()
    applyTheme('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(tag.getAttribute('content')).toBe(SHELL.dark)
  })

  it('puts it back on the way to light', () => {
    const tag = withMeta()
    applyTheme('dark')
    applyTheme('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    expect(tag.getAttribute('content')).toBe(SHELL.light)
  })

  // index.html carries the tag, but applyTheme is also reachable from the test
  // harness and from a document that never had it. A missing tag is not a
  // reason to leave the theme unapplied.
  it('still switches the theme when the tag is missing', () => {
    expect(meta()).toBeNull()
    expect(() => applyTheme('dark')).not.toThrow()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
