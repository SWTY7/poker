import { describe, expect, it } from 'vitest'
import type { Card, Rank, Suit } from '../../src/poker/card'
import { compareHandValues, evaluateBestHand, evaluateFiveCardHand } from '../../src/poker/hand-evaluator'

const SUIT_LETTER: Record<string, Suit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }

/** Parses "As Kd 9h 2c Tc" style shorthand into Card[]. */
function hand(spec: string): Card[] {
  return spec.split(' ').map((token) => {
    const rank = token.slice(0, -1) as Rank
    const suit = SUIT_LETTER[token.slice(-1)]
    return { rank, suit }
  })
}

describe('evaluateFiveCardHand', () => {
  it('recognizes a royal flush', () => {
    expect(evaluateFiveCardHand(hand('As Ks Qs Js Ts')).category).toBe('straight-flush')
  })

  it('recognizes a straight flush and ranks it by its high card', () => {
    const low = evaluateFiveCardHand(hand('6h 5h 4h 3h 2h'))
    const high = evaluateFiveCardHand(hand('9h 8h 7h 6h 5h'))
    expect(low.category).toBe('straight-flush')
    expect(compareHandValues(high, low)).toBeGreaterThan(0)
  })

  it('recognizes the wheel straight (A-2-3-4-5) with the ace playing low', () => {
    const wheel = evaluateFiveCardHand(hand('As 2d 3c 4h 5s'))
    expect(wheel.category).toBe('straight')
    expect(wheel.tiebreakers[0]).toBe(5)
  })

  it('ranks a broadway straight above the wheel', () => {
    const wheel = evaluateFiveCardHand(hand('As 2d 3c 4h 5s'))
    const broadway = evaluateFiveCardHand(hand('Ts Jd Qc Kh As'))
    expect(compareHandValues(broadway, wheel)).toBeGreaterThan(0)
  })

  it('recognizes four of a kind and breaks ties on kicker', () => {
    const a = evaluateFiveCardHand(hand('9s 9d 9h 9c 2s'))
    const b = evaluateFiveCardHand(hand('9s 9d 9h 9c 3s'))
    expect(a.category).toBe('quads')
    expect(compareHandValues(b, a)).toBeGreaterThan(0)
  })

  it('recognizes a full house and breaks ties on the trip rank first', () => {
    const a = evaluateFiveCardHand(hand('9s 9d 9h 2c 2s'))
    const b = evaluateFiveCardHand(hand('8s 8d 8h Ac As'))
    expect(a.category).toBe('full-house')
    expect(compareHandValues(a, b)).toBeGreaterThan(0)
  })

  it('ranks flush above straight', () => {
    const flush = evaluateFiveCardHand(hand('2h 5h 8h Jh Kh'))
    const straight = evaluateFiveCardHand(hand('Ts Jd Qc Kh As'))
    expect(compareHandValues(flush, straight)).toBeGreaterThan(0)
  })

  it('breaks flush ties by highest card down to lowest', () => {
    const a = evaluateFiveCardHand(hand('2h 5h 8h Jh Kh'))
    const b = evaluateFiveCardHand(hand('2s 5s 8s Js Ks'))
    expect(compareHandValues(a, b)).toBe(0)
    const c = evaluateFiveCardHand(hand('2h 5h 9h Jh Kh'))
    expect(compareHandValues(c, a)).toBeGreaterThan(0)
  })

  it('recognizes trips and breaks ties on kickers', () => {
    const a = evaluateFiveCardHand(hand('7s 7d 7h Ac 2s'))
    const b = evaluateFiveCardHand(hand('7s 7d 7h Kc 2s'))
    expect(a.category).toBe('trips')
    expect(compareHandValues(a, b)).toBeGreaterThan(0)
  })

  it('recognizes two pair and breaks ties correctly', () => {
    const a = evaluateFiveCardHand(hand('Ks Kd 4h 4c 2s'))
    const b = evaluateFiveCardHand(hand('Ks Kd 3h 3c As'))
    expect(a.category).toBe('two-pair')
    // higher second pair wins when top pair ties
    expect(compareHandValues(a, b)).toBeGreaterThan(0)
  })

  it('recognizes one pair and breaks ties on kickers in order', () => {
    const a = evaluateFiveCardHand(hand('5s 5d Ac Kh 2s'))
    const b = evaluateFiveCardHand(hand('5s 5d Ac Qh 3s'))
    expect(a.category).toBe('pair')
    expect(compareHandValues(a, b)).toBeGreaterThan(0)
  })

  it('recognizes high card and breaks ties down the kicker chain', () => {
    const a = evaluateFiveCardHand(hand('As Kd 9h 5c 2s'))
    const b = evaluateFiveCardHand(hand('As Kd 9h 5c 3s'))
    expect(a.category).toBe('high-card')
    expect(compareHandValues(b, a)).toBeGreaterThan(0)
  })

  it('produces an exact tie for identical hand shapes across suits', () => {
    const a = evaluateFiveCardHand(hand('Ac Kd 9h 5c 2s'))
    const b = evaluateFiveCardHand(hand('Ah Ks 9c 5d 2h'))
    expect(compareHandValues(a, b)).toBe(0)
  })
})

describe('evaluateBestHand', () => {
  it('picks the best 5 of 7 cards', () => {
    // board gives a flush; hole cards are irrelevant to the best hand
    const cards = hand('2h 5h 8h Jh Kh 3c 4d')
    const result = evaluateBestHand(cards)
    expect(result.category).toBe('flush')
  })

  it('correctly finds quads hidden among 7 cards', () => {
    const cards = hand('9s 9d 9h 9c 2s 3h 4d')
    const result = evaluateBestHand(cards)
    expect(result.category).toBe('quads')
  })

  it('prefers a straight flush over quads when both are possible', () => {
    const cards = hand('9s 9d 9h 9c Ts Js Qs Ks')
    const result = evaluateBestHand(cards)
    expect(result.category).toBe('straight-flush')
  })
})
