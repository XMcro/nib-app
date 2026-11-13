// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { keepStoragePersistent } from './storage'

/**
 * The only thing standing between a browser's storage eviction and every note
 * the user has written. jsdom implements no StorageManager, so each case
 * installs the shape it needs.
 */

const original = Object.getOwnPropertyDescriptor(navigator, 'storage')

function withStorage(value: unknown) {
  Object.defineProperty(navigator, 'storage', { value, configurable: true })
}

afterEach(() => {
  if (original) Object.defineProperty(navigator, 'storage', original)
  else Reflect.deleteProperty(navigator, 'storage')
})

describe('keepStoragePersistent', () => {
  it('asks for persistence when it does not already have it', async () => {
    const persist = vi.fn().mockResolvedValue(true)
    withStorage({ persisted: vi.fn().mockResolvedValue(false), persist })

    expect(await keepStoragePersistent()).toBe(true)
    expect(persist).toHaveBeenCalledOnce()
  })

  // Firefox prompts for this, and a prompt on every visit is its own bug.
  it('does not ask again once it has been granted', async () => {
    const persist = vi.fn()
    withStorage({ persisted: vi.fn().mockResolvedValue(true), persist })

    expect(await keepStoragePersistent()).toBe(true)
    expect(persist).not.toHaveBeenCalled()
  })

  it('reports a refusal without treating it as a failure', async () => {
    withStorage({
      persisted: vi.fn().mockResolvedValue(false),
      persist: vi.fn().mockResolvedValue(false),
    })
    expect(await keepStoragePersistent()).toBe(false)
  })

  it('survives an engine without the API', async () => {
    withStorage(undefined)
    expect(await keepStoragePersistent()).toBe(false)

    withStorage({})
    expect(await keepStoragePersistent()).toBe(false)
  })

  it('survives the call throwing', async () => {
    withStorage({
      persisted: vi.fn().mockRejectedValue(new DOMException('denied', 'SecurityError')),
      persist: vi.fn(),
    })
    expect(await keepStoragePersistent()).toBe(false)
  })
})
