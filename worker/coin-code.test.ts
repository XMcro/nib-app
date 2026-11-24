import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

/**
 * `npm run coin-code` (scripts/coin-code.mjs), run as it is, at a server that isn't there: what it refuses, it
 * refuses before it asks any server anything. An option misspelt, or given as --name=value, was passed over, and a
 * code meant for five uses was made for any number (the server audit of 2026-11-23).
 */
/** `npm`: what npm has kept for itself of a command typed with no -- before its options, as it says it to the script. */
const run = (args: string[], npm: Record<string, string> = {}) => {
  // Nowhere: port 9 takes nothing. And a secret that's no one's.
  const { status, stdout, stderr } = spawnSync(process.execPath, ['scripts/coin-code.mjs', ...args], { encoding: 'utf8', env: { ...process.env, NIB_SERVER: 'http://127.0.0.1:9', COINS_ADMIN: 'not-a-secret', ...npm } })
  return { status, said: stdout + stderr }
}

describe('npm run coin-code -- make', () => {
  it.each([
    [['make', '100', '--use', '5'], /Not understood: --use/],
    [['make', '100', '--uses=5'], /Not understood: --uses=5/],
    [['make', '100', '--until=2026-12-31'], /Not understood: --until=2026-12-31/],
    [['make', '100', '--uses'], /--uses needs a value/],
    [['make', '100', '--code'], /--code needs a value/],
    [['make', '100', '--uses', '--until', '2026-12-31'], /--uses needs a value/],
    // The last was taken: a code meant for five uses, made for any number (found checking the fix, 2026-11-23).
    [['make', '100', '--uses', '5', '--uses', 'none'], /--uses is given twice/],
  ])('refuses %j, and asks no server', (args, refusal) => {
    const { status, said } = run(args)
    expect(said).toMatch(refusal)
    expect(said).not.toMatch(/Couldn.t reach/)
    expect(status).toBe(1)
  })

  it('takes its options spelt right as far as the server, which here isn’t there', () => {
    const { status, said } = run(['make', '100', '--uses', '5', '--until', '2099-12-31'])
    expect(said).toMatch(/Couldn.t reach http:\/\/127\.0\.0\.1:9/)
    expect(status).toBe(1)
  })

  // npm run coin-code make 100 --uses 5, with no -- before it: npm keeps --uses for itself and says nothing, the
  // script was run with "make 100" alone, and the code was made for any number of uses (found checking the fix, 2026-11-23).
  it.each([[{ npm_config_uses: '5' }, /npm took --uses/], [{ npm_config_until: '2026-12-31', npm_config_code: 'true' }, /npm took --until and --code/]])('refuses when npm has kept %j for itself, and asks no server', (npm, refusal) => {
    const { status, said } = run(['make', '100'], npm)
    expect(said).toMatch(refusal)
    expect(said).not.toMatch(/Couldn.t reach/)
    expect(status).toBe(1)
  })
})
