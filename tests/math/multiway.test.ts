import { describe, expect, it } from 'vitest'
import type { Card } from '../../src/poker/card'
import { toCardInt } from '../../src/poker/fast/cards'
import { handVsRange, multiwayEquity, quickEquity } from '../../src/math/equity'
import { fullRange, parseRange } from '../../src/math/range'
import { createRng } from '../../src/utils/random'

const card = (spec: string): number =>
  toCardInt({
    rank: spec.slice(0, -1) as Card['rank'],
    suit: { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }[spec.slice(-1)] as Card['suit'],
  })
const hand = (a: string, b: string): [number, number] => [card(a), card(b)]
const board = (spec: string): number[] => spec.split(' ').map(card)
const random = (n: number) => Array.from({ length: n }, () => fullRange())

describe('equity against several opponents at once', () => {
  it('gives the average hand its fair share of a six-way pot', () => {
    // Six players, one pot: averaged over which hand the hero happens to
    // hold, they win a sixth of it. Anything that cannot reproduce this
    // number is not measuring multiway equity. It has to be averaged over
    // hands rather than read off one — 94o is not an average hand, and comes
    // out at about 11%.
    const rng = createRng(1)
    const deck = Array.from({ length: 52 }, (_, i) => i)
    let total = 0
    const trials = 40
    for (let t = 0; t < trials; t++) {
      const a = deck[Math.floor(rng() * 52)]
      let b = a
      while (b === a) b = deck[Math.floor(rng() * 52)]
      total += multiwayEquity([a, b], random(5), [], { samples: 3000, rng })
    }
    expect(total / trials).toBeGreaterThan(0.14)
    expect(total / trials).toBeLessThan(0.19)
  })

  it('has a bad hand come in under its fair share, which is what makes it bad', () => {
    const equity = multiwayEquity(hand('9h', '4c'), random(5), [], { samples: 20000, rng: createRng(1) })
    expect(equity).toBeLessThan(1 / 6)
    expect(equity).toBeGreaterThan(0.08)
  })

  it('is not the product of the pairwise equities, and the gap is enormous', () => {
    // The tempting shortcut is to measure the hand against one opponent and
    // raise it to the fifth power. It is wrong by a factor of five, because
    // the board that beats one opponent is usually the same board that beats
    // the rest — the pairwise results are strongly correlated, not
    // independent. A bot built on the shortcut folds everything.
    const hero = hand('9h', '4c')
    const headsUp = quickEquity(hero, fullRange(), [], { samples: 20000, rng: createRng(2) })
    const naive = Math.pow(headsUp, 5)
    const truth = multiwayEquity(hero, random(5), [], { samples: 20000, rng: createRng(3) })
    expect(naive).toBeLessThan(0.06)
    expect(truth).toBeGreaterThan(naive * 3)
  })

  it('puts aces at about half a six-way pot', () => {
    // The memorable figure: the best hand preflop is still a coinflip once
    // five people are drawing at it.
    const equity = multiwayEquity(hand('Ah', 'As'), random(5), [], { samples: 20000, rng: createRng(4) })
    expect(equity).toBeGreaterThan(0.44)
    expect(equity).toBeLessThan(0.56)
  })

  it('splits a pot every way it can be split', () => {
    // A board that plays: four players, nobody's cards matter, everyone gets
    // a quarter.
    const equity = multiwayEquity(hand('2c', '3d'), random(3), board('Ah Kh Qh Jh Th'), {
      samples: 2000,
      rng: createRng(5),
    })
    expect(equity).toBeCloseTo(0.25, 2)
  })

  it('agrees with the exact answer heads-up', () => {
    const exact = handVsRange(hand('Ah', 'Kh'), parseRange('QQ'), board('Qh 7h 2c'))
    const sampled = quickEquity(hand('Ah', 'Kh'), parseRange('QQ'), board('Qh 7h 2c'), {
      samples: 20000,
      rng: createRng(6),
    })
    expect(sampled).toBeCloseTo(exact.equity, 2)
  })
})

describe('opponents who are not actually in the hand', () => {
  it('hands the pot over when nobody comes along', () => {
    expect(multiwayEquity(hand('7c', '2d'), random(5), [], { samples: 500, participation: [0, 0, 0, 0, 0] })).toBe(1)
  })

  it('is the same as playing one opponent when only one of them ever plays', () => {
    const hero = hand('Ts', 'Ts')
    const alone = multiwayEquity(hero, random(1), [], { samples: 20000, rng: createRng(7) })
    const crowded = multiwayEquity(hero, random(5), [], {
      samples: 20000,
      rng: createRng(8),
      participation: [1, 0, 0, 0, 0],
    })
    expect(Math.abs(crowded - alone)).toBeLessThan(0.02)
  })

  it('falls as more of the table turns out to be real', () => {
    const hero = hand('Ah', 'Qd')
    const chances = [0, 0.25, 0.5, 1]
    const equities = chances.map((chance) =>
      multiwayEquity(hero, random(5), [], {
        samples: 8000,
        rng: createRng(9),
        participation: new Array(5).fill(chance),
      }),
    )
    for (let i = 1; i < equities.length; i++) {
      expect(equities[i]).toBeLessThan(equities[i - 1])
    }
    expect(equities[0]).toBe(1)
  })
})
