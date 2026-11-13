// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { effectiveTheme, isTheme, NAMED, named, readTheme, themeLabel, writeTheme } from './theme'

afterEach(() => localStorage.clear())

describe('themes', () => {
  it('remembers a named theme, and forgets anything it does not know', () => {
    writeTheme('pastel-pink')
    expect(readTheme()).toBe('pastel-pink')
    localStorage.setItem('nib-theme', 'neon-sunset')
    expect(readTheme()).toBe('system')
  })

  it('has eleven named themes, four of them Nib Plus, the last in its badge’s colours', () => {
    // Winter is earned, not bought: a light one, never Plus's (lib/rewards gives it).
    expect(named('winter')).toMatchObject({ dark: false, plus: false })
    expect(effectiveTheme('winter', { active: false, known: true })).toBe('winter')
    expect(NAMED.filter((one) => one.plus).map((one) => one.id)).toEqual(['purple-green', 'alien-pink', 'drcl', 'nib-plus'])
    expect(themeLabel('drcl')).toBe('drcl')
    // Asked for 2026-11-13: the badge's graphite, its nib's white, and its glow's periwinkle.
    expect(named('nib-plus')).toMatchObject({ label: 'Nib Plus', dark: true, plus: true })
    expect(effectiveTheme('nib-plus', { active: false, known: true })).toBe('system')
    expect(themeLabel('system')).toBe('System')
  })

  it('shows a Plus theme only with Plus, and the chosen one until the App Store answers', () => {
    expect(effectiveTheme('alien-pink', { active: true, known: true })).toBe('alien-pink')
    expect(effectiveTheme('alien-pink', { active: false, known: true })).toBe('system')
    expect(effectiveTheme('alien-pink', { active: false, known: false })).toBe('alien-pink')
    expect(effectiveTheme('clean-blue', { active: false, known: true })).toBe('clean-blue')
    expect(effectiveTheme('dark', { active: false, known: true })).toBe('dark')
  })
})

describe('a theme of one’s own', () => {
  it('is a theme, remembered, called Your own', () => {
    expect(isTheme('custom')).toBe(true)
    writeTheme('custom')
    expect(readTheme()).toBe('custom')
    expect(themeLabel('custom')).toBe('Your own')
  })

  // Like a Plus named theme: System without Plus, but not before the App Store has answered.
  it('is Nib Plus', () => {
    expect(effectiveTheme('custom', { active: false, known: true })).toBe('system')
    expect(effectiveTheme('custom', { active: false, known: false })).toBe('custom')
    expect(effectiveTheme('custom', { active: true, known: true })).toBe('custom')
  })
})
