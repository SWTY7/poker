import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TOY_GAME,
  believedOpponentStrategy,
  bettorValue,
  levelMatchValue,
  levelStrategy,
  poissonProbability,
  pureBestResponse,
  samplePoissonLevel,
} from '../../../src/ai/psychology/level-k'
import { bluffFraction, minDefenceFrequency } from '../../../src/math/odds'
import { createRng } from '../../../src/utils/random'

describe('the levelling chain', () => {
  it('starts from a player who neither bluffs nor calls', () => {
    expect(pureBestResponse(0)).toEqual({ bluff: 0, defend: 0 })
  })

  it('walks the chain the doc describes', () => {
    // 1: they never call, so bluff; they never bluff, so never call.
    expect(pureBestResponse(1)).toEqual({ bluff: 1, defend: 0 })
    // 2: they bluff constantly now, so call everything — and still bluff.
    expect(pureBestResponse(2)).toEqual({ bluff: 1, defend: 1 })
    // 3: they call everything, so stop bluffing; they still bluff, so keep calling.
    expect(pureBestResponse(3)).toEqual({ bluff: 0, defend: 1 })
  })

  it('closes into a four-cycle, which is the levelling war itself', () => {
    for (let k = 0; k < 12; k++) {
      expect(pureBestResponse(k + 4)).toEqual(pureBestResponse(k))
    }
  })

  it('believes of the opponent exactly what the level below it does', () => {
    for (const level of [1, 2, 3, 4]) {
      expect(believedOpponentStrategy(level, 75, 100)).toEqual(levelStrategy(level - 1, 75, 100))
    }
    // Level 0 has no model of anyone, so it believes level 0's own story:
    // nobody bluffs, nobody bluff-catches.
    expect(believedOpponentStrategy(0, 75, 100)).toEqual({ bluffFrequency: 0, defenceFrequency: 0 })
  })
})

describe('confidence', () => {
  it('collapses every level onto the equilibrium when nobody trusts their read', () => {
    for (const level of [0, 1, 2, 3]) {
      const strategy = levelStrategy(level, 75, 100, 0)
      expect(strategy.bluffFrequency).toBeCloseTo(bluffFraction(75, 100), 10)
      expect(strategy.defenceFrequency).toBeCloseTo(minDefenceFrequency(75, 100), 10)
    }
  })

  it('makes level stop mattering at that point, which is the right degenerate case', () => {
    const game = { ...DEFAULT_TOY_GAME, confidence: 0 }
    for (const a of [0, 1, 2, 3]) {
      for (const b of [0, 1, 2, 3]) {
        expect(levelMatchValue(a, b, game)).toBeCloseTo(0, 8)
      }
    }
  })
})

describe('the toy game', () => {
  it('pays a bluff when it works and charges for it when it does not', () => {
    const game = { ...DEFAULT_TOY_GAME, strongProbability: 0 }
    // Bluffing into someone who never calls wins the pot every time.
    expect(bettorValue(1, 0, game)).toBeCloseTo(game.pot / 2, 10)
    // Bluffing into someone who always calls loses the pot and the bet.
    expect(bettorValue(1, 1, game)).toBeCloseTo(-game.pot / 2 - game.bet, 10)
    // Giving up loses the pot but nothing else.
    expect(bettorValue(0, 1, game)).toBeCloseTo(-game.pot / 2, 10)
  })
})

/**
 * The two claims the doc makes about level-k, checked against the model
 * rather than restated.
 */
describe('what the hierarchy predicts', () => {
  it('has every level beat the one below it', () => {
    for (let k = 1; k <= 6; k++) {
      expect(levelMatchValue(k, k - 1)).toBeGreaterThan(0)
    }
  })

  it('punishes over-levelling: against a level 1, level 2 earns and level 3 does not', () => {
    const correct = levelMatchValue(2, 1)
    const overLevelled = levelMatchValue(3, 1)
    expect(correct).toBeGreaterThan(0)
    expect(overLevelled).toBeLessThan(correct)
    // With a fully committed read, thinking one step too many gives up the
    // entire edge and breaks even instead.
    expect(overLevelled).toBeCloseTo(0, 10)
  })

  it('loses money outright once the read is a lean rather than a certainty', () => {
    // At confidence 1 over-levelling merely forfeits the edge. At a realistic
    // confidence it is worse than that: level 3 is a losing strategy against
    // the level 1 who makes up most of a table.
    const game = { ...DEFAULT_TOY_GAME, confidence: 0.6 }
    expect(levelMatchValue(3, 1, game)).toBeLessThan(0)
    expect(levelMatchValue(2, 1, game)).toBeGreaterThan(0)
  })

  it('lets the player who is not thinking at all beat the one thinking hardest', () => {
    // Level 0 has no model of anyone and takes money off level 3, which has
    // three. That is the whole warning in one number.
    expect(levelMatchValue(0, 3)).toBeGreaterThan(0)
  })

  it('is zero-sum, seat for seat', () => {
    for (let a = 0; a <= 4; a++) {
      for (let b = 0; b <= 4; b++) {
        expect(levelMatchValue(a, b)).toBeCloseTo(-levelMatchValue(b, a), 10)
      }
    }
  })
})

describe('how deep a table thinks', () => {
  it('draws a Poisson with the measured mean', () => {
    const rng = createRng(31337)
    const draws = Array.from({ length: 40000 }, () => samplePoissonLevel(rng))
    const mean = draws.reduce((a, b) => a + b, 0) / draws.length
    expect(mean).toBeGreaterThan(1.44)
    expect(mean).toBeLessThan(1.56)
  })

  it('matches the distribution it claims, level by level', () => {
    const rng = createRng(4711)
    const trials = 40000
    const counts = new Array(8).fill(0)
    for (let i = 0; i < trials; i++) {
      const k = samplePoissonLevel(rng)
      if (k < counts.length) counts[k]++
    }
    for (let k = 0; k < 5; k++) {
      expect(counts[k] / trials).toBeCloseTo(poissonProbability(k, 1.5), 2)
    }
  })

  it('makes most of the table level 1, which is why reverse psychology works', () => {
    const probabilities = [0, 1, 2, 3, 4].map((k) => poissonProbability(k, 1.5))
    const mode = probabilities.indexOf(Math.max(...probabilities))
    expect(mode).toBe(1)
    // And about a fifth of any table is not thinking about you at all.
    expect(probabilities[0]).toBeCloseTo(0.223, 3)
  })

  it('never returns a negative depth', () => {
    const rng = createRng(9)
    for (let i = 0; i < 2000; i++) {
      const k = samplePoissonLevel(rng)
      expect(k).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(k)).toBe(true)
    }
  })
})
