import { describe, expect, it, vi } from 'vitest'
import { shareUrl } from '../share'
import { newShare } from '../share/crypto'
import { SERVER } from './server'

vi.mock('./platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./platform')>()),
  nativeApp: true,
}))

describe('in the app', () => {
  // Nib's own domain, not the Cloudflare account's workers.dev name, which
  // older Nibs still sync with (wrangler.jsonc workers_dev).
  it('syncs with the Worker under nibprivacy.com, and gives readers links there too', () => {
    const share = { ...newShare(), createdAt: 1, expiresAt: 2 }
    expect(SERVER).toBe('https://sync.nibprivacy.com')
    expect(shareUrl(share)).toBe(`https://share.nibprivacy.com/d/${share.slug}#${share.key}`)
  })
})
