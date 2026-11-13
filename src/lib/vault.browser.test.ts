import { expect, it } from 'vitest'
import Dexie from 'dexie'
import { box, unbox } from './vault'

/** The key copies are boxed under, kept in a real browser's IndexedDB. */

it('boxes a copy under a key the browser keeps and won’t give out', async () => {
  const body = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'the losing edit' }] }] }
  const boxed = await box('copy', body)
  expect(boxed).not.toContain('losing')
  expect(await unbox('copy', boxed)).toEqual(body)
  expect(await unbox('another', boxed)).toBeNull()

  const device = new Dexie('nib-device')
  device.version(1).stores({ keys: 'k' })
  const { key } = await device.table('keys').get('copies')
  expect(key).toBeInstanceOf(CryptoKey)
  expect(key.extractable).toBe(false)
  device.close()
})
