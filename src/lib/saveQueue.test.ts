import { describe, expect, it, vi } from 'vitest'
import { createSaveQueue } from './saveQueue'

describe('createSaveQueue', () => {
  it('runs tasks one at a time, in order', async () => {
    const order: string[] = []
    const enqueue = createSaveQueue(() => {})

    enqueue(async () => {
      await new Promise((r) => setTimeout(r, 20))
      order.push('first')
    })
    await enqueue(async () => {
      order.push('second')
    })

    expect(order).toEqual(['first', 'second'])
  })

  it('keeps saving after a failure — the whole point of the queue', async () => {
    const onError = vi.fn()
    const enqueue = createSaveQueue(onError)
    const done: string[] = []

    await enqueue(async () => {
      throw new Error('storage unavailable')
    })
    await enqueue(async () => {
      done.push('later write')
    })

    expect(onError).toHaveBeenCalledTimes(1)
    expect(done).toEqual(['later write'])
  })

  it('survives several consecutive failures', async () => {
    const onError = vi.fn()
    const enqueue = createSaveQueue(onError)
    let succeeded = false

    for (let i = 0; i < 3; i++) {
      await enqueue(async () => {
        throw new Error(`failure ${i}`)
      })
    }
    await enqueue(async () => {
      succeeded = true
    })

    expect(onError).toHaveBeenCalledTimes(3)
    expect(succeeded).toBe(true)
  })

  it('hands the error to onError and never rejects to the caller', async () => {
    const errors: unknown[] = []
    const enqueue = createSaveQueue((error) => errors.push(error))
    const boom = new Error('quota exceeded')

    await expect(
      enqueue(async () => {
        throw boom
      }),
    ).resolves.toBeUndefined()
    expect(errors).toEqual([boom])
  })

  it('leaves successful tasks untouched', async () => {
    const onError = vi.fn()
    const enqueue = createSaveQueue(onError)
    const seen: number[] = []

    await Promise.all([1, 2, 3].map((n) => enqueue(async () => void seen.push(n))))

    expect(seen).toEqual([1, 2, 3])
    expect(onError).not.toHaveBeenCalled()
  })

  it('reports in-flight work so unload can warn', async () => {
    const enqueue = createSaveQueue(() => {})
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    expect(enqueue.busy()).toBe(false)
    const running = enqueue(() => gate)
    expect(enqueue.busy()).toBe(true)
    release()
    await running
    expect(enqueue.busy()).toBe(false)
  })

  it('keeps saving even if onError itself throws', async () => {
    const enqueue = createSaveQueue(() => {
      throw new Error('setState on unmounted component')
    })
    let succeeded = false

    await enqueue(async () => {
      throw new Error('storage unavailable')
    })
    await enqueue(async () => {
      succeeded = true
    })

    expect(succeeded).toBe(true)
  })
})
