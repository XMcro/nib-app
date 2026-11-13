import { ed25519 } from '@noble/curves/ed25519.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import { fromBase64url } from '../../worker/base64'
import { coinsMessage } from '../../worker/signing'
import { coinRefusal, fingerprintInput, type CoinRefusal } from '../../worker/wire.mjs'
import { SERVER } from './server'

/**
 * Codes for coins, given out by Nib's maker: each worth so many coins, for
 * so many uses or any number, until its last day if it has one, and counted
 * on Nib's server (worker/coins), which is asked for each. Once on an Apple
 * Account too: the market's log (lib/market) keeps the coins, in iCloud and
 * with sync. The server knows a code only by its fingerprint. `npm run
 * coin-code` makes one there.
 */

/** What the server knows of a code. */
export const fingerprintOf = (code: string) => bytesToHex(sha256(utf8ToBytes(fingerprintInput(code))))

/**
 * The public half of the key Nib's server signs a code's coins with
 * (worker/coins, COINS_SIGNING_KEY): coins are kept only with its signature,
 * so a proxy, or a code's coins written in by hand, gives nothing.
 */
const SERVER_KEY = hexToBytes('d1f297a2eb39a454f2831e99d692c2590c87b4eb15eaa5742306e76f9f553e8f')

const verified = new Map<string, boolean>()
/** Whether `sig`, base64url, is the server's for a code's `coins` on `claim`. Each is checked once. */
export function signedByServer(fingerprint: string, claim: string, coins: number, sig: string, key = SERVER_KEY): boolean {
  const asked = `${bytesToHex(key)}|${fingerprint}|${claim}|${coins}|${sig}`
  let ok = verified.get(asked)
  if (ok === undefined) {
    try {
      ok = ed25519.verify(fromBase64url(sig), utf8ToBytes(coinsMessage(fingerprint, claim, coins)), key)
    } catch {
      ok = false
    }
    verified.set(asked, ok)
  }
  return ok
}

/** A code's coins as the log keeps them, from the market's checks on (lib/market CHECKED_FROM): the server's signed answer. */
export const codeCoinsKept = (fingerprint: string, coins: number, claim?: string, sig?: string) => !!claim && !!sig && signedByServer(fingerprint, claim, coins, sig)

export type Asked = { coins: number; sig: string } | CoinRefusal | 'offline'

/** The server's answer for a code, by its fingerprint, and `claim`, this attempt's own id: the same claim again is counted once. Coins unsigned, or not by the server, are no answer. */
export async function askForCoins(fingerprint: string, claim: string, key = SERVER_KEY): Promise<Asked> {
  try {
    const response = await fetch(`${SERVER}/v1/coins/redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: fingerprint, claim }),
    })
    if (response.ok) {
      const { coins, sig } = (await response.json()) as { coins: unknown; sig: unknown }
      const ok = Number.isInteger(coins) && (coins as number) > 0 && typeof sig === 'string' && signedByServer(fingerprint, claim, coins as number, sig, key)
      return ok ? { coins: coins as number, sig: sig as string } : 'offline'
    }
    return coinRefusal(response.status) ?? 'offline'
  } catch {
    return 'offline'
  }
}
