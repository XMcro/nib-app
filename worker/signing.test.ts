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
