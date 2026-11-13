import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy } from './csp'
import { SHARE_ORIGIN, SYNC_ORIGIN } from './hosts'

const hash = (code: string) => `'sha256-${createHash('sha256').update(code, 'utf8').digest('base64')}'`
const directive = (policy: string, name: string) => policy.split('; ').find((part) => part.startsWith(`${name} `))

describe('the app page’s Content Security Policy', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

  it('runs Nib’s own scripts and the page’s inline ones, by hash, and nothing else', async () => {
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1])
    expect(inline).toHaveLength(2)
    const scripts = directive(await contentSecurityPolicy(`${html}<script src="/registerSW.js"></script>`), 'script-src')
    expect(scripts).toBe(`script-src 'self' 'strict-dynamic' ${inline.map(hash).join(' ')}`)
  })

  // Styles set on elements stay open: React and the editor set them. A
  // <style> can't be added, nor a stylesheet from anywhere but Nib.
  it('takes the page’s own <style>, by hash, and stylesheets from Nib alone', async () => {
    const own = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((match) => match[1])
    expect(own).toHaveLength(1)
    const policy = await contentSecurityPolicy(html)
    expect(directive(policy, 'style-src-elem')).toBe(`style-src-elem 'self' ${own.map(hash).join(' ')}`)
    expect(directive(policy, 'style-src-attr')).toBe("style-src-attr 'unsafe-inline'")
  })

  // Text becomes HTML or a script's address only through a named policy:
  // the page's own (lib/trustedTypes), and ProseMirror's for pasting.
  it('turns text into HTML or script addresses only through Nib’s policies', async () => {
    const policy = await contentSecurityPolicy(html)
    expect(directive(policy, 'require-trusted-types-for')).toBe("require-trusted-types-for 'script'")
    // And the page's start, for the one script it adds (vite.config).
    expect(directive(policy, 'trusted-types')).toBe('trusted-types default ProseMirrorClipboard nib-start')
  })

  it('reaches the sync and share servers, or the one a local build names', async () => {
    expect(directive(await contentSecurityPolicy(html), 'connect-src')).toBe(`connect-src 'self' ${SYNC_ORIGIN} ${SHARE_ORIGIN}`)
    expect(directive(await contentSecurityPolicy(html, 'http://192.168.1.20:8787'), 'connect-src')).toBe("connect-src 'self' http://192.168.1.20:8787")
  })

  // Anything not named is refused: frames, plugins, audio and video, and
  // whatever kind comes next, till it's named here on purpose.
  it('refuses everything but what Nib uses, and submits no forms', async () => {
    const policy = await contentSecurityPolicy(html)
    expect(directive(policy, 'default-src')).toBe("default-src 'none'")
    expect(directive(policy, 'img-src')).toBe("img-src 'self' data:")
    // A recording attached to a note plays from the app's own files, and nowhere else: not a `blob:`, not another site.
    expect(directive(policy, 'media-src')).toBe("media-src 'self' data:")
    expect(directive(policy, 'font-src')).toBe("font-src 'self'")
    expect(directive(policy, 'manifest-src')).toBe("manifest-src 'self'")
    expect(directive(policy, 'worker-src')).toBe("worker-src 'self'")
    expect(directive(policy, 'base-uri')).toBe("base-uri 'none'")
    expect(directive(policy, 'form-action')).toBe("form-action 'none'")
    expect(policy).not.toContain('unsafe-eval')
  })
})
