import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import chain from './fixtures/chain.json'
import { verifyTransaction } from './jws'
import { GRACE_MS } from './paid'

const bytes = (b64: string) => Uint8Array.from(Buffer.from(b64, 'base64'))
const url = (data: Uint8Array | string) => Buffer.from(data).toString('base64url')
const NOW = Date.UTC(2027, 0, 1) // after the fixtures were issued, well before they expire

const TRANSACTION = {
  bundleId: 'app.nib.ios',
  productId: 'app.nib.plus.yearly',
  originalTransactionId: '2000000123456789',
  purchaseDate: NOW - 86_400_000,
  expiresDate: NOW + 30 * 86_400_000,
  environment: 'Production',
}

async function sign(
  payload: Record<string, unknown>,
  { x5c = [chain.leaf, chain.intermediate, chain.root], key = chain.leafKey } = {},
): Promise<string> {
  const header = url(JSON.stringify({ alg: 'ES256', x5c }))
  const body = url(JSON.stringify(payload))
  const signingKey = await crypto.subtle.importKey('pkcs8', bytes(key), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, new TextEncoder().encode(`${header}.${body}`))
  return `${header}.${body}.${url(new Uint8Array(signature))}`
}

const verify = (jws: string, options: { allowXcode?: boolean } = {}) =>
  verifyTransaction(jws, { roots: [bytes(chain.root)], now: NOW, ...options })

