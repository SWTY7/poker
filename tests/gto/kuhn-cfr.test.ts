import { describe, expect, it } from 'vitest'
import { KUHN_VALUE, kuhn } from '../../src/gto/kuhn'
import { regretMatch, train } from '../../src/gto/cfr'
import { exploitability, strategyValue } from '../../src/gto/exploitability'
import { infoSets } from '../../src/gto/game'

/**
 * Kuhn is in the repo because its equilibrium is known in closed form. These
 * tests are that closed form, so they are an oracle: a solver that passes
 * them is right, and one that "converges nicely" while failing them is not.
 */
const solved = train(kuhn, 200_000, { plus: true })
const p = (key: string, index: number) => solved.strategy.get(key)![index]
/** Index 1 is 'b' — bet, or call when facing one. */
const BET = 1

describe('the game', () => {
  it('has twelve information sets: three cards times four spots', () => {
    expect(solved.nodeCount).toBe(12)
    expect(infoSets(solved.strategy)).toHaveLength(12)
  })

  it('is worth exactly -1/18 to the player who acts first', () => {
    // The first seat is at a structural disadvantage, and this is its size.
    // Matching it to four decimals is the strongest single check on the
    // whole solver, because nothing about the implementation aims at it.
    expect(strategyValue(kuhn, solved.strategy)).toBeCloseTo(KUHN_VALUE, 4)
    expect(solved.value).toBeCloseTo(KUHN_VALUE, 3)
  })
})

describe('the equilibrium the solver found', () => {
  it('never bets the queen out of position, which is the one pure call', () => {
    expect(p('Q:-', BET)).toBeLessThan(0.01)
  })

  it('bets the king exactly three times as often as it bluffs the jack', () => {
    // The ratio is forced: bluff any more than a third as often as you value
    // bet and the king stops getting paid off. This is Layer 1's bluff
    // frequency, derived rather than asserted.
    const alpha = p('J:-', BET)
    expect(alpha).toBeGreaterThan(0)
    expect(alpha).toBeLessThanOrEqual(1 / 3 + 0.01)
    expect(p('K:-', BET)).toBeCloseTo(3 * alpha, 2)
  })

  it('calls the queen one time in three facing a bet', () => {
    expect(p('Q:b', BET)).toBeCloseTo(1 / 3, 2)
  })

  it('bluffs the jack one time in three when checked to', () => {
    expect(p('J:p', BET)).toBeCloseTo(1 / 3, 2)
  })

  it('ties the first player’s later call to their own bluffing rate', () => {
    // Having checked the queen and been bet at, the first player calls with
    // probability alpha + 1/3 — their own bluffing frequency shows up in
    // what they can afford to call with later. Nothing in CFR knows this.
    expect(p('Q:pb', BET)).toBeCloseTo(p('J:-', BET) + 1 / 3, 2)
  })

  it('plays the obvious spots purely, because they are obvious', () => {
    expect(p('K:p', BET)).toBeGreaterThan(0.99) // always bets the king when checked to
    expect(p('K:b', BET)).toBeGreaterThan(0.99) // always calls with the king
    expect(p('K:pb', BET)).toBeGreaterThan(0.99)
    expect(p('J:b', BET)).toBeLessThan(0.01) // always folds the jack
    expect(p('J:pb', BET)).toBeLessThan(0.01)
    expect(p('Q:p', BET)).toBeLessThan(0.01) // checks the queen back
  })

  it('is a probability distribution everywhere', () => {
    for (const key of infoSets(solved.strategy)) {
      const probabilities = solved.strategy.get(key)!
      expect(probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
      for (const value of probabilities) expect(value).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('convergence', () => {
  it('gets closer to unexploitable the longer it runs', { timeout: 30_000 }, () => {
    const runs = [100, 1_000, 10_000].map((n) => exploitability(kuhn, train(kuhn, n).strategy))
    expect(runs[1]).toBeLessThan(runs[0])
    expect(runs[2]).toBeLessThan(runs[1])
    // The rate is the theoretical one: regret, and so exploitability, falls
    // like one over the square root of the iterations, so a hundredfold more
    // work buys about a tenfold better strategy.
    expect(runs[0] / runs[2]).toBeGreaterThan(5)
    expect(runs[0] / runs[2]).toBeLessThan(20)
  })

  it('is measurably helped by regret matching+ and linear averaging', { timeout: 30_000 }, () => {
    // Not by the order of magnitude CFR+ is famous for — that shows up on
    // games with more than twelve information sets — but consistently, and
    // in the same direction at every length.
    for (const n of [1_000, 10_000]) {
      const vanilla = exploitability(kuhn, train(kuhn, n).strategy)
      const plus = exploitability(kuhn, train(kuhn, n, { plus: true }).strategy)
      expect(plus).toBeLessThan(vanilla)
    }
  })

  it('returns the average strategy and not the last one', () => {
    // The distinction that decides whether any of this works. The current
    // strategy keeps moving forever and is usually close to pure; the
    // average is what converges. A solver returning the current strategy
    // would show a queen bet at 0 or 1 here rather than at a third.
    const mixed = infoSets(solved.strategy).filter((key) => {
      const [first] = solved.strategy.get(key)!
      return first > 0.02 && first < 0.98
    })
    expect(mixed.length).toBeGreaterThanOrEqual(4)
  })
})

describe('regret matching', () => {
  it('plays uniformly when nothing has been regretted yet', () => {
    expect(regretMatch([0, 0])).toEqual([0.5, 0.5])
    expect(regretMatch([-3, -1])).toEqual([0.5, 0.5])
  })

  it('splits in proportion to positive regret and ignores the rest', () => {
    expect(regretMatch([3, 1])).toEqual([0.75, 0.25])
    expect(regretMatch([3, -100])).toEqual([1, 0])
  })
})
