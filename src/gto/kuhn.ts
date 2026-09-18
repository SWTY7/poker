import { CHANCE, type Action, type Actor, type ChanceOutcome, type Game } from './game'

/**
 * Kuhn poker (Kuhn, 1950): the smallest poker worth the name, and the only
 * one whose equilibrium can be written down on a napkin.
 *
 * Three cards — jack, queen, king. Both players ante one chip and get one
 * card each. Player 0 checks or bets one; facing a bet, the other folds or
 * calls; if player 0 checks and player 1 bets, player 0 gets one more choice.
 * Higher card wins at showdown.
 *
 * It exists here for one reason: the answer is known in closed form, so a
 * solver pointed at it can be proved right or wrong rather than admired.
 *
 *   The game is worth -1/18 to player 0 — the first player is at a
 *   structural disadvantage, and the exact size of it is the first thing to
 *   check.
 *
 *   Player 0 bets the jack with some frequency alpha between 0 and 1/3, bets
 *   the king exactly three times as often, and never bets the queen. The
 *   three-to-one ratio is forced: bluff any more often and the king's value
 *   bets stop getting paid.
 *
 *   Player 1 calls the queen one time in three, and bluffs the jack one time
 *   in three, whatever player 0 does. Those are the indifference
 *   frequencies from Layer 1, appearing in a solved game rather than being
 *   asserted about an unsolved one.
 *
 * That the equilibrium is a *family* — one free parameter, alpha — is worth
 * noticing too. A solver will land on one member of it, so a test that
 * demands a specific alpha is testing the seed rather than the solver.
 */

export interface KuhnState {
  /** Cards dealt so far: index 0 to player 0, index 1 to player 1. */
  cards: number[]
  /** Betting so far as a string of 'p' (pass) and 'b' (bet). */
  history: string
}

export const JACK = 0
export const QUEEN = 1
export const KING = 2
export const CARD_NAMES = ['J', 'Q', 'K']

const PASS: Action = 'p'
const BET: Action = 'b'

export const kuhn: Game<KuhnState> = {
  name: 'Kuhn poker',
  // Both players ante one chip, so one chip is the natural unit and results
  // are comparable with any other game measured in big blinds.
  bigBlind: 1,

  root(): KuhnState {
    return { cards: [], history: '' }
  },

  actor(state: KuhnState): Actor {
    if (state.cards.length < 2) return CHANCE
    return (state.history.length % 2) as 0 | 1
  },

  chanceOutcomes(state: KuhnState): ChanceOutcome[] {
    const remaining = [JACK, QUEEN, KING].filter((card) => !state.cards.includes(card))
    return remaining.map((card) => ({ action: String(card), probability: 1 / remaining.length }))
  },

  legalActions(): Action[] {
    return [PASS, BET]
  },

  apply(state: KuhnState, action: Action): KuhnState {
    if (state.cards.length < 2) return { cards: [...state.cards, Number(action)], history: state.history }
    return { cards: state.cards, history: state.history + action }
  },

  isTerminal(state: KuhnState): boolean {
    if (state.cards.length < 2) return false
    const h = state.history
    return h === 'pp' || h === 'bp' || h === 'bb' || h === 'pbp' || h === 'pbb'
  },

  utility(state: KuhnState): number {
    const h = state.history
    const showdownWinner = state.cards[0] > state.cards[1] ? 1 : -1
    switch (h) {
      // Checked down: one chip each in the middle, the better card takes it.
      case 'pp':
        return showdownWinner
      // Someone folded to a bet; the bettor wins the antes and nothing more.
      case 'bp':
        return 1
      case 'pbp':
        return -1
      // Called: two chips each.
      case 'bb':
      case 'pbb':
        return 2 * showdownWinner
      default:
        throw new Error(`Not a terminal history: "${h}"`)
    }
  },

  /**
   * The acting player's own card plus the public betting. Their opponent's
   * card is exactly what they cannot see, and leaving it out is the whole
   * content of the information set.
   */
  infoSet(state: KuhnState): string {
    const player = state.history.length % 2
    return `${CARD_NAMES[state.cards[player]]}:${state.history || '-'}`
  },
}

/** The game value to player 0 at equilibrium, which every solver run has to reproduce. */
export const KUHN_VALUE = -1 / 18
