import { describe, expect, it } from 'vitest'
import type { Card } from '../../src/poker/card'
import { toCardInt } from '../../src/poker/fast/cards'
import { evaluateHand } from '../../src/poker/fast/eval7'
import { COMBO_A, COMBO_B, COMBO_COUNT } from '../../src/math/combos'
import { canonicalBoardKey, canonicalBoards, canonicalSuitMap, relabel } from '../../src/gto/holdem/isomorphism'
import { DEFAULT_BUCKETS, NO_BUCKET, bucketOf, clearBucketCache, strengthOf } from '../../src/gto/holdem/buckets'

const card = (spec: string): number =>
  toCardInt({
    rank: spec.slice(0, -1) as Card['rank'],
    suit: { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }[spec.slice(-1)] as Card['suit'],
  })
const board = (spec: string): number[] => spec.split(' ').map(card)
const hand = (a: string, b: string): [number, number] => [card(a), card(b)]

describe('suits only matter in relation to each other', () => {
  it('leaves 1755 flops out of 22100', () => {
    // The published count of strategically distinct flops, and an independent
    // check that the canonicalisation is neither too coarse nor too fine.
    expect(canonicalBoards(3)).toHaveLength(1755)
  })

  it('leaves 16432 turns', () => {
    expect(canonicalBoards(4)).toHaveLength(16432)
  })

  it('gives the same name to boards that are the same hand of poker', () => {
    // Two hearts and a spade is two clubs and a diamond.
    expect(canonicalBoardKey(board('Kh 8h 3s'))).toBe(canonicalBoardKey(board('Kc 8c 3d')))
    // And the rainbow version is a different board.
    expect(canonicalBoardKey(board('Kh 8h 3s'))).not.toBe(canonicalBoardKey(board('Kh 8c 3s')))
  })

  it('distinguishes which cards share a suit, not which suit they share', () => {
    // King and eight suited together is not the same flop as king and three.
    expect(canonicalBoardKey(board('Kh 8h 3s'))).not.toBe(canonicalBoardKey(board('Kh 8s 3h')))
  })

  it('relabels a hand into the board’s frame consistently', () => {
    const map = canonicalSuitMap(board('Kh 8h 3s'))
    const other = canonicalSuitMap(board('Kc 8c 3d'))
    // The ace of the board's main suit is the same card in both frames.
    expect(relabel(card('Ah'), map)).toBe(relabel(card('Ac'), other))
  })
})

describe('strength buckets', () => {
  const flop = board('Kh 8d 3c')

  it('orders a dry board the way anyone would', () => {
    const order: [string, string][] = [
      ['Ks', 'Kd'], // a set of kings
      ['Ah', 'Kc'], // top pair, best kicker
      ['9h', '9s'], // an underpair
      ['Ah', 'Qh'], // two overcards and a backdoor flush draw
      ['7c', '2d'], // nothing, and no way to get there
    ]
    const scored = order.map(([a, b]) => ({
      strength: strengthOf(hand(a, b), flop).potential,
      bucket: bucketOf(hand(a, b), flop),
    }))
    for (let i = 1; i < scored.length; i++) {
      expect(scored[i].strength).toBeLessThan(scored[i - 1].strength)
      // Buckets can tie where strengths do not: eight of them means the top
      // one holds the top eighth of the board, and a set and top pair are
      // both comfortably inside it.
      expect(scored[i].bucket).toBeLessThanOrEqual(scored[i - 1].bucket)
    }
    expect(scored[0].bucket).toBe(DEFAULT_BUCKETS - 1)
    expect(scored[scored.length - 1].bucket).toBe(0)
  })

  it('sees a draw, which is the whole reason for the square', () => {
    // Ace-king with the nut flush draw against ace-king without it, on the
    // same board. Their *average* final strength is nearly identical — which
    // is exactly why textbook E[HS] cannot tell them apart and a solver built
    // on it never semi-bluffs. Squaring the percentile separates them by a
    // quarter, because one of them is sometimes the nuts.
    const wet = board('9h 8h 2c')
    const drawing = strengthOf(hand('Ah', 'Kh'), wet)
    const dry = strengthOf(hand('Ac', 'Kd'), wet)
    expect(Math.abs(drawing.mean - dry.mean)).toBeLessThan(0.05)
    expect(drawing.potential).toBeGreaterThan(dry.potential * 1.15)
    expect(bucketOf(hand('Ah', 'Kh'), wet)).toBeGreaterThan(bucketOf(hand('Ac', 'Kd'), wet))
  })

  it('puts a monster draw above a made second pair', () => {
    // Jack-ten of hearts on nine-eight of hearts: a flush draw and an
    // open-ender, still nothing at all right now.
    const wet = board('9h 8h 2c')
    expect(bucketOf(hand('Jh', 'Th'), wet)).toBeGreaterThan(bucketOf(hand('8s', '7c'), wet))
  })

  it('fills every bucket about equally, which is what equal-frequency means', () => {
    const counts = new Array<number>(DEFAULT_BUCKETS).fill(0)
    let live = 0
    for (let id = 0; id < COMBO_COUNT; id++) {
      const bucket = bucketOf([COMBO_A[id], COMBO_B[id]], flop)
      if (bucket === NO_BUCKET) continue
      counts[bucket]++
      live++
    }
    // 49 unseen cards choose 2.
    expect(live).toBe((49 * 48) / 2)
    for (const count of counts) {
      expect(count).toBeGreaterThan((live / DEFAULT_BUCKETS) * 0.9)
      expect(count).toBeLessThan((live / DEFAULT_BUCKETS) * 1.1)
    }
  })

  it('has no bucket for a hand the board is holding', () => {
    expect(bucketOf(hand('Kh', 'Ah'), flop)).toBe(NO_BUCKET)
  })

  it('answers the same twice, with or without a warm cache', () => {
    // An abstraction that moved between visits would not be one: the solver
    // stores regrets against a bucket and has to find the same bucket again.
    const first = bucketOf(hand('Ah', 'Qh'), flop)
    clearBucketCache()
    expect(bucketOf(hand('Ah', 'Qh'), flop)).toBe(first)
  })

  it('answers the same on a board that is the same board in different suits', () => {
    const hearts = bucketOf(hand('Ah', 'Qs'), board('Kh 8h 3s'))
    const clubs = bucketOf(hand('Ac', 'Qd'), board('Kc 8c 3d'))
    expect(clubs).toBe(hearts)
  })

  it('is exact on the river, where there is nothing left to come', () => {
    // No run-outs to average, so the ordering has to agree with the evaluator
    // hand for hand.
    const river = board('Kh 8d 3c 5s 9h')
    const pairs: [string, string][] = [
      ['Ks', 'Kd'], // trip kings
      ['9c', '9s'], // trip nines — the nine on the river outranks top pair
      ['Ah', 'Kc'], // top pair
      ['7c', '2d'], // nothing
    ]
    const scored = pairs.map((hole) => ({
      bucket: bucketOf(hand(hole[0], hole[1]), river),
      score: evaluateHand([...hand(hole[0], hole[1]), ...river]),
    }))
    for (let i = 1; i < scored.length; i++) {
      expect(scored[i].score).toBeLessThan(scored[i - 1].score)
      expect(scored[i].bucket).toBeLessThanOrEqual(scored[i - 1].bucket)
    }
  })
})