describe('verifyTransaction', () => {
  it('accepts a subscription signed through the trusted chain', async () => {
    expect(await verify(await sign(TRANSACTION))).toEqual({
      productId: 'app.nib.plus.yearly',
      originalTransactionId: '2000000123456789',
      expiresAt: TRANSACTION.expiresDate,
      purchasedAt: TRANSACTION.purchaseDate,
      environment: 'Production',
    })
  })

  // When it was bought is what tells a renewal after a refund from the refunded purchase.
  it('refuses a subscription that doesn’t say when it was bought', async () => {
    const { purchaseDate: _, ...undated } = TRANSACTION
    await expect(verify(await sign(undated))).rejects.toThrow('not a subscription')
  })

  // Sandbox and TestFlight purchases got production Plus, grace and all. App
  // Review buys with them, so they're still accepted, for a day at most.
  it('accepts a Sandbox purchase for a day at most, with no grace', async () => {
    const claims = await verify(await sign({ ...TRANSACTION, environment: 'Sandbox' }))
    expect(claims.expiresAt + GRACE_MS).toBe(NOW + 86_400_000)
    const soon = await verify(await sign({ ...TRANSACTION, environment: 'Sandbox', expiresDate: NOW + 300_000 }))
    expect(soon.expiresAt + GRACE_MS).toBe(NOW + 300_000)
  })

  // Only Production was checked for, so one that named no environment, or any
  // other, was paid for as Production, with seven days' grace.
  it.each([undefined, 'production', 'LocalTesting'])('pays for one whose environment is %s as Sandbox', async (environment) => {
    const { environment: _, ...unnamed } = TRANSACTION
    const claims = await verify(await sign(environment === undefined ? unnamed : { ...unnamed, environment }))
    expect(claims.expiresAt + GRACE_MS).toBe(NOW + 86_400_000)
  })

  it('refuses a chain that does not end at a trusted root', async () => {
    const apple = new Uint8Array(readFileSync(new URL('./AppleRootCA-G3.cer', import.meta.url)))
    await expect(verifyTransaction(await sign(TRANSACTION), { roots: [apple], now: NOW })).rejects.toThrow('not signed by Apple')
  })

  it('refuses a payload altered after signing', async () => {
    const [header, , signature] = (await sign(TRANSACTION)).split('.')
    const forged = url(JSON.stringify({ ...TRANSACTION, expiresDate: NOW + 100 * 365 * 86_400_000 }))
    await expect(verify(`${header}.${forged}.${signature}`)).rejects.toThrow('bad signature')
  })

  it('refuses a signature from a key other than the leaf’s', async () => {
    const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign'])
    const pkcs8 = url(new Uint8Array(await crypto.subtle.exportKey('pkcs8', other.privateKey)))
    const jws = await sign(TRANSACTION, { key: Buffer.from(pkcs8, 'base64url').toString('base64') })
    await expect(verify(jws)).rejects.toThrow('bad signature')
  })

  // Apple's markers were found as bytes anywhere in a certificate, not as
  // extensions of its own, and the intermediate wasn't asked to be a CA.
  it('refuses an intermediate whose marker is only bytes inside another extension', async () => {
    const jws = await sign(TRANSACTION, { x5c: [chain.hidden.leaf, chain.hidden.intermediate, chain.root] })
    await expect(verify(jws)).rejects.toThrow('not an App Store certificate')
  })

  it('refuses an intermediate that is not a certificate authority', async () => {
    const jws = await sign(TRANSACTION, { x5c: [chain.notCa.leaf, chain.notCa.intermediate, chain.root] })
    await expect(verify(jws)).rejects.toThrow('not an App Store certificate')
  })

  it('refuses a leaf presented without its intermediate', async () => {
    await expect(verify(await sign(TRANSACTION, { x5c: [chain.leaf, chain.root, chain.root] }))).rejects.toThrow()
  })

  it('refuses the wrong app, the wrong product, and refunds', async () => {
    await expect(verify(await sign({ ...TRANSACTION, bundleId: 'com.other.app' }))).rejects.toThrow('wrong app')
    await expect(verify(await sign({ ...TRANSACTION, productId: 'app.nib.ios.coins' }))).rejects.toThrow('wrong product')
    await expect(verify(await sign({ ...TRANSACTION, revocationDate: NOW }))).rejects.toThrow('refunded')
  })

  // Each was answered, but by an error of the wrong kind, from reading what wasn't there.
  it('says a receipt is malformed when its parts aren’t what they should be', async () => {
    const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
    const [header, payload, signature] = (await sign(TRANSACTION)).split('.')
    for (const odd of [null, 7, [1]]) {
      await expect(verify(`${part(odd)}.${payload}.${signature}`)).rejects.toThrow('malformed JWS')
      await expect(verify(`${header}.${part(odd)}.${signature}`)).rejects.toThrow('malformed JWS')
    }
    const chained = (x5c: unknown[]) => verify(`${part({ alg: 'ES256', x5c })}.${payload}.${signature}`)
    await expect(chained([chain.leaf, 7, chain.root])).rejects.toThrow('unexpected certificate chain')
    await expect(chained(Array.from({ length: 1000 }, () => chain.leaf))).rejects.toThrow('unexpected certificate chain')
    // A certificate that says its length takes four bytes, and ends before them.
    await expect(chained([Buffer.from([0x30, 0x84, 0x01]).toString('base64'), chain.intermediate, chain.root])).rejects.toThrow('truncated certificate')
  })

  it('refuses Xcode’s local test purchases unless told otherwise', async () => {
    const xcode = await sign({ ...TRANSACTION, environment: 'Xcode' }, { x5c: [chain.leaf] })
    await expect(verify(xcode)).rejects.toThrow('Xcode test transactions')
    expect((await verify(xcode, { allowXcode: true })).environment).toBe('Xcode')
  })

  it('refuses a chain used outside its certificates’ validity', async () => {
    const jws = await sign(TRANSACTION)
    await expect(verifyTransaction(jws, { roots: [bytes(chain.root)], now: Date.UTC(2060, 0, 1) })).rejects.toThrow('certificate expired')
    await expect(verifyTransaction(jws, { roots: [bytes(chain.root)], now: Date.UTC(2020, 0, 1) })).rejects.toThrow('certificate expired')
  })

  it('refuses garbage', async () => {
    await expect(verify('not.a.jws')).rejects.toThrow()
    await expect(verify('')).rejects.toThrow()
  })
})
