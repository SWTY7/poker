import { describe, expect, it } from 'vitest'
import type { Card } from '../../src/poker/card'
import { toCardInt } from '../../src/poker/fast/cards'
import {
  OPEN_PERCENT,
  classStrengthOrder,
  effectiveEquity,
  hasPosition,
  openingRange,
  positionClass,
  realization,
  topPercentRange,
} from '../../src/math/realization'
import { classLabel } from '../../src/math/combos'
import { classWeight, rangeWeight } from '../../src/math/range'
import { parseRange } from '../../src/math/range'
import { boardFavours, rangeShape, recommendedSizeFraction } from '../../src/math/sizing'

const card = (spec: string): number =>
  toCardInt({
    rank: spec.slice(0, -1) as Card['rank'],
    suit: { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }[spec.slice(-1)] as Card['suit'],
  })
const board = (spec: string): number[] => spec.split(' ').map(card)

describe('position', () => {
  it('sorts seats into the groups that share a strategy', () => {
    expect(positionClass('UTG')).toBe('early')
    expect(positionClass('MP')).toBe('middle')
    expect(positionClass('CO')).toBe('late')
    expect(positionClass('BTN')).toBe('late')
    expect(positionClass('SB')).toBe('blinds')
  })

  it('knows which seats act with information after the flop', () => {
    expect(hasPosition('BTN')).toBe(true)
    expect(hasPosition('CO')).toBe(true)
    expect(hasPosition('UTG')).toBe(false)
    expect(hasPosition('BB')).toBe(false)
  })

  it('keeps more of a hand’s equity in position than out of it', () => {
    for (const type of ['made', 'marginal', 'speculative'] as const) {
      expect(realization('BTN', type)).toBeGreaterThan(realization('UTG', type))
    }
  })

  it('rewards speculative hands most for position and marginal hands least out of it', () => {
    // Suited connectors want to see cards cheaply, which is exactly what
    // acting last buys; marginal hands are the ones punished for guessing.
    expect(realization('BTN', 'speculative')).toBeGreaterThan(realization('BTN', 'made'))
    expect(realization('SB', 'marginal')).toBeLessThan(realization('SB', 'made'))
  })

  it('scales raw equity by the factor', () => {
    expect(effectiveEquity(0.5, 'BTN', 'speculative')).toBeCloseTo(0.5 * realization('BTN', 'speculative'), 12)
  })
})

/**
 * Opening ranges are derived from measured hand strength rather than
 * transcribed, so these check that the derivation lands where the
 * conventional charts do.
 */
describe('opening ranges, derived from measured strength', () => {
  it('ranks the premium hands at the top', () => {
    const order = classStrengthOrder().map(classLabel)
    expect(order[0]).toBe('AA')
    expect(order.slice(0, 5)).toContain('KK')
    expect(order.slice(0, 10)).toContain('QQ')
    // And the worst hand in poker at the bottom.
    expect(order[order.length - 1]).toBe('32o')
  })

  it('rates a suited hand above its offsuit twin, every time', () => {
    const order = classStrengthOrder().map(classLabel)
    const rank = (label: string) => order.indexOf(label)
    for (const pair of ['AK', 'KQ', 'T9', '76', '52']) {
      expect(rank(`${pair}s`)).toBeLessThan(rank(`${pair}o`))
    }
  })

  it('widens monotonically from under the gun to the button', () => {
    expect(OPEN_PERCENT.UTG).toBeLessThan(OPEN_PERCENT.MP)
    expect(OPEN_PERCENT.MP).toBeLessThan(OPEN_PERCENT.CO)
    expect(OPEN_PERCENT.CO).toBeLessThan(OPEN_PERCENT.BTN)
  })

  it('builds a range of about the requested width, counted in combos', () => {
    for (const percent of [0.1, 0.15, 0.27, 0.45]) {
      const weight = rangeWeight(topPercentRange(percent))
      expect(weight / 1326).toBeGreaterThan(percent - 0.03)
      expect(weight / 1326).toBeLessThan(percent + 0.06)
    }
  })

  it('has every seat open aces, and only the late seats open weak aces', () => {
    for (const seat of ['UTG', 'MP', 'CO', 'BTN'] as const) {
      expect(classWeight(openingRange(seat), 'AA')).toBe(6)
    }
    const utg = openingRange('UTG')
    const button = openingRange('BTN')
    expect(rangeWeight(button)).toBeGreaterThan(rangeWeight(utg))
  })

  it('contains the tighter range inside the wider one', () => {
    const utg = openingRange('UTG')
    const button = openingRange('BTN')
    for (let id = 0; id < utg.length; id++) {
      if (utg[id] > 0) expect(button[id]).toBeGreaterThan(0)
    }
  })
})

