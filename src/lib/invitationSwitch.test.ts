// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

/** Invitations are for iPhone and iPad: on the Mac they're not offered, not in Settings, and never on (lib/invitationSwitch). */

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('./platform')
  localStorage.clear()
})

describe('invitations on the Mac', () => {
  it('are nowhere: not on, whatever was kept, and so not offered or set', async () => {
    vi.doMock('./platform', () => ({ macApp: true, nativeApp: true, touchApp: false }))
    const there = await import('./invitationSwitch')
    localStorage.setItem('nib-invitations', JSON.stringify(true))
    expect(there.invitationsHere).toBe(false)
    expect(there.invitationsOn()).toBe(false)
  })

  it('and on an iPhone or iPad are as they’re set', async () => {
    vi.doMock('./platform', () => ({ macApp: false, nativeApp: true, touchApp: true }))
    const there = await import('./invitationSwitch')
    expect(there.invitationsOn()).toBe(false)
    there.setInvitationsOn(true)
    expect(there.invitationsHere).toBe(true)
    expect(there.invitationsOn()).toBe(true)
  })
})
