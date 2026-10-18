import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CROWDED_FROM, RING, layoutFits, minFeltHeight } from '../../src/ui/table-fit'

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

  it('uses the same ring numbers in layout-round.css as RING', () => {
    const css = readFileSync('src/styles/layout-round.css', 'utf8')
    // The rule that sets the crowded ring: the .felt rule with data-seats under .table-main[data-crowded].
    const start = css.indexOf('.table-main[data-crowded] .felt[data-seats] {')
    expect(start).toBeGreaterThan(-1)
    const block = css.slice(start, css.indexOf('}', start))
    const num = (name: string) => {
      const m = block.match(new RegExp(String.raw`--${name}:\s*([\d.]+)%`))
      expect(m, name).not.toBeNull()
      return parseFloat(m![1]) / 100
    }
    expect(num('rx')).toBeCloseTo(RING.rx)
    expect(num('ry')).toBeCloseTo(RING.ry)
    expect(num('cy')).toBeCloseTo(RING.cy)
    expect(num('rdrop')).toBeCloseTo(RING.rdrop)
    expect(num('bshift')).toBe(0)
  })
})
