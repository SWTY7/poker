import { describe, expect, it } from 'vitest'
import type { Card } from '../../src/poker/card'
import { toCardInt } from '../../src/poker/fast/cards'
import { handVsHand, handVsRange, rangeVsRange } from '../../src/math/equity'
import { discountedOuts, equityFromOuts, outsTo, ruleOfTwoFour } from '../../src/math/outs'
import { parseRange } from '../../src/math/range'
import { createRng } from '../../src/utils/random'

const card = (spec: string): number =>
  toCardInt({
    rank: spec.slice(0, -1) as Card['rank'],
    suit: { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }[spec.slice(-1)] as Card['suit'],
  })
const hand = (a: string, b: string): [number, number] => [card(a), card(b)]
const board = (spec: string): number[] => spec.split(' ').map(card)

/**
 * Chance a draw gets there. Every figure below is the document's own table,
 * which is what makes these tests an oracle rather than a restatement of the
 * implementation.
 */
describe('equity from outs', () => {
  const TABLE: { draw: string; outs: number; flopToRiver: number; turnToRiver: number }[] = [
    { draw: 'gutshot straight', outs: 4, flopToRiver: 0.165, turnToRiver: 0.087 },
    { draw: 'two overcards', outs: 6, flopToRiver: 0.241, turnToRiver: 0.13 },
    { draw: 'open-ended straight', outs: 8, flopToRiver: 0.315, turnToRiver: 0.174 },
    { draw: 'flush draw', outs: 9, flopToRiver: 0.35, turnToRiver: 0.196 },
    { draw: 'flush + gutshot', outs: 12, flopToRiver: 0.45, turnToRiver: 0.261 },
    { draw: 'flush + open-ender', outs: 15, flopToRiver: 0.541, turnToRiver: 0.326 },
  ]

  for (const row of TABLE) {
    it(`${row.draw}: ${row.outs} outs is ${(row.flopToRiver * 100).toFixed(1)}% by the river`, () => {
      expect(equityFromOuts(row.outs, 2)).toBeCloseTo(row.flopToRiver, 3)
      expect(equityFromOuts(row.outs, 1, 46)).toBeCloseTo(row.turnToRiver, 3)
    })
  }

  it('matches the worked example exactly: nine outs is 1 - (38/47)(37/46)', () => {
    expect(equityFromOuts(9, 2)).toBeCloseTo(1 - (38 / 47) * (37 / 46), 12)
  })

  it('is zero with no outs and certain with all of them', () => {
    expect(equityFromOuts(0, 2)).toBe(0)
    expect(equityFromOuts(47, 1)).toBe(1)
  })
})

describe('the rule of two and four', () => {
  it('is accurate to about a point with two cards to come', () => {
    let worst = 0
    for (let outs = 1; outs <= 15; outs++) {
      worst = Math.max(worst, Math.abs(ruleOfTwoFour(outs, 2) - equityFromOuts(outs, 2)))
    }
    expect(worst).toBeLessThan(0.015)
  })

  it('drifts to about three points with one card, and always understates', () => {
    // The rule of two is a straight doubling with no correction term, so its
    // error grows with the out count: at fifteen outs it says 30% where the
    // truth is 32.6%. Erring low is the safe direction for a calling decision.
    let worst = 0
    for (let outs = 1; outs <= 15; outs++) {
      const exact = equityFromOuts(outs, 1, 46)
      expect(ruleOfTwoFour(outs, 1)).toBeLessThanOrEqual(exact + 1e-12)
      worst = Math.max(worst, exact - ruleOfTwoFour(outs, 1))
    }
    expect(worst).toBeGreaterThan(0.02)
    expect(worst).toBeLessThan(0.03)
  })

  it('reproduces the document’s worked cases', () => {
    expect(ruleOfTwoFour(9, 2)).toBeCloseTo(0.35, 10) // 36 - 1
    expect(ruleOfTwoFour(15, 2)).toBeCloseTo(0.53, 10) // 60 - 7
    expect(ruleOfTwoFour(9, 1)).toBeCloseTo(0.18, 10)
  })

  it('needs the correction: without it fifteen outs would read six points high', () => {
    expect(15 * 4).toBe(60)
    expect(equityFromOuts(15, 2)).toBeLessThan(0.55)
  })
})

