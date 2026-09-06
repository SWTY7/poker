import { describe, expect, it } from 'vitest'
import { estimateHandOdds } from '../../src/poker/equity'
import type { Card } from '../../src/poker/card'

function sumProbabilities(odds: ReturnType<typeof estimateHandOdds>): number {
  return Object.values(odds!.byCategory).reduce((sum, p) => sum + (p ?? 0), 0)
}

describe('estimateHandOdds', () => {
  it('returns null preflop — exhaustive enumeration there is too expensive for the UI thread', () => {
    const holeCards: Card[] = [
      { rank: 'A', suit: 'spades' },
      { rank: 'K', suit: 'spades' },
    ]
    expect(estimateHandOdds(holeCards, [])).toBeNull()
  })

  it('at the river, the hand is already decided: one category at probability 1', () => {
    const holeCards: Card[] = [
      { rank: 'A', suit: 'spades' },
      { rank: 'A', suit: 'hearts' },
    ]
    const communityCards: Card[] = [
      { rank: 'A', suit: 'clubs' },
      { rank: '2', suit: 'diamonds' },
      { rank: '7', suit: 'hearts' },
      { rank: '9', suit: 'spades' },
      { rank: 'K', suit: 'clubs' },
    ]
    const odds = estimateHandOdds(holeCards, communityCards)
    expect(odds).toEqual({ byCategory: { trips: 1 }, sampleSize: 1 })
  })

  it('on the turn, enumerates exactly the 46 unseen cards and sums to 1', () => {
    const holeCards: Card[] = [
      { rank: 'A', suit: 'spades' },
      { rank: 'K', suit: 'spades' },
    ]
    const communityCards: Card[] = [
      { rank: 'Q', suit: 'spades' },
      { rank: '2', suit: 'diamonds' },
      { rank: '7', suit: 'hearts' },
      { rank: '9', suit: 'spades' },
    ]
    const odds = estimateHandOdds(holeCards, communityCards)
    expect(odds!.sampleSize).toBe(46)
    expect(sumProbabilities(odds)).toBeCloseTo(1)
    // Four spades on board plus two in hand — any spade completes the flush.
    expect(odds!.byCategory.flush).toBeGreaterThan(0)
  })

  it('on the flop, enumerates all 47 choose 2 = 1081 completions and sums to 1', () => {
    const holeCards: Card[] = [
      { rank: '7', suit: 'clubs' },
      { rank: '7', suit: 'diamonds' },
    ]
    const communityCards: Card[] = [
      { rank: '2', suit: 'hearts' },
      { rank: '9', suit: 'spades' },
      { rank: 'K', suit: 'clubs' },
    ]
    const odds = estimateHandOdds(holeCards, communityCards)
    expect(odds!.sampleSize).toBe(1081)
    expect(sumProbabilities(odds)).toBeCloseTo(1)
    // A pocket pair with two unpaired overcards on board can still reach
    // trips, a full house, or even quads by the river.
    expect(odds!.byCategory.trips).toBeGreaterThan(0)
    expect(odds!.byCategory['full-house']).toBeGreaterThan(0)
    expect(odds!.byCategory.quads).toBeGreaterThan(0)
  })
})
