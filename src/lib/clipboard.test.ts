import { describe, expect, it, vi } from 'vitest'

const write = vi.hoisted(() => vi.fn(async (_options: Record<string, unknown>) => {}))
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({ write }) }))
vi.mock('./platform', () => ({ nativeApp: true }))

const { copyText, PRIVATE_COPY_MS } = await import('./clipboard')

describe('copying something private, in the app', () => {
  it('copies anything else as it was', async () => {
    await copyText('A sentence', '<p>A sentence</p>')
    expect(write).toHaveBeenLastCalledWith({ text: 'A sentence', html: '<p>A sentence</p>' })
  })

  // A sync code or a password: off the clipboard again in a few minutes,
  // but still on the writer's other devices, where it's often pasted.
  it('lets a secret go from the clipboard after a while', async () => {
    await copyText('ABCD-EFGH', undefined, { expires: true })
    expect(write).toHaveBeenLastCalledWith({ text: 'ABCD-EFGH', html: undefined, expiresIn: PRIVATE_COPY_MS })
  })

  // A locked note's text: not on the writer's other devices either (Universal Clipboard).
  it('keeps a locked note’s text on this device alone, and only for a while', async () => {
    await copyText('Sealed words', '<p>Sealed words</p>', { expires: true, thisDeviceOnly: true })
    expect(write).toHaveBeenLastCalledWith({ text: 'Sealed words', html: '<p>Sealed words</p>', expiresIn: PRIVATE_COPY_MS, localOnly: true })
  })
})
