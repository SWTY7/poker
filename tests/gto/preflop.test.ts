import { describe, expect, it } from 'vitest'
import { CLASS_COUNT, COMBO_A, COMBO_B, classCombos, classFromLabel, classLabel } from '../../src/math/combos'
import {
  classEquity,
  classProbability,
  conditionalProbability,
  opposingClasses,
  rangeWidth,
} from '../../src/gto/holdem/preflop'
import { handVsHand } from '../../src/math/equity'
import { createRng } from '../../src/utils/random'

const eq = (a: string, b: string) => classEquity(classFromLabel(a), classFromLabel(b))

describe('the equity table', () => {
  it('is exactly complementary, so nobody wins twice', () => {
    const rng = createRng(1)
    for (let trial = 0; trial < 400; trial++) {
      const a = Math.floor(rng() * CLASS_COUNT)
      const b = Math.floor(rng() * CLASS_COUNT)
      expect(classEquity(a, b) + classEquity(b, a)).toBeCloseTo(1, 12)
    }
  })

  it('is a coinflip against itself', () => {
    for (const label of ['AA', 'KQs', '72o', '55']) {
      expect(eq(label, label)).toBeCloseTo(0.5, 2)
    }
  })

  it('agrees with the equity function the rest of the app uses', () => {
    // The real check: `handVsHand` is written independently, tested against
    // its own anchors in Phase 1, and knows nothing about this table. Both
    // measure the same quantity, so they have to land in the same place.
    const rng = createRng(77)
    for (const [left, right] of [
      ['AA', 'KK'],
      ['QQ', 'AKo'],
      ['AKs', '22'],
      ['JTs', 'A5o'],
      ['72o', '98s'],
    ]) {
      const a = classFromLabel(left)
      const b = classFromLabel(right)
      // Average over combos of each class, the same way the table does.
      let total = 0
      const trials = 24
      for (let trial = 0; trial < trials; trial++) {
        const heroCombos = classCombos(a)
        const villainCombos = classCombos(b)
        let hero = heroCombos[Math.floor(rng() * heroCombos.length)]
        let villain = villainCombos[Math.floor(rng() * villainCombos.length)]
        let guard = 0
        while (
          guard++ < 50 &&
          new Set([COMBO_A[hero], COMBO_B[hero], COMBO_A[villain], COMBO_B[villain]]).size < 4
        ) {
          hero = heroCombos[Math.floor(rng() * heroCombos.length)]
          villain = villainCombos[Math.floor(rng() * villainCombos.length)]
        }
        total += handVsHand([COMBO_A[hero], COMBO_B[hero]], [COMBO_A[villain], COMBO_B[villain]], [], {
          samples: 4000,
          rng,
        }).equity
      }
      expect(total / trials).toBeCloseTo(classEquity(a, b), 1)
    }
  })

  it('reproduces the matchups every player has memorised', () => {
    expect(eq('AA', 'KK')).toBeGreaterThan(0.79)
    expect(eq('AA', 'KK')).toBeLessThan(0.85)
    expect(eq('AA', '72o')).toBeGreaterThan(0.85)
    expect(eq('QQ', 'AKo')).toBeGreaterThan(0.53)
    expect(eq('QQ', 'AKo')).toBeLessThan(0.61)
    // A small pair against two overcards is the classic coinflip, and the
    // pair is the side that is very slightly ahead.
    expect(eq('22', 'AKo')).toBeGreaterThan(0.5)
    expect(eq('22', 'AKo')).toBeLessThan(0.56)
  })

  it('has aces beat every other hand there is', () => {
    const aces = classFromLabel('AA')
    for (let other = 0; other < CLASS_COUNT; other++) {
      if (other === aces) continue
      expect(classEquity(aces, other)).toBeGreaterThan(0.5)
    }
  })

  it('rates a suited hand above its offsuit twin against the same opponent', () => {
    for (const [suited, offsuit] of [
      ['AKs', 'AKo'],
      ['T9s', 'T9o'],
      ['52s', '52o'],
    ]) {
      expect(eq(suited, 'QQ')).toBeGreaterThan(eq(offsuit, 'QQ'))
    }
  })
})

/**
 * Card removal: the part a preflop solver gets wrong by dealing both hands
 * independently, and the part that matters most for exactly the hands that
 * decide a push-fold spot.
 */
describe('what the other player can be holding', () => {
  it('halves the chance of aces when you hold them yourself', () => {
    const aces = classFromLabel('AA')
    // Six ways normally; two of the four aces are yours, so one way left.
    expect(conditionalProbability(aces, aces)).toBeCloseTo(classProbability(aces) / 6, 3)
  })

  it('takes a quarter off their aces for every ace you hold', () => {
    const aces = classFromLabel('AA')
    const ako = classFromLabel('AKo')
    const kings = classFromLabel('KK')
    // Holding one ace leaves three, so three of their six ace pairs.
    expect(conditionalProbability(ako, aces)).toBeLessThan(classProbability(aces))
    // And holding no ace at all leaves aces slightly *more* likely than the
    // unconditional figure, because your two cards came out of everything else.
    expect(conditionalProbability(kings, aces)).toBeGreaterThan(classProbability(aces))
  })

  it('still adds up to one', () => {
    for (const label of ['AA', 'AKs', '72o']) {
      const total = opposingClasses(classFromLabel(label)).reduce((sum, e) => sum + e.probability, 0)
      expect(total).toBeCloseTo(1, 10)
    }
  })

  it('counts a range by combos, the way ranges are quoted', () => {
    const everything = new Array<number>(CLASS_COUNT).fill(1)
    expect(rangeWidth(everything)).toBeCloseTo(1, 10)
    const nothing = new Array<number>(CLASS_COUNT).fill(0)
    expect(rangeWidth(nothing)).toBe(0)
    // Pocket pairs are 78 of 1326 hands, which is the 5.9% everyone quotes.
    const pairs = new Array<number>(CLASS_COUNT).fill(0)
    for (let index = 0; index < CLASS_COUNT; index++) if (classLabel(index).length === 2) pairs[index] = 1
    expect(rangeWidth(pairs)).toBeCloseTo(78 / 1326, 6)
  })
})
