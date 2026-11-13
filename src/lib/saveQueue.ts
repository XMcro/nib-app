/**
 * Serialises writes so a create can never race a concurrent save.
 *
 * The catch is load-bearing: `promise.then()` on a rejected promise skips its
 * callback, so without it a single failed write would leave the chain rejected
 * and silently discard every write after it for the rest of the session.
 * `onError` is itself wrapped: a throw from the callback must not re-reject
 * the chain, or every later write is silently dropped — the original bug,
 * just one layer out.
 */
export type SaveQueue = ((task: () => Promise<void>) => Promise<void>) & {
  busy: () => boolean
}

export function createSaveQueue(onError: (error: unknown) => void): SaveQueue {
  let chain: Promise<void> = Promise.resolve()
  let inflight = 0

  const enqueue = ((task: () => Promise<void>) => {
    inflight += 1
    // Discard whatever onError returns, so the queue always resolves to void.
    chain = chain
      .then(task)
      .catch((error: unknown) => {
        try {
          onError(error)
        } catch (callbackError) {
          console.error('Nib: save error handler failed', callbackError)
        }
      })
      .finally(() => {
        inflight -= 1
      })
    return chain
  }) as SaveQueue

  enqueue.busy = () => inflight > 0
  return enqueue
}