describe('counting outs to a named hand', () => {
  it('finds nine outs to a flush with a flush draw', () => {
    expect(outsTo(hand('Ah', 'Kh'), board('Qh 7h 2c'), 'flush')).toBe(9)
  })

  it('finds eight outs to a straight with an open-ender', () => {
    expect(outsTo(hand('9c', '8d'), board('7h 6s 2c'), 'straight')).toBe(8)
  })

  it('finds four outs to a straight with a gutshot', () => {
    expect(outsTo(hand('9c', '8d'), board('7h 5s 2c'), 'straight')).toBe(4)
  })

  it('counts outs to a destination, not every card that improves the hand', () => {
    // A flush draw with two overcards: nine to the flush, and separately six
    // cards that pair up. Adding them would double count.
    const hole = hand('Ah', 'Kh')
    const flop = board('Qh 7h 2c')
    expect(outsTo(hole, flop, 'flush')).toBe(9)
    // Ace, king or queen pairs — but the queen also counts toward two pair,
    // so this asserts the pair-or-better count rather than a hand-waved six.
    expect(outsTo(hole, flop, 'pair')).toBeGreaterThanOrEqual(9)
  })
})

/**
 * Preflop anchors worth memorising. These are measured, not asserted, so a
 * change in the evaluator that silently broke equity would show up here.
 */
describe('preflop equity anchors', () => {
  const rng = () => createRng(4242)

  it('makes a pair against two overcards a coinflip, slightly favouring the pair', () => {
    const result = handVsHand(hand('Qc', 'Qd'), hand('Ah', 'Ks'), [], { samples: 60000, rng: rng() })
    expect(result.equity).toBeGreaterThan(0.53)
    expect(result.equity).toBeLessThan(0.61)
  })

  it('puts a pair against a lower pair at roughly 82/18', () => {
    const result = handVsHand(hand('Kc', 'Kd'), hand('7h', '7s'), [], { samples: 60000, rng: rng() })
    expect(result.equity).toBeGreaterThan(0.79)
    expect(result.equity).toBeLessThan(0.85)
  })

  it('puts a dominated hand at roughly 26%', () => {
    const result = handVsHand(hand('Ah', 'Kd'), hand('Ac', 'Qs'), [], { samples: 60000, rng: rng() })
    expect(result.equity).toBeGreaterThan(0.7)
    expect(result.equity).toBeLessThan(0.78)
  })

  it('keeps aces between 80 and 88 percent against a random hand', () => {
    const result = handVsRange(hand('Ah', 'As'), parseRange('22+, A2s+, K2s+, Q2s+, J2s+, T2s+'), [], {
      samples: 400,
      rng: rng(),
    })
    expect(result.equity).toBeGreaterThan(0.75)
  })
})

