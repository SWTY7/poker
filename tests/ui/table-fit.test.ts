import { describe, expect, it } from 'vitest'
import { CROWDED_FROM, layoutFits, minFeltHeight } from '../../src/ui/table-fit'

describe('table-fit', () => {
  it('finds a layout with no overlap for 7-9 opponents at every phone width', () => {
    for (const width of [344, 360 - 32, 375 - 32, 390 - 32, 430 - 32]) {
      for (let seats = CROWDED_FROM; seats <= 9; seats++) {
        const h = minFeltHeight(seats, width)
        expect(h).toBeLessThan(1000)
        expect(layoutFits(seats, width, h)).toBe(true)
      }
    }
  })

  it('never asks for less than the floor and grows with the player count', () => {
    const w = 343
    expect(minFeltHeight(7, w, 500)).toBeGreaterThanOrEqual(500)
    expect(minFeltHeight(9, w)).toBeGreaterThanOrEqual(minFeltHeight(7, w))
  })
})
