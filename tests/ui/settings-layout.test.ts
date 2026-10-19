import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const CSS = readFileSync(resolve(__dirname, '../../src/styles/menu.css'), 'utf8')

describe('settings screen layout', () => {
  it('theme grid is single column under 480px and never uses a min-content track', () => {
    expect(CSS).toMatch(
      /@media \(max-width: 480px\) \{\s*\.theme-grid \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    )
    expect(CSS).toMatch(/\.theme-grid \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/)
  })

  it('hint wraps instead of overflowing', () => {
    expect(CSS).toMatch(/\.settings-hint \{[^}]*overflow-wrap: anywhere/)
    expect(CSS).toMatch(/\.settings-hint \{[^}]*margin-left: 0/)
  })
})
