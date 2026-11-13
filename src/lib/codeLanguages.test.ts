import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { refractor } from 'refractor/all'
import { COMMON_LANGUAGES, MORE_LANGUAGES } from './codeLanguages'

describe('the languages a code block offers', () => {
  const offered = [...Object.keys(COMMON_LANGUAGES), ...MORE_LANGUAGES]

  it('are each one Nib can colour, and none twice', () => {
    expect(offered.filter((name) => !refractor.registered(name))).toEqual([])
    expect(new Set(offered).size).toBe(offered.length)
  })

  it('leave out no grammar that ships', () => {
    const grammars = readdirSync('node_modules/refractor/lang').filter((file) => file.endsWith('.js')).map((file) => file.slice(0, -3))
    // These five add to another language's grammar, and have no name to choose.
    expect(grammars.filter((name) => !offered.includes(name))).toEqual(['css-extras', 'js-extras', 'js-templates', 'php-extras', 'xml-doc'])
  })
})
