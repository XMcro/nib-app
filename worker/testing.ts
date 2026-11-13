import chain from './fixtures/chain.json'
import type { FileStore } from './files'
import type { Sql } from './library'

/** A file store in memory, standing in for R2: it keeps nothing that doesn't hash to what was said of it, as R2 doesn't. Test-only. */
export function memoryFiles() {
  const kept = new Map<string, Uint8Array<ArrayBuffer>>()
  const store: FileStore = {
    async put(name, body, sha256) {
      const bytes = new Uint8Array(await new Response(body).arrayBuffer())
      const digest = Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex')
      if (digest !== sha256) throw new Error('The SHA-256 checksum you specified did not match what we received.')
      kept.set(name, bytes)
      return bytes.length
    },
    async get(name) {
      const bytes = kept.get(name)
      return bytes ? { body: new Blob([bytes]).stream(), size: bytes.length } : null
    },
    async delete(names) {
      for (const name of names) kept.delete(name)
    },
    list: async (prefix) => [...kept.keys()].filter((name) => name.startsWith(prefix)).sort().slice(0, 1000),
  }
  return Object.assign(store, { kept })
}

/** Real SQLite, standing in for a Durable Object's. Test-only. */
export function sqlite(): Sql {
  // Asked of Node as it runs: Vite won't resolve an import of it for a jsdom test (src/sync/stamps.test.ts).
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
  const db = new DatabaseSync(':memory:')
  return {
    all: (query, ...args) => db.prepare(query).all(...args) as Record<string, string | number | null>[],
    run: (query, ...args) => void db.prepare(query).run(...args),
    transaction(fn) {
      db.exec('BEGIN')
      try {
        const result = fn()
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }
}

const bytes = (b64: string) => Uint8Array.from(Buffer.from(b64, 'base64'))
const url = (data: Uint8Array | string) => Buffer.from(data).toString('base64url')

/** The test chain's root (fixtures/make-chain.sh), to trust in place of Apple's. */
export const testRoot = bytes(chain.root)

/** A JWS signed as the App Store signs, through the test chain. Test-only. */
export async function appStoreSigned(payload: Record<string, unknown>, key = chain.leafKey): Promise<string> {
  const header = url(JSON.stringify({ alg: 'ES256', x5c: [chain.leaf, chain.intermediate, chain.root] }))
  const body = url(JSON.stringify(payload))
  const signingKey = await crypto.subtle.importKey('pkcs8', bytes(key), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, signingKey, new TextEncoder().encode(`${header}.${body}`))
  return `${header}.${body}.${url(new Uint8Array(signature))}`
}
