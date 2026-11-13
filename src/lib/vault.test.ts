import { afterEach, describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/react'
import { argon2idAsync } from '@noble/hashes/argon2.js'
import { base64url, fromBase64url } from '../../worker/base64'
import * as vault from './vault'

const body = (text: string): JSONContent => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

afterEach(() => vault.closeVault())

/** A vault with one locked document, then shut, as a fresh launch finds it. */
async function lockedOne(passcode = 'harbour lights') {
  await vault.openVault(passcode, [])
  const sealed = await vault.seal('doc-1', body('The ferry leaves at 07:40'))
  vault.closeVault()
  return [{ id: 'doc-1', vault: sealed }]
}

describe('the vault', () => {
  it('starts with a passcode, and seals text that only it opens', async () => {
    const locked = await lockedOne()
    expect(vault.vaultOpen()).toBe(false)
    expect(JSON.stringify(locked)).not.toContain('ferry')
    expect(await vault.unseal('doc-1', locked[0].vault)).toBeNull()

    await vault.openVault('harbour lights', locked)
    expect(await vault.unseal('doc-1', locked[0].vault)).toEqual(body('The ferry leaves at 07:40'))
    expect(vault.lockedTitle('doc-1')).toBe('The ferry leaves at 07:40')
  })

  it('refuses the wrong passcode, and knows no titles until the right one', async () => {
    const locked = await lockedOne()
    await expect(vault.openVault('harbour light', locked)).rejects.toThrow('That passcode doesn’t open the vault.')
    expect(vault.vaultOpen()).toBe(false)
    expect(vault.lockedTitle('doc-1')).toBeUndefined()
  })

  it('binds each sealed text to its document, so one can’t pass for another', async () => {
    const locked = await lockedOne()
    await vault.openVault('harbour lights', locked)
    await expect(vault.unseal('doc-2', locked[0].vault)).rejects.toThrow()
  })

  it('forgets the key and the titles when shut', async () => {
    const locked = await lockedOne()
    await vault.openVault('harbour lights', locked)
    vault.closeVault()
    expect(vault.vaultOpen()).toBe(false)
    expect(vault.lockedTitle('doc-1')).toBeUndefined()
    await expect(vault.seal('doc-2', body('x'))).rejects.toThrow('The vault is locked.')
  })

  // A copy of the library (a backup, the app's file, a Mac's storage) can be
  // guessed against offline, and a short passcode falls in moments.
  it('wants a passcode of at least eight characters for a new vault', async () => {
    await expect(vault.openVault('seven77', [])).rejects.toThrow('At least 8 characters.')
    await expect(vault.openVault('eight888', [])).resolves.toBeUndefined()
  })

  // Digits alone, or a few characters over and over, are guessed against a
  // copy of the library in hours, however long.
  it('wants more than digits, and more than a few different characters, in a new passcode', async () => {
    for (const weak of ['12345678', '9'.repeat(30), 'aaaaaaaa', 'abababab', 'abcabcabc']) expect(vault.checkPasscode(weak), weak).not.toBeNull()
    for (const fine of ['harbour lights', 'tide-7-moon', 'Abcd1234']) expect(vault.checkPasscode(fine), fine).toBeNull()
    await expect(vault.openVault('12345678', [])).rejects.toThrow('not digits alone')
    await expect(vault.openVault('abababab', [])).rejects.toThrow('more different characters')
  })

  it('wants at least eight characters for a new passcode', async () => {
    const locked = await lockedOne()
    await vault.openVault('harbour lights', locked)
    await expect(vault.changePasscode('seven77', locked)).rejects.toThrow('At least 8 characters.')
  })

  it('still opens a vault made with a shorter passcode, before eight were asked for', async () => {
    // Sealed by Nib 1.10.02 with the passcode "tide".
    const locked = [
      {
        id: 'doc-1',
        vault: {
          salt: 'gJZGG155czZXOC69NCe8wg',
          sealed:
            'd_au8mQrHpBkfMIoKrlYjwA4RJ_wfi_GJlhi05S86_hte5NawbLCck0Ep0ffa1R0RnuEg0pUEstCsK-lIT-_4YoIo33uk5IUP6EZCSa7DeECp39i-CxJ1sQs-C2K1HGSghVIyJ-QVso0KQG1frQnKk0bDPZ3wrkxdCPEdlrqTUhQtFR3',
        },
      },
    ]
    await vault.openVault('tide', locked)
    expect(await vault.unseal('doc-1', locked[0].vault)).toEqual(body('Sealed before eight'))
  })

  it('changes the passcode by resealing everything, after which only the new one opens it', async () => {
    const locked = await lockedOne()
    await vault.openVault('harbour lights', locked)
    const { sealed, adopt } = await vault.changePasscode('new tide', locked)
    adopt()
    const next = [{ id: 'doc-1', vault: sealed.get('doc-1')! }]
    vault.closeVault()

    await expect(vault.openVault('harbour lights', next)).rejects.toThrow()
    await vault.openVault('new tide', next)
    expect(await vault.unseal('doc-1', next[0].vault)).toEqual(body('The ferry leaves at 07:40'))
  })

  // The new seals are written back after this, and that can fail: the key
  // in use is swapped only once they are saved.
  it('keeps the passcode in use until the new seals are adopted', async () => {
    const locked = await lockedOne()
    await vault.openVault('harbour lights', locked)
    const { sealed, adopt } = await vault.changePasscode('new tide', locked)
    expect(await vault.unseal('doc-1', locked[0].vault)).toEqual(body('The ferry leaves at 07:40'))
    expect(await vault.unseal('doc-1', sealed.get('doc-1')!)).toBeNull()

    adopt()
    expect(await vault.unseal('doc-1', sealed.get('doc-1')!)).toEqual(body('The ferry leaves at 07:40'))
    expect(await vault.unseal('doc-1', locked[0].vault)).toBeNull()
  })

  it('won’t change the passcode while anything locked can’t be opened', async () => {
    const locked = await lockedOne()
    await expect(vault.changePasscode('new tide', locked)).rejects.toThrow('Open the vault first.')
  })

  it('takes vault records from outside only when well formed', () => {
    const good = { salt: 'A'.repeat(22), sealed: 'B'.repeat(40) }
    expect(vault.asVault(good)).toEqual(good)
    expect(vault.asVault(null)).toBeNull()
    expect(vault.asVault(undefined)).toBeUndefined()
    expect(vault.asVault({ salt: 'short', sealed: 'B'.repeat(40) })).toBeUndefined()
    expect(vault.asVault({ ...good, extra: 'dropped' })).toEqual(good)
  })
})

// PBKDF2 is quick to guess at on a GPU; Argon2id makes each guess cost
// memory as well as time. A vault's stored form is as it was: a salt made
// for Argon2id is marked by its first byte.
describe('the vault’s key', () => {
  const decrypt = async (bits: Uint8Array<ArrayBuffer>, id: string, sealed: string) => {
    const key = await crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['decrypt'])
    const bytes = fromBase64url(sealed)
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: new TextEncoder().encode(`nib-vault/${id}`) }, key, bytes.slice(12))
    return JSON.parse(new TextDecoder().decode(plain))
  }
  const argon = (passcode: string, salt: string) => argon2idAsync(passcode, fromBase64url(salt), { m: 47_104, t: 1, p: 1, dkLen: 32 })

  it('comes from Argon2id for a new vault, and opens with its passcode alone', async () => {
    const [one] = await lockedOne()
    expect(fromBase64url(one.vault.salt)[0]).toBe(0xa2)
    expect(await decrypt(await argon('harbour lights', one.vault.salt), one.id, one.vault.sealed)).toEqual(body('The ferry leaves at 07:40'))
    await expect(vault.openVault('harbour light', [one])).rejects.toThrow('doesn’t open')
    await vault.openVault('harbour lights', [one])
  })

  it('moves to Argon2id when the passcode changes', async () => {
    const locked = [
      {
        id: 'doc-1',
        vault: {
          salt: 'gJZGG155czZXOC69NCe8wg',
          sealed:
            'd_au8mQrHpBkfMIoKrlYjwA4RJ_wfi_GJlhi05S86_hte5NawbLCck0Ep0ffa1R0RnuEg0pUEstCsK-lIT-_4YoIo33uk5IUP6EZCSa7DeECp39i-CxJ1sQs-C2K1HGSghVIyJ-QVso0KQG1frQnKk0bDPZ3wrkxdCPEdlrqTUhQtFR3',
        },
      },
    ]
    await vault.openVault('tide', locked)
    const { sealed } = await vault.changePasscode('harbour lights', locked)
    const next = sealed.get('doc-1')!
    expect(await decrypt(await argon('harbour lights', next.salt), 'doc-1', next.sealed)).toEqual(body('Sealed before eight'))
  })

  // A salt from before is random, and starts with the mark 1 time in 256.
  it('still opens a vault from before whose salt starts with the mark', async () => {
    const saltBytes = crypto.getRandomValues(new Uint8Array(16))
    saltBytes[0] = 0xa2
    const salt = base64url(saltBytes)
    const secret = await crypto.subtle.importKey('raw', new TextEncoder().encode('harbour lights'), 'PBKDF2', false, ['deriveKey'])
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: 600_000 }, secret, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('nib-vault/old') }, key, new TextEncoder().encode(JSON.stringify(body('From before'))))
    const old = { id: 'old', vault: { salt, sealed: base64url(new Uint8Array([...iv, ...new Uint8Array(cipher)])) } }
    await vault.openVault('harbour lights', [old])
    expect(await vault.unseal('old', old.vault)).toEqual(body('From before'))
  })
})
