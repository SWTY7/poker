import { describe, expect, it } from 'vitest'
import { RANKS, SUITS, type Card } from '../../src/poker/card'
import { compareHandValues, evaluateBestHand, evaluateFiveCardHand } from '../../src/poker/hand-evaluator'
import { evaluateHand, categoryOfScore, categoryRankOfScore } from '../../src/poker/fast/eval7'
import { fromCardInt, toCardInt, toCardInts, fullDeckInts } from '../../src/poker/fast/cards'

const DECK: Card[] = []
for (const suit of SUITS) for (const rank of RANKS) DECK.push({ rank, suit })

describe('integer card encoding', () => {
  it('round-trips every card in the deck', () => {
    for (const card of DECK) {
      expect(fromCardInt(toCardInt(card))).toEqual(card)
    }
  })

  it('maps the deck onto exactly 0..51 with no collisions', () => {
    const seen = new Set(DECK.map(toCardInt))
    expect(seen.size).toBe(52)
    expect(Math.min(...seen)).toBe(0)
    expect(Math.max(...seen)).toBe(51)
    expect(fullDeckInts()).toHaveLength(52)
  })
})

/**
 * The fast evaluator is only useful if it agrees with the readable one, so
 * this checks the thing that actually matters: not that the scores look alike,
 * but that they *order* hands identically. Two hands that tie under
 * compareHandValues must score equal, and one that beats another must score
 * higher.
 */
describe('fast evaluator agrees with the reference evaluator', () => {
  it('reports the same category for all 2,598,960 five-card hands', { timeout: 60_000 }, () => {
    let checked = 0
    for (let a = 0; a < 48; a++)
      for (let b = a + 1; b < 49; b++)
        for (let c = b + 1; c < 50; c++)
          for (let d = c + 1; d < 51; d++)
            for (let e = d + 1; e < 52; e++) {
              const cards = [DECK[a], DECK[b], DECK[c], DECK[d], DECK[e]]
              const reference = evaluateFiveCardHand(cards)
              const score = evaluateHand(toCardInts(cards))
              if (categoryRankOfScore(score) !== reference.categoryRank) {
                throw new Error(
                  `${cards.map((x) => x.rank + x.suit[0]).join(' ')}: ` +
                    `fast says ${categoryOfScore(score)}, reference says ${reference.category}`,
                )
              }
              checked++
            }
    expect(checked).toBe(2598960)
  })

  it('orders 20,000 random seven-card pairs the same way', { timeout: 60_000 }, () => {
    // A small deterministic generator, so a failure can be re-run.
    let seed = 12345
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const deal = () => {
      const d = DECK.slice()
      for (let i = d.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        ;[d[i], d[j]] = [d[j], d[i]]
      }
      return d.slice(0, 7)
    }

    for (let i = 0; i < 20000; i++) {
      const x = deal()
      const y = deal()
      const refOrder = Math.sign(compareHandValues(evaluateBestHand(x), evaluateBestHand(y)))
      const fastOrder = Math.sign(evaluateHand(toCardInts(x)) - evaluateHand(toCardInts(y)))
      if (refOrder !== fastOrder) {
        throw new Error(
          `disagreement at i=${i}\n` +
            `  x = ${x.map((c) => c.rank + c.suit[0]).join(' ')} -> ${evaluateBestHand(x).category}\n` +
            `  y = ${y.map((c) => c.rank + c.suit[0]).join(' ')} -> ${evaluateBestHand(y).category}\n` +
            `  reference ${refOrder}, fast ${fastOrder}`,
        )
      }
    }
  })
})

describe('specific hands the packing could get wrong', () => {
  function score(spec: string): number {
    const cards = spec.split(' ').map((token) => {
      const rank = token.slice(0, -1) as Card['rank']
      const suit = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }[token.slice(-1)] as Card['suit']
      return toCardInt({ rank, suit })
    })
    return evaluateHand(cards)
  }

  it('plays the ace low in a wheel, and below a six-high straight', () => {
    const wheel = score('Ac 2d 3h 4s 5c')
    const sixHigh = score('2c 3d 4h 5s 6c')
    expect(categoryOfScore(wheel)).toBe('straight')
    expect(categoryOfScore(sixHigh)).toBe('straight')
    expect(wheel).toBeLessThan(sixHigh)
  })

  it('finds a wheel straight flush and ranks it under a six-high straight flush', () => {
    const steelWheel = score('Ac 2c 3c 4c 5c')
    const sixHigh = score('2c 3c 4c 5c 6c')
    expect(categoryOfScore(steelWheel)).toBe('straight-flush')
    expect(steelWheel).toBeLessThan(sixHigh)
  })

  it('prefers a flush over a straight when seven cards contain both', () => {
    const s = score('2h 3h 4h 5h 9h 6c 7d')
    expect(categoryOfScore(s)).toBe('flush')
  })

  it('finds the straight flush when the same seven cards also make a plain flush', () => {
    const s = score('2h 3h 4h 5h 9h 6h 7d')
    expect(categoryOfScore(s)).toBe('straight-flush')
  })

  it('plays two trips as a full house, using the higher as the trips', () => {
    const s = score('9c 9d 9h 4c 4d 4h Kc')
    expect(categoryOfScore(s)).toBe('full-house')
    // Nines full of fours must beat fours full of nines.
    expect(s).toBeGreaterThan(score('4c 4d 4h 9c 9d 2h 3c'))
  })

  it('picks the best two of three pairs and the right kicker', () => {
    const s = score('Ac Ad 9c 9d 4c 4d Kh')
    expect(categoryOfScore(s)).toBe('two-pair')
    // Aces and nines with a king, not aces and fours, and not a four kicker.
    expect(s).toBe(score('Ac Ad 9c 9d Kh 2s 3s'))
  })

  it('ignores the sixth and seventh cards once five are settled', () => {
    expect(score('Ac Ad Ah As Kc 2d 3h')).toBe(score('Ac Ad Ah As Kc 7d 8h'))
  })
})

describe('throughput', () => {
  it('evaluates seven-card hands at least 50x faster than the reference', { timeout: 30_000 }, () => {
    const deck = fullDeckInts()
    const hands: number[][] = []
    const objHands: Card[][] = []
    let seed = 99
    const next = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff)
    for (let i = 0; i < 2000; i++) {
      const d = deck.slice()
      for (let j = d.length - 1; j > 0; j--) {
        const k = Math.floor(next() * (j + 1))
        ;[d[j], d[k]] = [d[k], d[j]]
      }
      const seven = d.slice(0, 7)
      hands.push(seven)
      objHands.push(seven.map(fromCardInt))
    }

    // Warm up, so this measures steady-state rather than the optimiser.
    for (const h of hands) evaluateHand(h)

    const fastStart = performance.now()
    let sink = 0
    for (let rep = 0; rep < 25; rep++) for (const h of hands) sink += evaluateHand(h)
    const fastMs = performance.now() - fastStart

    const refStart = performance.now()
    for (const h of objHands) sink += evaluateBestHand(h).categoryRank
    const refMs = performance.now() - refStart

    const fastNs = (fastMs * 1e6) / (25 * hands.length)
    const refNs = (refMs * 1e6) / objHands.length
    // eslint-disable-next-line no-console
    console.log(
      `      fast ${fastNs.toFixed(0)} ns/hand (${(1000 / fastNs).toFixed(1)}M/s), ` +
        `reference ${refNs.toFixed(0)} ns/hand — ${(refNs / fastNs).toFixed(0)}x`,
    )

    expect(sink).toBeGreaterThan(0)
    expect(refNs / fastNs).toBeGreaterThan(50)
  })
})
