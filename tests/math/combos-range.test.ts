import { describe, expect, it } from 'vitest'
import { toCardInt } from '../../src/poker/fast/cards'
import type { Card } from '../../src/poker/card'
import {
  COMBO_COUNT,
  CLASS_COUNT,
  allClassIndices,
  classComboCount,
  classFromLabel,
  classLabel,
  comboId,
} from '../../src/math/combos'
import {
  classWeight,
  fullRange,
  parseRange,
  rangeClasses,
  rangeWeight,
  removeBlockers,
} from '../../src/math/range'

const card = (spec: string): number =>
  toCardInt({
    rank: spec.slice(0, -1) as Card['rank'],
    suit: { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }[spec.slice(-1)] as Card['suit'],
  })

/** The counting basis: the numbers every range argument is built on. */
describe('the counting basis', () => {
  it('has 1326 combos and 169 classes', () => {
    expect(COMBO_COUNT).toBe(1326)
    expect(allClassIndices()).toHaveLength(CLASS_COUNT)
    expect(CLASS_COUNT).toBe(169)
  })

  it('splits 169 classes into 13 pairs, 78 suited and 78 offsuit', () => {
    const labels = allClassIndices().map(classLabel)
    expect(labels.filter((l) => l.length === 2)).toHaveLength(13)
    expect(labels.filter((l) => l.endsWith('s'))).toHaveLength(78)
    expect(labels.filter((l) => l.endsWith('o'))).toHaveLength(78)
  })

  it('deals a pair 6 ways, a suited hand 4 and an offsuit hand 12', () => {
    expect(classComboCount(classFromLabel('KK'))).toBe(6)
    expect(classComboCount(classFromLabel('AKs'))).toBe(4)
    expect(classComboCount(classFromLabel('AKo'))).toBe(12)
    // 4 + 12 is the 16 combos of "AK" with no suit specified.
    expect(classComboCount(classFromLabel('AKs')) + classComboCount(classFromLabel('AKo'))).toBe(16)
  })

  it('round-trips every class label', () => {
    for (const index of allClassIndices()) {
      expect(classFromLabel(classLabel(index))).toBe(index)
    }
  })

  it('gives the same combo id whichever order the cards come in', () => {
    expect(comboId(card('Ah'), card('Kd'))).toBe(comboId(card('Kd'), card('Ah')))
  })

  it('refuses a pair with a suit suffix, since there is no such hand', () => {
    expect(() => classFromLabel('AAs')).toThrow()
    expect(() => classFromLabel('AK')).toThrow()
  })
})

/**
 * Card removal is the whole reason ranges are stored by combo. These are the
 * document's own examples.
 */
describe('card removal', () => {
  it('drops AK from 16 combos to 12, and AA from 6 to 3, when an ace is out', () => {
    const range = parseRange('AA, AKs, AKo')
    expect(classWeight(range, 'AA')).toBe(6)
    expect(classWeight(range, 'AKs') + classWeight(range, 'AKo')).toBe(16)

    const withAceOut = removeBlockers(range, [card('Ah')])
    expect(classWeight(withAceOut, 'AA')).toBe(3)
    expect(classWeight(withAceOut, 'AKs') + classWeight(withAceOut, 'AKo')).toBe(12)
  })

  it('leaves a full range with 1225 combos once a board of three is out', () => {
    const board = [card('Ah'), card('7c'), card('2d')]
    // 49 unseen cards choose 2.
    expect(rangeWeight(removeBlockers(fullRange(), board))).toBe((49 * 48) / 2)
  })
})

describe('range notation', () => {
  it('reads a plain list', () => {
    const range = parseRange('AA, KK, AKs')
    expect(rangeWeight(range)).toBe(6 + 6 + 4)
  })

  it('climbs pairs with +', () => {
    expect(rangeClasses(parseRange('TT+'))).toEqual(['TT', 'JJ', 'QQ', 'KK', 'AA'])
    expect(rangeWeight(parseRange('88+'))).toBe(7 * 6)
  })

  it('climbs the kicker with + on a shared high card', () => {
    expect(rangeClasses(parseRange('AQs+')).sort()).toEqual(['AKs', 'AQs'])
    expect(rangeWeight(parseRange('AQs+'))).toBe(8)
  })

  it('walks a span of pairs and a span of kickers', () => {
    expect(rangeClasses(parseRange('88-55')).sort()).toEqual(['55', '66', '77', '88'])
    expect(rangeClasses(parseRange('A5s-A2s')).sort()).toEqual(['A2s', 'A3s', 'A4s', 'A5s'])
  })

  it('carries a fractional weight for a hand played some of the time', () => {
    const range = parseRange('AA, 76s:0.5')
    expect(classWeight(range, 'AA')).toBe(6)
    expect(classWeight(range, '76s')).toBeCloseTo(2, 10)
  })

  it('refuses a span whose ends are different shapes', () => {
    expect(() => parseRange('A5s-K2s')).toThrow()
    expect(() => parseRange('AKs-AQo')).toThrow()
  })

  it('reads a realistic opening range without complaint', () => {
    const range = parseRange('77+, ATs+, KQs, AJo+, 65s:0.25')
    expect(rangeWeight(range)).toBeGreaterThan(0)
    expect(classWeight(range, 'AA')).toBe(6)
    expect(classWeight(range, '65s')).toBeCloseTo(1, 10)
    expect(classWeight(range, '22')).toBe(0)
  })
})
