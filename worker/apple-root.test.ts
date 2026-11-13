import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { APPLE_ROOT_G3 } from './apple-root'

it('inlines exactly the certificate Apple publishes', async () => {
  const cer = readFileSync(new URL('./AppleRootCA-G3.cer', import.meta.url))
  expect(Buffer.from(APPLE_ROOT_G3, 'base64').equals(cer)).toBe(true)
  const digest = Buffer.from(await crypto.subtle.digest('SHA-256', cer)).toString('hex')
  expect(digest).toBe('63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179')
})
