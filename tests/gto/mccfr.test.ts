import { describe, expect, it } from 'vitest'
import { leduc } from '../../src/gto/leduc'
import { kuhn, KUHN_VALUE } from '../../src/gto/kuhn'
import { train } from '../../src/gto/cfr'
import { trainMccfr } from '../../src/gto/mccfr'
import { exploitability, strategyValue } from '../../src/gto/exploitability'
import { createRng } from '../../src/utils/random'

describe('external sampling finds the same answers', () => {
  it('solves Kuhn to the same value the full walk does', { timeout: 30_000 }, () => {
    const result = trainMccfr(kuhn, 100_000, { rng: createRng(4) })
    expect(strategyValue(kuhn, result.strategy)).toBeCloseTo(KUHN_VALUE, 2)
    expect(exploitability(kuhn, result.strategy)).toBeLessThan(0.01)
  })

  it('reaches every information set in Leduc despite sampling its way there', { timeout: 30_000 }, () => {
    // Sampling one branch at the deck and one at the opponent still visits
    // all 288 of them, because it does it a hundred thousand times.
    expect(trainMccfr(leduc, 20_000, { rng: createRng(5) }).nodeCount).toBe(288)
  })

  it('converges on Leduc rather than plateauing, which is what unbiased means', { timeout: 120_000 }, () => {
    // The test that would catch a biased estimator: a wrong weighting
    // converges fast to the wrong place and then stops. Quadrupling the
    // iterations should keep roughly halving the exploitability, the same
    // one-over-root-T rate the full walk has.
    const runs = [20_000, 80_000, 320_000].map(
      (n) => exploitability(leduc, trainMccfr(leduc, n, { rng: createRng(9) }).strategy),
    )
    expect(runs[1]).toBeLessThan(runs[0] * 0.7)
    expect(runs[2]).toBeLessThan(runs[1] * 0.7)
    expect(runs[2]).toBeLessThan(0.03)
  })

  it('plays the same way twice from the same seed', () => {
    const first = trainMccfr(kuhn, 2_000, { rng: createRng(77) })
    const second = trainMccfr(kuhn, 2_000, { rng: createRng(77) })
    expect([...second.strategy.entries()]).toEqual([...first.strategy.entries()])
  })
})

/**
 * The comparison worth being honest about. Sampling is what makes CFR run on
 * a game too big to walk — and on a game small enough to walk, it is simply
 * worse, because the whole point of it is giving up information per iteration
 * in exchange for cheaper iterations.
 */
describe('what sampling costs on a game this small', () => {
  it('needs orders of magnitude more iterations than the full walk', { timeout: 60_000 }, () => {
    const walked = exploitability(leduc, train(leduc, 1_000).strategy)
    const sampled = exploitability(leduc, trainMccfr(leduc, 100_000, { rng: createRng(9) }).strategy)
    // A hundred times the iterations and it is still behind. On Leduc the
    // trade goes the wrong way; it only pays once walking the tree is the
    // thing you cannot afford, which is every game past this one.
    expect(sampled).toBeGreaterThan(walked * 0.9)
  })
})
