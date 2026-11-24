import { describe, expect, it } from 'vitest'
import { signedMessage, verifySignature } from './signing'

const base64url = (bytes: ArrayBuffer) => Buffer.from(bytes).toString('base64url')

describe('a signed request', () => {
  it('is checked against the public key, and nothing else passes', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const publicKey = base64url(await crypto.subtle.exportKey('raw', pair.publicKey))
    const message = signedMessage({ id: '0'.repeat(32), method: 'post', path: '/v1/changes', time: 1, bodyHash: 'ab' })
    const signature = base64url(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(message)))
    expect(await verifySignature(publicKey, signature, message)).toBe(true)
    expect(await verifySignature(publicKey, signature, message.replace('/v1/changes', '/v1/library'))).toBe(false)
    expect(await verifySignature(publicKey, 'A'.repeat(86), message)).toBe(false)
    expect(await verifySignature('not a key', signature, message)).toBe(false)
  })
})

describe('a signature', () => {
  // Sixteen spellings decode to the same 64 bytes: the last character's low four bits are dropped. Only the one a device writes is one.
  it('is taken in the one spelling of its bytes, and in no other', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair
    const publicKey = base64url(await crypto.subtle.exportKey('raw', pair.publicKey))
    const message = signedMessage({ id: '0'.repeat(32), method: 'POST', path: '/v1/signed-only', time: 1, bodyHash: 'ab' })
    const signature = base64url(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(message)))
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    const last = ALPHABET.indexOf(signature.at(-1)!)
    const passing = []
    for (let low = 0; low < 16; low++) {
      const spelt = signature.slice(0, -1) + ALPHABET[(last & 0b110000) | low]
      if (await verifySignature(publicKey, spelt, message)) passing.push(spelt)
    }
    expect(passing).toEqual([signature])
  })
})
