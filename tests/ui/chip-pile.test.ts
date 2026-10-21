import { describe, expect, it } from 'vitest'
import { betPiles, stackPiles, MAX_PILES, MAX_PILE_HEIGHT } from '../../src/ui/ChipPile'

describe('ChipPile', () => {
  it('draws nothing for no bet', () => {
    expect(betPiles(0)).toEqual([])
    expect(stackPiles(0)).toEqual([])
  })

  it('splits a bet into denominations', () => {
    expect(betPiles(10)).toEqual([{ colour: 'red', count: 2 }])
    expect(betPiles(35)).toEqual([
      { colour: 'green', count: 1 },
      { colour: 'red', count: 2 },
    ])
  })

  it('keeps piles and heights bounded', () => {
    for (const a of [1, 7, 48, 333, 1234, 99999]) {
      const piles = betPiles(a)
      expect(piles.length).toBeGreaterThan(0)
      expect(piles.length).toBeLessThanOrEqual(MAX_PILES)
      for (const p of piles) expect(p.count).toBeLessThanOrEqual(MAX_PILE_HEIGHT)
    }
  })

  it('draws a bigger stack at least as tall', () => {
    const h = (n: number) => stackPiles(n).reduce((s, p) => s + p.count, 0)
    expect(h(1000)).toBeGreaterThanOrEqual(h(100))
    expect(h(5000)).toBeGreaterThanOrEqual(h(1000))
  })
})
