import { describe, expect, it } from 'vitest'
import { frontDoor, type Routes } from './door'
import { READER_PAGE } from './shares'

const SLUG = 'S'.repeat(22)
const routes = Object.fromEntries(['assets', 'notifications', 'shares', 'coins', 'counts', 'feedback', 'sync'].map((name) => [name, async () => new Response(name)])) as unknown as Routes
const answer = (path: string, method = 'GET') => frontDoor(new Request(`https://nib.test${path}`, { method, headers: { Origin: 'capacitor://localhost' } }), routes)

describe('the front door', () => {
  it.each([
    ['/v1/shares', 'shares'],
    [`/v1/shares/${SLUG}/notes`, 'shares'],
    ['/v1/coins/redeem', 'coins'],
    ['/v1/counts', 'counts'],
    ['/v1/feedback', 'feedback'],
    ['/v1/feedback/inbox', 'feedback'],
    ['/v1/feedback/messages/1', 'feedback'],
    ['/v1/app-store/notifications', 'notifications'],
    ['/v1/status', 'sync'],
    ['/v1/coins', 'sync'],
    ['/v1/countsy', 'sync'],
    ['/privacy', 'assets'],
    ['/d/short', 'assets'],
  ])('sends %s to %s', async (path, route) => {
    expect(await (await answer(path)).text()).toBe(route)
  })

  it('serves the reader page, and only by GET', async () => {
    expect(await (await answer(`/d/${SLUG}`)).text()).toBe(READER_PAGE)
    expect(await (await answer(`/d/${SLUG}`, 'POST')).text()).toBe('assets')
  })

  it.each(['/v1/shares', '/v1/coins/redeem', '/v1/counts', '/v1/feedback', '/v1/status'])('answers the app asking first about %s itself', async (path) => {
    const response = await answer(path, 'OPTIONS')
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('capacitor://localhost')
  })

  // Apple never asks first: the route answers it, as it answers anything but a POST.
  it('leaves the App Store’s path to its own route, even for OPTIONS', async () => {
    expect(await (await answer('/v1/app-store/notifications', 'OPTIONS')).text()).toBe('notifications')
  })
})
