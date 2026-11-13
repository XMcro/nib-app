import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ed25519 } from '@noble/curves/ed25519.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import { normalCode } from '../../worker/wire.mjs'
import { askForCoins, codeCoinsKept, fingerprintOf, signedByServer } from './codes'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** A key pair standing in for the server's (worker/coins COINS_SIGNING_KEY). */
const secret = ed25519.utils.randomSecretKey()
const key = ed25519.getPublicKey(secret)
const sign = (coins: number, fingerprint = 'f'.repeat(64), claim = 'claim-1234', by = secret) =>
  btoa(String.fromCharCode(...ed25519.sign(utf8ToBytes(`nib-coins|${fingerprint}|${claim}|${coins}`), by)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

describe('codes for coins', () => {
  it('read the same however they’re typed, and go to the server as a fingerprint, as scripts/coin-code.mjs makes it', () => {
    expect(normalCode(' nib-abcd efgh ')).toBe('NIBABCDEFGH')
    expect(fingerprintOf('nib-abcd-efgh')).toBe(fingerprintOf('NIBABCDEFGH'))
    expect(fingerprintOf('NIB-ABCD-EFGH')).toBe(createHash('sha256').update('nib-coins:NIBABCDEFGH').digest('hex'))
  })

  it('are asked of the server by fingerprint and claim, and its answers read', async () => {
    const answers: [number, unknown][] = [
      [200, { coins: 500, sig: sign(500) }],
      [404, { error: 'unknown' }],
      [410, { error: 'ended' }],
      [409, { error: 'used up' }],
      [429, { error: 'too many' }],
      [503, { error: 'busy' }],
    ]
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => {
      const [status, body] = answers.shift()!
      return new Response(JSON.stringify(body), { status })
    })
    vi.stubGlobal('fetch', fetch)
    expect(await askForCoins('f'.repeat(64), 'claim-1234', key)).toEqual({ coins: 500, sig: sign(500) })
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({ code: 'f'.repeat(64), claim: 'claim-1234' })
    expect(fetch.mock.calls[0][0]).toMatch(/\/v1\/coins\/redeem$/)
    expect(await askForCoins('f'.repeat(64), 'claim-1234', key)).toBe('unknown')
    expect(await askForCoins('f'.repeat(64), 'claim-1234', key)).toBe('ended')
    expect(await askForCoins('f'.repeat(64), 'claim-1234', key)).toBe('used up')
    expect(await askForCoins('f'.repeat(64), 'claim-1234', key)).toBe('too many')
    expect(await askForCoins('f'.repeat(64), 'claim-1234', key)).toBe('offline')
    vi.stubGlobal('fetch', async () => Promise.reject(new TypeError('Load failed')))
    expect(await askForCoins('f'.repeat(64), 'claim-1234', key)).toBe('offline')
  })

  // A proxy on the phone could answer anything with { coins }, and the coins were kept.
  it('keep coins only as the server signed them', async () => {
    const answers: [number, unknown][] = [
      [200, { coins: 500 }],
      [200, { coins: 500, sig: sign(400) }],
      [200, { coins: 500, sig: sign(500, 'f'.repeat(64), 'claim-1234', ed25519.utils.randomSecretKey()) }],
    ]
    vi.stubGlobal('fetch', async () => {
      const [status, body] = answers.shift()!
      return new Response(JSON.stringify(body), { status })
    })
    for (let i = 0; i < 3; i++) expect(await askForCoins('f'.repeat(64), 'claim-1234', key)).toBe('offline')
    expect(signedByServer('f'.repeat(64), 'claim-1234', 500, sign(500), key)).toBe(true)
    expect(signedByServer('f'.repeat(64), 'claim-5678', 500, sign(500), key)).toBe(false)
    // Unsigned, never (a code taken before the server signed is kept by its day: lib/market CHECKED_FROM).
    expect(codeCoinsKept(fingerprintOf('NIB-EXTRA-CASH'), 500)).toBe(false)
    expect(codeCoinsKept('f'.repeat(64), 500, 'claim-1234', sign(500))).toBe(false)
  })
})