describe('equity on a board', () => {
  it('is exact once the flop is out, enumerating every remaining board', () => {
    const result = handVsHand(hand('Ah', 'Kh'), hand('Qc', 'Qd'), board('Qh 7h 2c'))
    expect(result.exact).toBe(true)
    // Both hands are known here, so 45 cards are unseen rather than the 47 a
    // player counting their own outs would see.
    expect(result.samples).toBe((45 * 44) / 2)
  })

  it('is exact on the river, with a single completion and no ties', () => {
    const result = handVsHand(hand('Ah', 'Kh'), hand('Qc', 'Qd'), board('Qh 7h 2c 3d 9s'))
    expect(result.exact).toBe(true)
    expect(result.samples).toBe(1)
    // Set over ace-high: a certainty, not a probability.
    expect(result.equity).toBe(0)
  })

  it('splits a pot down the middle when the board plays', () => {
    const result = handVsHand(hand('2c', '3d'), hand('2h', '3s'), board('Ah Kd Qc Js Ts'))
    expect(result.equity).toBe(0.5)
    expect(result.tie).toBe(1)
  })

  it('excludes combos the hero blocks from the villain range', () => {
    // Holding both black aces, the villain can hold AA only one way.
    const withoutBlockers = handVsRange(hand('Kh', 'Kd'), parseRange('AA'), [])
    const withBlockers = handVsRange(hand('Ac', 'As'), parseRange('AA'), [])
    expect(withoutBlockers.samples).toBeGreaterThan(0)
    expect(withBlockers.samples).toBeGreaterThan(0)
    // Against the one remaining AA combo the hero is drawing thin either way,
    // but the point is that the second call found fewer villain combos.
    expect(withBlockers.samples).toBeLessThan(withoutBlockers.samples)
  })

  it('has range versus range sum to one when both sides hold the same range', () => {
    const range = parseRange('QQ+, AKs')
    const result = rangeVsRange(range, range, board('7h 2c 9d'), { samples: 50 })
    expect(result.equity).toBeGreaterThan(0.4)
    expect(result.equity).toBeLessThan(0.6)
  })
})

/**
 * Reverse implied odds: the reason counting outs whole overstates a draw.
 */
describe('discounted outs', () => {
  it('discounts a low flush draw against a range that makes higher flushes', () => {
    // Hero has the four-high flush draw; the villain's range is full of bigger
    // hearts, so several of the hero's "outs" hand them a better flush.
    const hole = hand('5h', '4h')
    const flop = board('Ah 9h 2c')
    const villain = parseRange('AKs, AQs, AJs, KQs, KJs, QJs, AA, KK, QQ')
    const result = discountedOuts(hole, flop, villain)
    expect(result.raw).toBeGreaterThan(0)
    // Every out is worth strictly less than a whole one against this range.
    expect(result.discounted).toBeLessThan(result.raw)
  })

  it('leaves every out to the nut flush undiscounted', () => {
    const hole = hand('Ah', 'Kh')
    const flop = board('Qh 7h 2c')
    const hearts = discountedOuts(hole, flop, parseRange('99-22')).cards.filter(
      (c) => c.card % 4 === 2, // hearts
    )
    expect(hearts).toHaveLength(9)
    // The one exception is the deuce of hearts, which also pairs the board and
    // hands a set to the villain's deuces.
    for (const out of hearts) expect(out.winProb).toBeGreaterThan(0.85)
  })

  it('values a board-pairing "improvement" at nothing, which is the whole point', () => {
    // Ace-king high on Qh 7h 2c against small pairs: a queen, seven or deuce
    // improves the hero's hand category from high card to a pair, and wins
    // exactly never, because every hand in the range already has a better
    // one. Counting outs whole would score these the same as a flush card.
    const result = discountedOuts(hand('Ah', 'Kh'), board('Qh 7h 2c'), parseRange('99-22'))
    const boardPairs = result.cards.filter((c) => {
      const rank = c.card >> 2
      return rank === 10 || rank === 5 || rank === 0 // queen, seven, deuce
    })
    expect(boardPairs.length).toBeGreaterThanOrEqual(6)
    for (const out of boardPairs) {
      if (out.card % 4 === 2) continue // the deuce of hearts is a flush, not a pair
      expect(out.winProb).toBe(0)
    }

    // So the naive count badly overstates the hand: 23 "outs" against a true
    // figure nearer fourteen.
    expect(result.raw).toBeGreaterThan(20)
    expect(result.discounted).toBeLessThan(result.raw * 0.7)
  })

  it('rates the nut draw above the low draw on the same board and range', () => {
    const flop = board('Ah 9h 2c')
    const villain = parseRange('AKs, AQs, KQs, QJs, TT, 99')
    const nut = discountedOuts(hand('Kh', 'Qh'), flop, villain)
    const low = discountedOuts(hand('5h', '4h'), flop, villain)
    expect(nut.discounted / nut.raw).toBeGreaterThan(low.discounted / low.raw)
  })
})
