/** Words per minute used for the reading estimate — the usual prose figure. */
const WPM = 200

/** What `\s` matches: 9 to 13, the space, and Unicode's spaces. */
function isSpace(code: number): boolean {
  if (code < 128) return code === 32 || (code >= 9 && code <= 13)
  return code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a) || code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff
}

/** Counted, not split: an array of every word, for each key pressed, is what a novel in one page felt. */
export function countWords(text: string): number {
  let words = 0
  let within = false
  for (let at = 0; at < text.length; at++) {
    const space = isSpace(text.charCodeAt(at))
    if (!space && !within) words++
    within = !space
  }
  return words
}

export function countCharacters(text: string): number {
  // Count by code points so emoji and accented letters count as one.
  return [...text].length
}

/** Whole minutes, never zero for a document that has any words in it. */
export function readingMinutes(words: number): number {
  return words === 0 ? 0 : Math.max(1, Math.round(words / WPM))
}

export function describeLength(text: string): string {
  const words = countWords(text)
  if (words === 0) return 'Empty'
  const minutes = readingMinutes(words)
  return `${words.toLocaleString()} word${words === 1 ? '' : 's'} · ${minutes} min`
}
