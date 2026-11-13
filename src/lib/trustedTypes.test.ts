// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rules } from './trustedTypes'

describe('the page’s default Trusted Types policy', () => {
  it('lets HTML into a DOMParser document, where nothing in it runs or loads', () => {
    expect(rules.createHTML('<p>Imported</p>', 'TrustedHTML', 'DOMParser parseFromString')).toBe('<p>Imported</p>')
  })

  // ProseMirror asks without a sink, and on a refusal parses pasted HTML
  // through its own policy, into a document of its own (ProseMirrorClipboard).
  it('refuses HTML for anywhere else, the live page above all', () => {
    for (const sink of ['Element innerHTML', 'Element outerHTML', 'Element insertAdjacentHTML', 'Document write', undefined]) {
      expect(() => rules.createHTML('<img src=x onerror=alert(1)>', 'TrustedHTML', sink)).toThrow()
    }
  })

  // The tests' own page has no such policy: code that set HTML where it refuses would pass every one of them,
  // and throw in the app. (Google Keep's importer did, on the notes that carry their words as HTML.)
  it('is never asked for what it refuses: none of Nib’s code sets an element’s HTML or writes to the document', () => {
    const files = (readdirSync('src', { recursive: true }) as string[]).filter((path) => /\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path))
    expect(files.length).toBeGreaterThan(100)
    const setting = /\.(?:innerHTML|outerHTML)\s*=(?!=)|\.insertAdjacentHTML\(|\bdocument\.write(?:ln)?\(/
    expect(files.filter((path) => setting.test(readFileSync(join('src', path), 'utf8')))).toEqual([])
  })

  it('registers Nib’s own service worker and loads no other script by URL', () => {
    expect(rules.createScriptURL('/sw.js', 'TrustedScriptURL', 'ServiceWorkerContainer register')).toBe('/sw.js')
    expect(rules.createScriptURL(`${location.origin}/sw.js`, 'TrustedScriptURL', 'ServiceWorkerContainer register')).toBe(`${location.origin}/sw.js`)
    expect(rules.createScriptURL('/regex-check.js', 'TrustedScriptURL', 'Worker constructor')).toBe('/regex-check.js')
    expect(rules.createScriptURL('/assets/codeWorker-Ab_1-2.js', 'TrustedScriptURL', 'Worker constructor')).toBe('/assets/codeWorker-Ab_1-2.js')
    for (const url of ['/assets/index.js', '/assets/codeWorker-a.js?x=1', '/assets/codeWorker-a/../evil.js', 'https://elsewhere.example/assets/codeWorker-a.js', 'https://elsewhere.example/sw.js', 'https://elsewhere.example/regex-check.js', 'data:text/javascript,alert(1)', '/sw.js?x=1', '/regex-check.js?x=1']) {
      expect(() => rules.createScriptURL(url, 'TrustedScriptURL', 'HTMLScriptElement src')).toThrow()
    }
  })
})
