import { describe, expect, it } from 'vitest'
import {
  bluffFraction,
  breakEvenBluffFrequency,
  impliedOddsNeeded,
  minDefenceFrequency,
  potOddsRatio,
  requiredEquity,
  requiredEquityForPotFraction,
  requiredEquityImplied,
} from '../../src/math/odds'

/**
 * The single most useful table at a live table, asserted against the
 * document's figures rather than against the formula that produces them.
 */
describe('pot odds', () => {
  const TABLE: [string, number, number][] = [
    ['1/4 pot', 0.25, 0.167],
    ['1/3 pot', 1 / 3, 0.2],
    ['1/2 pot', 0.5, 0.25],
    ['2/3 pot', 2 / 3, 0.286],
    ['pot', 1, 0.333],
    ['1.5x pot', 1.5, 0.375],
    ['2x pot', 2, 0.4],
  ]

  for (const [label, fraction, required] of TABLE) {
    it(`${label} needs ${(required * 100).toFixed(1)}% to call`, () => {
      expect(requiredEquityForPotFraction(fraction)).toBeCloseTo(required, 2)
      expect(requiredEquity(fraction * 100, 100)).toBeCloseTo(required, 2)
    })
  }

  it('works the document’s example: $75 into $100 needs 30%', () => {
    expect(requiredEquity(75, 100)).toBeCloseTo(0.3, 6)
  })

  it('needs nothing when there is nothing to call', () => {
    expect(requiredEquity(0, 100)).toBe(0)
  })

  it('reports the ratio players say out loud', () => {
    // $50 into $100: risking 50 to win 150, which is 3 to 1.
    expect(potOddsRatio(50, 100)).toBeCloseTo(3, 10)
  })
})

describe('implied odds', () => {
  it('turns the documented fold into a breakeven call', () => {
    // Turn flush draw: 19.6% against a $75 bet into $100, which raw pot odds
    // reject at 30%. Expecting another $120 on the river when it hits drops
    // the requirement to about 20%.
    expect(requiredEquity(75, 100)).toBeCloseTo(0.3, 6)
    expect(requiredEquityImplied(75, 100, 120)).toBeCloseTo(0.203, 3)
  })

  it('never asks for more once future money is counted', () => {
    for (let extra = 0; extra <= 500; extra += 50) {
      expect(requiredEquityImplied(75, 100, extra)).toBeLessThanOrEqual(requiredEquity(75, 100) + 1e-12)
    }
  })

  it('says how much future money a given equity needs, and agrees with itself', () => {
    const needed = impliedOddsNeeded(75, 100, 0.196)
    expect(needed).toBeGreaterThan(0)
    expect(requiredEquityImplied(75, 100, needed)).toBeCloseTo(0.196, 6)
  })
})

/**
 * The two results the document calls "the whole game in miniature": how often
 * a bettor must be bluffing, and how often a defender must continue.
 */
describe('equilibrium frequencies', () => {
  const BLUFFS: [string, number, number][] = [
    ['1/2 pot', 0.5, 0.25],
    ['3/4 pot', 0.75, 0.3],
    ['pot', 1, 0.333],
    ['2x pot', 2, 0.4],
  ]

  for (const [label, fraction, bluffs] of BLUFFS) {
    it(`${label} is ${(bluffs * 100).toFixed(0)}% bluffs`, () => {
      expect(bluffFraction(fraction * 100, 100)).toBeCloseTo(bluffs, 2)
    })
  }

  it('is the same number as the equity a call needs, which is the point', () => {
    // A bettor bluffing at exactly the frequency that makes the call break
    // even has left nothing to exploit. That the two formulas coincide is the
    // definition of indifference, not a coincidence worth hiding.
    for (const bet of [25, 50, 75, 100, 200]) {
      expect(bluffFraction(bet, 100)).toBe(requiredEquity(bet, 100))
    }
  })

  it('reads as the ratios players quote: 1 bluff per 3 value bets at half pot', () => {
    const half = bluffFraction(50, 100)
    expect(half / (1 - half)).toBeCloseTo(1 / 3, 6)
    const pot = bluffFraction(100, 100)
    expect(pot / (1 - pot)).toBeCloseTo(1 / 2, 6)
  })

  const DEFENCE: [string, number, number][] = [
    ['1/3 pot', 1 / 3, 0.75],
    ['1/2 pot', 0.5, 0.667],
    ['3/4 pot', 0.75, 0.571],
    ['pot', 1, 0.5],
    ['2x pot', 2, 0.333],
  ]

  for (const [label, fraction, defend] of DEFENCE) {
    it(`${label} must be defended ${(defend * 100).toFixed(0)}% of the time`, () => {
      expect(minDefenceFrequency(fraction * 100, 100)).toBeCloseTo(defend, 2)
    })
  }

  it('has defence and break-even bluff frequency sum to one', () => {
    for (const bet of [25, 50, 75, 100, 200]) {
      expect(minDefenceFrequency(bet, 100) + breakEvenBluffFrequency(bet, 100)).toBeCloseTo(1, 12)
    }
  })

  it('shows the asymmetry that makes overbetting work', () => {
    // A bigger bet must contain more bluffs — but it also lets the defender
    // fold much more. Going from pot to twice pot costs seven points of extra
    // bluffing and buys seventeen points of extra folds.
    const bluffCost = bluffFraction(200, 100) - bluffFraction(100, 100)
    const foldGain = minDefenceFrequency(100, 100) - minDefenceFrequency(200, 100)
    expect(bluffCost).toBeGreaterThan(0)
    expect(foldGain).toBeGreaterThan(bluffCost)
  })
})
