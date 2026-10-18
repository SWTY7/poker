import { describe, expect, it } from 'vitest'
import { AVATAR_PALETTES } from '../../src/ui/avatar'

function channel(c: number): number {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast of white text on `hex`. */
function whiteContrast(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05)
}

describe('avatar palettes', () => {
  it('keep white initials at 4.5:1 or better on both stops of every gradient', () => {
    for (const [from, to] of AVATAR_PALETTES) {
      expect(whiteContrast(from), from).toBeGreaterThanOrEqual(4.5)
      expect(whiteContrast(to), to).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('has no two palettes starting on the same colour', () => {
    expect(new Set(AVATAR_PALETTES.map((p) => p[0])).size).toBe(AVATAR_PALETTES.length)
  })
})
