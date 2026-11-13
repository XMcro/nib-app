import { describe, expect, it } from 'vitest'
import { fromBase64url } from '../../worker/base64'
import { newShare, open, PASSWORD_MARK, seal, sealedBytes, validKey, validSlug, withPassword } from './crypto'

describe('share secrets', () => {
  it('are fresh each time, and the right sizes', () => {
    const a = newShare()
    const b = newShare()
    expect(validSlug(a.slug) && validKey(a.key) && validKey(a.owner)).toBe(true)
    expect(fromBase64url(a.slug)).toHaveLength(16)
    expect(fromBase64url(a.key)).toHaveLength(32)
    expect(new Set([a.slug, a.key, a.owner, b.slug, b.key, b.owner]).size).toBe(6)
  })

  it('put the key only after the #, which browsers never send', () => {
    const { slug, key } = newShare()
    const link = new URL(`https://nib.example/d/${slug}#${key}`)
    expect(link.pathname).toBe(`/d/${slug}`)
    expect(link.hash).toBe(`#${key}`)
    expect(link.href.split('#')[0]).not.toContain(key)
  })
})

describe('seal and open', () => {
  const { slug, key } = newShare()
  const doc = { v: 1, kind: 'page', body: { type: 'doc', content: [] } }

  it('round-trips', async () => {
    expect(await open(key, slug, 'doc', await seal(key, slug, 'doc', doc))).toEqual(doc)
  })

  it('fails with the wrong key, the wrong share, or the wrong role', async () => {
    const sealed = await seal(key, slug, 'doc', doc)
    await expect(open(newShare().key, slug, 'doc', sealed)).rejects.toThrow()
    await expect(open(key, newShare().slug, 'doc', sealed)).rejects.toThrow()
    await expect(open(key, slug, 'note', sealed)).rejects.toThrow()
  })

  it('detects tampering', async () => {
    const sealed = await seal(key, slug, 'note', { quote: 'a', text: 'b' })
    const bytes = fromBase64url(sealed)
    bytes[20] ^= 1
    const tampered = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    await expect(open(key, slug, 'note', tampered)).rejects.toThrow()
  })

  it('counts ciphertext bytes as the server does', async () => {
    const sealed = await seal(key, slug, 'note', { text: 'x'.repeat(100) })
    expect(sealedBytes(sealed)).toBe(fromBase64url(sealed).length)
  })
})

describe('a share with a password', () => {
  it('seals with a key from the link and the password together, never either alone', async () => {
    const { slug, key } = newShare()
    const sealKey = await withPassword(key, slug, 'tide tables')
    expect(validKey(sealKey)).toBe(true)
    expect(sealKey).not.toBe(key)
    expect(await withPassword(key, slug, 'tide tables')).toBe(sealKey)
    expect(await withPassword(key, slug, 'Tide tables')).not.toBe(sealKey)
    expect(await withPassword(newShare().key, slug, 'tide tables')).not.toBe(sealKey)
    expect(await withPassword(key, newShare().slug, 'tide tables')).not.toBe(sealKey)

    const sealed = await seal(sealKey, slug, 'doc', { body: 'kept' })
    await expect(open(key, slug, 'doc', sealed)).rejects.toThrow()
    expect(await open(sealKey, slug, 'doc', sealed)).toEqual({ body: 'kept' })
  })

  it('marks its link, so the page knows to ask', () => {
    const { slug, key } = newShare()
    expect(new URL(`https://nib.example/d/${slug}#${key}${PASSWORD_MARK}`).hash).toBe(`#${key}.p`)
  })
})
