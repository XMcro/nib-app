/** JSON kept in localStorage. Storage can be off, or what's there damaged: a read then gives `fallback`, and a write is let go. */

export function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return value ? (JSON.parse(value) as T) : fallback
  } catch {
    return fallback
  }
}

export function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage off: the goal still works for this session, the stamp still shows, the steps are ticked, and a reminder is set on the device all the same.
  }
}
