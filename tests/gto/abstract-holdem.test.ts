import { describe, expect, it } from 'vitest'
import { CHANCE } from '../../src/gto/game'
import { abstractHoldem, DEFAULT_HOLDEM, type HoldemState } from '../../src/gto/holdem/abstract-holdem'
import { trainMccfr } from '../../src/gto/mccfr'
import { createRng } from '../../src/utils/random'
import { toCardInt } from '../../src/poker/fast/cards'
import type { Card } from '../../src/poker/card'

const card = (spec: string): number =>
  toCardInt({
    rank: spec.slice(0, -1) as Card['rank'],
    suit: { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }[spec.slice(-1)] as Card['suit'],
  })

const game = abstractHoldem(DEFAULT_HOLDEM)

/** Deal the given cards, then play the given betting letters. */
function play(hole: string[][], boardCards: string[], betting: string): HoldemState {
  let state = game.root()
  state = game.apply(state, hole[0].map(card).join(','))
  state = game.apply(state, hole[1].map(card).join(','))
  let dealt = 0
  for (const letter of betting) {
    while (game.actor(state) === CHANCE && !game.isTerminal(state)) {
      const need = state.street === 1 ? 3 : 1
      const cards = boardCards.slice(dealt, dealt + need)
      dealt += need
      state = game.apply(state, cards.map(card).join(','))
    }
    state = game.apply(state, letter)
  }
  return state
}

const HANDS = [
  ['Ah', 'Ad'],
  ['Kc', 'Ks'],
]
const BOARD = ['2c', '7d', '9s', 'Th', 'Jc']

describe('the rules it abstracts', () => {
  it('posts the blinds and gives the small blind the first word', () => {
    const start = play(HANDS, BOARD, '')
    expect(start.contributions).toEqual([0.5, 1])
    expect(game.actor(start)).toBe(0)
  })

  it('leaves the big blind their option after a call', () => {
    // The mistake that is easy to make and invisible once made: the money is
    // matched, so it looks like the street is over, but the big blind has not
    // spoken yet.
    const limped = play(HANDS, BOARD, 'c')
    expect(limped.street).toBe(0)
    expect(game.actor(limped)).toBe(1)
    expect(game.legalActions(limped)).toContain('k')
    // Taking it closes the street, and the flop comes.
    const closed = play(HANDS, BOARD, 'ck')
    expect(closed.street).toBe(1)
    expect(game.actor(closed)).toBe(CHANCE)
  })

  it('hands the first word to the big blind after the flop', () => {
    const flop = play(HANDS, BOARD, 'ckk')
    expect(flop.street).toBe(1)
    // One check in: the small blind is now to act.
    expect(game.actor(flop)).toBe(0)
  })

  it('offers a fold only against a bet', () => {
    expect(game.legalActions(play(HANDS, BOARD, 'ck'))).not.toContain('f')
    expect(game.legalActions(play(HANDS, BOARD, 'ckp'))).toContain('f')
  })

  it('sizes the three bets off the pot', () => {
    // Checked to on the flop with two big blinds in the middle: a pot bet is
    // two more, a half-pot bet is one.
    const half = play(HANDS, BOARD, 'ckh')
    const pot = play(HANDS, BOARD, 'ckp')
    expect(half.contributions[1]).toBeCloseTo(2, 6)
    expect(pot.contributions[1]).toBeCloseTo(3, 6)
    const shove = play(HANDS, BOARD, 'cka')
    expect(shove.contributions[1]).toBe(DEFAULT_HOLDEM.stack)
  })

  it('stops raising once the street has had its fill', () => {
    const capped = play(HANDS, BOARD, 'ckhph')
    expect(game.legalActions(capped).filter((a) => a === 'h' || a === 'p' || a === 'a')).toHaveLength(0)
    expect(game.legalActions(capped)).toEqual(['f', 'c'])
  })

  it('runs the board out with no more betting once the stacks are in', () => {
    const allIn = play(HANDS, BOARD, 'ac')
    expect(allIn.contributions).toEqual([DEFAULT_HOLDEM.stack, DEFAULT_HOLDEM.stack])
    // Every street after this one is a deal, not a decision.
    let state = allIn
    let deals = 0
    while (!game.isTerminal(state)) {
      expect(game.actor(state)).toBe(CHANCE)
      const need = Math.max(0, [0, 3, 4, 5][state.street] - state.board.length)
      state = game.apply(state, BOARD.slice(state.board.length, state.board.length + need).map(card).join(','))
      if (deals++ > 12) throw new Error('never ran out')
    }
    expect(state.board).toHaveLength(5)
  })
})

describe('what a hand is worth', () => {
  it('charges a folder exactly what they had already put in', () => {
    // The small blind folds before the flop: half a blind.
    expect(game.utility(play(HANDS, BOARD, 'f'))).toBe(-0.5)
    // The big blind folds to a pot-sized raise, having posted one blind.
    expect(game.utility(play(HANDS, BOARD, 'pf'))).toBe(1)
  })

  it('pays a showdown the loser’s contribution, and a chop nothing', () => {
    const won = play(HANDS, BOARD, 'ckkkkkkk')
    expect(game.isTerminal(won)).toBe(true)
    // Aces against kings on a board neither player used: aces take the blind.
    expect(game.utility(won)).toBeGreaterThan(0)
    const chopped = play([['Ah', 'Ad'], ['Ac', 'As']], BOARD, 'ckkkkkkk')
    expect(game.utility(chopped)).toBe(0)
  })
})

describe('as a game a solver can hold', () => {
  it('refuses to list what the deck might do, and says why', () => {
    expect(() => game.chanceOutcomes(game.root())).toThrow(/sampled, not enumerated/)
  })

  it('trains without tripping the abstraction check, and is the right size', { timeout: 120_000 }, () => {
    // Two things at once, because a training run is the expensive part.
    //
    // First: the solver stores one regret per action per information set, so
    // two states sharing a key have to share a choice. An abstraction that
    // collapses them too far breaks this silently, CFR throws when it
    // notices, and this is the test that the abstraction does not trip it.
    let result: ReturnType<typeof trainMccfr> | null = null
    expect(() => {
      result = trainMccfr(game, 400, { rng: createRng(3), plus: true })
    }).not.toThrow()

    // Second: tens of thousands of information sets, not billions. Small
    // enough that a few hundred thousand iterations put real weight behind
    // each entry, which is the only reason the blueprint is worth anything.
    expect(result!.nodeCount).toBeGreaterThan(5_000)
    expect(result!.nodeCount).toBeLessThan(60_000)
  })
})
