import { describe, expect, it, vi } from 'vitest'
import { asTrades } from './market'

// Signed by the server for the one code 'print', as lib/codes would find (its key is the real server's, which no test has).
vi.mock('./codes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./codes')>()),
  codeCoinsKept: (fingerprint: string, coins: number, claim?: string, sig?: string) => fingerprint === 'print' && coins === 500 && claim === 'claim' && sig === 'sig',
}))

describe('a code’s coins in the log', () => {
  const code = { day: '2026-11-14', sold: [], kind: 'code', earned: 500, claim: 'claim', sig: 'sig' }

  it('are kept under the code’s own id', () => {
    expect(asTrades([{ ...code, id: 'code:print' }])[0].earned).toBe(500)
  })

  // The id was only cut at five characters, whatever they were: the one signed answer, copied under an id that ended
  // the same, was a second trade, counted again (the red-team review of 2026-11-17).
  it('are not kept a second time under another id that ends as the code’s does', () => {
    const read = asTrades([{ ...code, id: 'code:print' }, { ...code, id: 'xxxxxprint' }, { ...code, id: 'CODE:print' }])
    expect(read.map((trade) => trade.earned)).toEqual([500, undefined, undefined])
  })
})
