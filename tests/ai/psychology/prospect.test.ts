import { describe, expect, it } from 'vitest'
import {
  HUMAN_PROSPECT,
  RATIONAL_PROSPECT,
  expectedValue,
  subjectiveCallThreshold,
  subjectiveValue,
  valueOf,
  weightProbability,
} from '../../../src/ai/psychology/prospect'
import { requiredEquity } from '../../../src/math/odds'

/** A gamble that pays `win` with probability p and loses `lose` otherwise. */
const coin = (win: number, lose: number, p = 0.5) => [
  { payoff: win, probability: p },
  { payoff: -lose, probability: 1 - p },
]

describe('the value function', () => {
  it('is steeper below the reference point than above it, by exactly lambda', () => {
    // With the same curvature on both sides the ratio is lambda at every
    // size, which is what makes lambda a single interpretable number rather
    // than a fitted fudge.
    for (const x of [1, 10, 100, 1000]) {
      expect(valueOf(-x) / valueOf(x)).toBeCloseTo(-HUMAN_PROSPECT.lambda, 10)
    }
  })

  it('makes a 100 loss hurt about as much as a 250 gain pleases', () => {
    // The familiar phrasing of loss aversion is "a 100 loss ≈ a 225 gain",
    // which is lambda read off a straight line. Once the curvature is there
    // too the indifference point moves out to about 251 — same claim, and
    // worth having the real number rather than the slogan.
    const hurt = -valueOf(-100)
    let indifferent = 0
    for (let gain = 100; gain <= 400; gain += 0.5) {
      if (valueOf(gain) >= hurt) {
        indifferent = gain
        break
      }
    }
    expect(indifferent).toBeGreaterThan(240)
    expect(indifferent).toBeLessThan(260)
  })

  it('is concave in gains and convex in losses', () => {
    // Concave: the second hundred is worth less than the first.
    expect(valueOf(200) - valueOf(100)).toBeLessThan(valueOf(100) - valueOf(0))
    // Convex: the second hundred lost hurts less than the first.
    expect(valueOf(-200) - valueOf(-100)).toBeGreaterThan(valueOf(-100) - valueOf(0))
  })
})

describe('probability weighting', () => {
  it('reproduces the two anchors worth remembering', () => {
    expect(weightProbability(0.05)).toBeCloseTo(0.13, 2)
    expect(weightProbability(0.5)).toBeCloseTo(0.42, 2)
  })

  it('makes a gutshot feel twice as likely as it is', () => {
    // 4 outs on the turn is 8.7%. It feels like about 17%, which is why
    // people chase them.
    const real = 0.087
    expect(weightProbability(real)).toBeGreaterThan(real * 1.9)
    expect(weightProbability(real)).toBeLessThan(0.2)
  })

  it('makes a slight favourite feel like a coinflip, which is why they fold', () => {
    expect(weightProbability(0.6)).toBeLessThan(0.5)
    expect(weightProbability(0.8)).toBeLessThan(0.75)
  })

  it('crosses the truth once, somewhere around a third', () => {
    let crossings = 0
    let previous = weightProbability(0.01) - 0.01
    for (let p = 0.02; p < 1; p += 0.01) {
      const gap = weightProbability(p) - p
      if (Math.sign(gap) !== Math.sign(previous) && previous !== 0) crossings++
      previous = gap
    }
    expect(crossings).toBe(1)
    expect(weightProbability(0.3)).toBeGreaterThan(0.3)
    expect(weightProbability(0.4)).toBeLessThan(0.4)
  })

  it('is the identity at the ends and for a rational agent', () => {
    expect(weightProbability(0)).toBe(0)
    expect(weightProbability(1)).toBe(1)
    for (const p of [0.05, 0.25, 0.5, 0.9]) {
      expect(weightProbability(p, RATIONAL_PROSPECT)).toBeCloseTo(p, 10)
    }
  })
})

/**
 * The three behaviours the model is supposed to produce on its own. None of
 * these is written down anywhere in the implementation; they are consequences
 * of the value function's shape.
 */
describe('what the shape predicts', () => {
  it('turns down a fair coinflip, which is loss aversion', () => {
    expect(expectedValue(coin(100, 100))).toBe(0)
    expect(subjectiveValue(coin(100, 100))).toBeLessThan(0)
  })

  it('prefers a certain gain to a bigger gamble for it', () => {
    const sure = [{ payoff: 100, probability: 1 }]
    expect(subjectiveValue(sure)).toBeGreaterThan(subjectiveValue(coin(200, 0)))
  })

  it('prefers a gamble to a certain loss of the same size — the chasing mechanism', () => {
    const sure = [{ payoff: -100, probability: 1 }]
    const gamble = [
      { payoff: -200, probability: 0.5 },
      { payoff: 0, probability: 0.5 },
    ]
    expect(expectedValue(sure)).toBeCloseTo(expectedValue(gamble), 10)
    expect(subjectiveValue(gamble)).toBeGreaterThan(subjectiveValue(sure))
  })

  it('is plain expected value once every distortion is switched off', () => {
    for (const gamble of [coin(100, 100), coin(300, 50, 0.2), coin(20, 500, 0.9)]) {
      expect(subjectiveValue(gamble, RATIONAL_PROSPECT)).toBeCloseTo(expectedValue(gamble), 8)
    }
  })
})

describe('the call threshold a bias actually produces', () => {
  it('asks for more than pot odds when this pot is its own account', () => {
    // Facing 75 into 100, pot odds say 30%. A loss-averse player treating the
    // pot as a self-contained gamble needs far more than that before calling
    // feels right — the over-folding half of prospect theory.
    const honest = requiredEquity(75, 100)
    const felt = subjectiveCallThreshold(75, 100)
    expect(honest).toBeCloseTo(0.3, 6)
    expect(felt).toBeGreaterThan(honest)
    expect(felt).toBeLessThan(0.65)
  })

  it('agrees with pot odds exactly for a rational agent', () => {
    for (const [bet, pot] of [
      [50, 100],
      [75, 100],
      [100, 100],
      [200, 100],
    ]) {
      expect(subjectiveCallThreshold(bet, pot, RATIONAL_PROSPECT)).toBeCloseTo(requiredEquity(bet, pot), 6)
    }
  })
})
