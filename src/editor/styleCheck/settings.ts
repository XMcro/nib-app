import { useEffect, useReducer } from 'react'
import { RULES, type Rule } from './rules'

/**
 * Which documents the style check is on for, and which rules it runs. Kept on
 * this device, like focus mode: turning it on is a way of reading, not part
 * of the document, so it neither syncs nor travels in backups.
 */

const DOCS_KEY = 'nib-style-docs'
const OFF_KEY = 'nib-style-off'

function read(key: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []
  } catch {
    return []
  }
}

function write(key: string, value: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage off: the setting lasts for this session.
  }
  listeners.forEach((listener) => listener())
}

const listeners = new Set<() => void>()

export const checking = (id: string) => read(DOCS_KEY).includes(id)

export function setChecking(id: string, on: boolean) {
  const docs = read(DOCS_KEY).filter((entry) => entry !== id)
  write(DOCS_KEY, on ? [...docs, id] : docs)
}

export function rulesOn(): Set<Rule> {
  const off = new Set(read(OFF_KEY))
  return new Set(RULES.map((rule) => rule.id).filter((rule) => !off.has(rule)))
}

export function setRule(rule: Rule, on: boolean) {
  const off = read(OFF_KEY).filter((entry) => entry !== rule)
  write(OFF_KEY, on ? off : [...off, rule])
}

/** Calls `listener` whenever either setting changes. Returns the way to stop. */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Re-renders whenever either setting changes; read them with the functions above. */
export function useStyleSettings() {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => subscribe(rerender), [])
}
