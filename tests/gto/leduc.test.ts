import { describe, expect, it } from 'vitest'
import { JACK, KING, QUEEN, leduc, type LeducState } from '../../src/gto/leduc'
import { train } from '../../src/gto/cfr'
import { exploitability, strategyValue } from '../../src/gto/exploitability'
import { CHANCE, uniformStrategy } from '../../src/gto/game'

/** Deal the given cards, then play the given betting. */
const play = (cards: number[], betting = ''): LeducState => {
  let state = leduc.root()
  let dealt = 0
  for (const action of betting) {
    while (leduc.actor(state) === CHANCE) state = leduc.apply(state, String(cards[dealt++]))
    state = leduc.apply(state, action)
  }
  while (dealt < cards.length && leduc.actor(state) === CHANCE) state = leduc.apply(state, String(cards[dealt++]))
  return state
}

describe('the rules', () => {
  it('deals the board in the middle of the tree, not at the root', () => {
    // The whole reason Leduc is here. A solver that folds chance into a
    // constant at the root gets Kuhn right and this wrong.
    let state = play([QUEEN, JACK])
    expect(leduc.actor(state)).toBe(0)
    state = leduc.apply(leduc.apply(state, 'c'), 'c')
    expect(leduc.actor(state)).toBe(CHANCE)
    expect(leduc.chanceOutcomes(state).reduce((sum, o) => sum + o.probability, 0)).toBeCloseTo(1, 12)
  })

  it('weighs a rank by how many of it are left rather than branching per suit', () => {
    // Suits never matter in Leduc, so two copies of a rank are one branch
    // with twice the weight. With both queens dealt out, the four cards left
    // are two jacks and two kings — two outcomes, evenly split, not four.
    const outcomes = leduc.chanceOutcomes(play([QUEEN, QUEEN], 'cc'))
    expect(outcomes).toHaveLength(2)
    expect(outcomes.find((o) => o.action === String(JACK))!.probability).toBeCloseTo(0.5, 12)
    expect(outcomes.find((o) => o.action === String(KING))!.probability).toBeCloseTo(0.5, 12)
  })

  it('offers a fold only when there is a bet to fold to', () => {
    expect(leduc.legalActions(play([QUEEN, JACK]))).toEqual(['c', 'r'])
    expect(leduc.legalActions(play([QUEEN, JACK], 'r'))).toEqual(['f', 'c', 'r'])
  })

  it('allows a bet and one raise, and then only fold or call', () => {
    expect(leduc.legalActions(play([QUEEN, JACK], 'rr'))).toEqual(['f', 'c'])
  })

  it('charges two chips before the board and four after', () => {
    // Bet and call in the first round: two each on top of the ante.
    const first = play([QUEEN, JACK], 'rc')
    expect(first.contributions).toEqual([3, 3])
    // Then the same in the second round, at the bigger size.
    const second = play([QUEEN, JACK, KING], 'rcrc')
    expect(second.contributions).toEqual([7, 7])
  })

  it('leaves the antes alone when both players check', () => {
    expect(play([QUEEN, JACK], 'cc').contributions).toEqual([1, 1])
  })
})

describe('showdowns', () => {
  it('has a pair with the board beat any unpaired hand', () => {
    // The jack pairs the board and beats a king.
    expect(leduc.utility(play([JACK, KING, JACK], 'cccc'))).toBeGreaterThan(0)
    expect(leduc.utility(play([KING, JACK, JACK], 'cccc'))).toBeLessThan(0)
  })

  it('gives the higher card the pot when neither pairs', () => {
    expect(leduc.utility(play([KING, QUEEN, JACK], 'cccc'))).toBeGreaterThan(0)
    expect(leduc.utility(play([QUEEN, KING, JACK], 'cccc'))).toBeLessThan(0)
  })

  it('splits when both players hold the same rank', () => {
    expect(leduc.utility(play([QUEEN, QUEEN, KING], 'cccc'))).toBe(0)
  })

  it('pays a fold exactly what the folder had already put in', () => {
    // Player 1 bets, player 0 folds after the antes: player 0 loses one.
    expect(leduc.utility(play([JACK, KING], 'crf'))).toBe(-1)
    // Player 1 folds to a bet: they lose their ante only.
    expect(leduc.utility(play([KING, JACK], 'rf'))).toBe(1)
  })
})

describe('solving it', () => {
  const solved = train(leduc, 3_000, { plus: true })

  it('has the 288 information sets Leduc is known to have', () => {
    // An independent check that this is the standard game and not a variant
    // of my own: the number is published, and nothing in the implementation
    // aims at it.
    expect(solved.nodeCount).toBe(288)
    expect(uniformStrategy(leduc).size).toBe(288)
  })

  it('is worth about -0.085 chips a hand to the player who acts first', () => {
    // The published value for Leduc, reproduced by a solver that has never
    // been told it.
    expect(strategyValue(leduc, solved.strategy)).toBeCloseTo(-0.0856, 2)
  })

  it('leaves a coin-flipping strategy giving up more than two chips a hand', () => {
    expect(exploitability(leduc, uniformStrategy(leduc))).toBeGreaterThan(2)
  })

  it('gets closer to unexploitable the longer it runs', { timeout: 60_000 }, () => {
    const runs = [200, 1_000, 5_000].map((n) => exploitability(leduc, train(leduc, n).strategy))
    expect(runs[1]).toBeLessThan(runs[0])
    expect(runs[2]).toBeLessThan(runs[1])
    expect(runs[2]).toBeLessThan(0.03)
  })

  it('shows CFR+ pulling ahead now that the tree is bigger than twelve nodes', { timeout: 60_000 }, () => {
    // On Kuhn regret matching+ was worth about a factor of two. On a game
    // with 288 information sets it is worth three to five, which is the
    // pattern the literature reports: the advantage grows with the tree.
    for (const n of [500, 2_000]) {
      const vanilla = exploitability(leduc, train(leduc, n).strategy)
      const plus = exploitability(leduc, train(leduc, n, { plus: true }).strategy)
      expect(vanilla / plus).toBeGreaterThan(2.5)
    }
  })
})