/**
 * Sizing follows from the shape of the range being bet, not from the strength
 * of the hand holding it.
 */
describe('range shape decides bet size', () => {
  it('scores a nuts-and-air range as polarized and a middling one as condensed', () => {
    const flop = board('Kh 8d 3c')
    // Sets and total air against a band of pairs that are all worth about the
    // same on this board.
    const polarized = rangeShape(parseRange('KK, 88, 33, 76s, 54s'), flop)
    const condensed = rangeShape(parseRange('99, TT, JJ, QQ'), flop)
    expect(polarized.polarization).toBeGreaterThan(condensed.polarization)
    // The polarized range really is split: about half nuts, about half air.
    expect(polarized.nutted).toBeGreaterThan(0.4)
    expect(polarized.air).toBeGreaterThan(0.4)
    // The condensed one has no air at all — every hand in it is a decent but
    // unspectacular holding, which is the definition.
    expect(condensed.air).toBe(0)
  })

  it('turns those two shapes into the two conventional sizes', () => {
    const flop = board('Kh 8d 3c')
    const polarized = rangeShape(parseRange('KK, 88, 33, 76s, 54s'), flop)
    const condensed = rangeShape(parseRange('99, TT, JJ, QQ'), flop)
    // Nuts-and-air overbets; a band of medium hands bets the minimum.
    expect(recommendedSizeFraction(polarized.polarization)).toBeGreaterThan(1)
    expect(recommendedSizeFraction(condensed.polarization)).toBeCloseTo(0.25, 6)
  })

  it('refuses to shape a range before there is a board to shape it on', () => {
    // Strength here is a percentile among the hands this board allows. Preflop
    // there is no board, so the question has no answer — better to say so than
    // to return a number that means nothing.
    expect(() => rangeShape(parseRange('AA'), [])).toThrow()
    expect(() => rangeShape(parseRange('AA'), board('Kh 8d'))).toThrow()
  })

  it('ignores hands the board itself blocks', () => {
    // Two kings on the board leave exactly one way to hold pocket kings — and
    // it is quads, the best hand available, so it sits at the top of the scale.
    expect(rangeShape(parseRange('KK'), board('Kh Kd 3c')).meanStrength).toBe(1)
    // Three kings leave no way to hold them at all, so there is nothing left
    // to shape rather than a range that is somehow weak.
    const blocked = rangeShape(parseRange('KK'), board('Kh Kd Kc'))
    expect(blocked.meanStrength).toBe(0)
    expect(blocked.nutted).toBe(0)
    expect(blocked.polarization).toBe(0)
  })

  it('turns polarization into the conventional sizes', () => {
    expect(recommendedSizeFraction(0)).toBeCloseTo(0.25, 6)
    expect(recommendedSizeFraction(1)).toBeCloseTo(1.25, 6)
    // Monotone in between, so a more polarized range never bets smaller.
    let previous = -1
    for (let p = 0; p <= 1; p += 0.1) {
      const size = recommendedSizeFraction(p)
      expect(size).toBeGreaterThan(previous)
      previous = size
    }
  })

  it('clamps nonsense input rather than recommending a negative bet', () => {
    expect(recommendedSizeFraction(-5)).toBeCloseTo(0.25, 6)
    expect(recommendedSizeFraction(50)).toBeCloseTo(1.25, 6)
  })

  it('sees the board favour the range that connects with it', () => {
    // The document's example: a preflop raiser's range against a low
    // connected board that hits a caller's range far harder.
    const raiser = parseRange('TT+, AQs+, AKo')
    const caller = parseRange('87s, 76s, 65s, 98s, 99, 88, 77, 66')
    const result = boardFavours(raiser, caller, board('8s 7s 6h'))
    expect(result.villainNutted).toBeGreaterThan(0)
    expect(result.heroNutted).toBeGreaterThan(0)
    // On this board the caller holds the top of it more often — straights and
    // sets against a range whose best hand is mostly an overpair.
    expect(result.favoursHero).toBe(false)
    expect(result.villainMean).toBeGreaterThan(result.heroMean)
  })

  it('sees the same raiser favoured on a board that misses the caller', () => {
    const raiser = parseRange('TT+, AQs+, AKo')
    const caller = parseRange('87s, 76s, 65s, 98s, 99, 88, 77, 66')
    const result = boardFavours(raiser, caller, board('Ah Kd 2c'))
    expect(result.favoursHero).toBe(true)
    // The caller's range cannot make a top-fifth hand here at all: no ace, no
    // king, and every pair in it is now an underpair.
    expect(result.villainNutted).toBe(0)
  })
})
