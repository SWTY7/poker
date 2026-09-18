import { CHANCE, type Action, type Actor, type ChanceOutcome, type Game } from './game'

/**
 * Leduc Hold'em (Southey et al., 2005): the standard rung above Kuhn, and
 * the smallest game with the two features Kuhn is missing.
 *
 * Six cards — jack, queen and king, two of each. Both players ante one and
 * get a private card. A round of betting at two chips, then one public card,
 * then a round at four. A pair with the board beats everything; otherwise the
 * higher card wins. Each round allows a bet and one raise.
 *
 * The two features:
 *
 *   A community card, dealt in the middle of the tree. Kuhn's only chance
 *   node is the deal at the root, which lets a solver get away with folding
 *   chance into a uniform constant. Here different information sets are
 *   reached with different probabilities by the deck, and a solver that does
 *   not carry chance reach down into its counterfactual weights gets Kuhn
 *   exactly right and Leduc quietly wrong. That is the check this game is
 *   here for.
 *
 *   Raising, so a strategy has to price a raise rather than just a bet, and
 *   the tree is a couple of hundred information sets rather than twelve —
 *   enough for the difference between CFR and CFR+ to actually show up.
 *
 * It is still exactly solvable, so exploitability going to zero remains a
 * real test rather than a hope.
 */

export const JACK = 0
export const QUEEN = 1
export const KING = 2
export const CARD_NAMES = ['J', 'Q', 'K']
const COPIES = 2

/** Bet size by round: two chips before the board, four after. */
const BET_SIZE = [2, 4]
/** A bet and one raise. */
const MAX_RAISES = 2

const CALL: Action = 'c'
const RAISE: Action = 'r'
const FOLD: Action = 'f'

export interface LeducState {
  /** Private cards first, then the board once it is out. */
  cards: number[]
  round: number
  /** Betting in the round in progress. */
  betting: string
  /** Completed rounds' betting, for the information set key. */
  past: string[]
  contributions: [number, number]
  folded: -1 | 0 | 1
}

/** Whether this round's betting is over, and who owes what. */
function roundClosed(betting: string): boolean {
  if (betting.includes(FOLD)) return true
  if (!betting.endsWith(CALL)) return false
  return betting === 'cc' || betting[betting.length - 2] === RAISE
}

export const leduc: Game<LeducState> = {
  name: "Leduc Hold'em",
  bigBlind: 1,

  root(): LeducState {
    return { cards: [], round: 0, betting: '', past: [], contributions: [1, 1], folded: -1 }
  },

  actor(state: LeducState): Actor {
    if (state.cards.length < 2) return CHANCE
    // Between the rounds, the deck turns the board over.
    if (state.round === 1 && state.cards.length < 3) return CHANCE
    return (state.betting.length % 2) as 0 | 1
  },

  chanceOutcomes(state: LeducState): ChanceOutcome[] {
    const remaining = [JACK, QUEEN, KING].map(
      (card) => COPIES - state.cards.filter((dealt) => dealt === card).length,
    )
    const total = remaining.reduce((a, b) => a + b, 0)
    const outcomes: ChanceOutcome[] = []
    for (let card = 0; card < remaining.length; card++) {
      // Suits never matter in Leduc, so two copies of a rank are one outcome
      // with twice the weight rather than two branches of the tree.
      if (remaining[card] > 0) outcomes.push({ action: String(card), probability: remaining[card] / total })
    }
    return outcomes
  },

  legalActions(state: LeducState): Action[] {
    const raises = state.betting.split('').filter((a) => a === RAISE).length
    const facingBet = state.betting.endsWith(RAISE)
    const actions: Action[] = []
    if (facingBet) actions.push(FOLD)
    actions.push(CALL)
    if (raises < MAX_RAISES) actions.push(RAISE)
    return actions
  },

  apply(state: LeducState, action: Action): LeducState {
    if (this.actor(state) === CHANCE) {
      return { ...state, cards: [...state.cards, Number(action)] }
    }

    const player = (state.betting.length % 2) as 0 | 1
    const other = (1 - player) as 0 | 1
    const contributions: [number, number] = [...state.contributions]

    if (action === FOLD) {
      return { ...state, betting: state.betting + action, contributions, folded: player }
    }

    const owed = contributions[other] - contributions[player]
    contributions[player] += action === RAISE ? owed + BET_SIZE[state.round] : owed

    const betting = state.betting + action
    if (!roundClosed(betting)) return { ...state, betting, contributions }
    // The round is over: keep its betting for the record and open the next.
    return { ...state, betting: '', past: [...state.past, betting], round: state.round + 1, contributions }
  },

  isTerminal(state: LeducState): boolean {
    return state.folded >= 0 || state.round > 1
  },

  utility(state: LeducState): number {
    const [a, b] = state.contributions
    if (state.folded >= 0) {
      // The folder loses what they had already put in; nobody wins more.
      return state.folded === 0 ? -a : b
    }
    const winner = showdown(state.cards)
    if (winner === 0) return 0
    // Each side risked the same amount by the time it got to a showdown.
    return winner > 0 ? b : -a
  },

  /**
   * The acting player's card, the board once it exists, and the public
   * betting. The opponent's card is precisely what is hidden.
   */
  infoSet(state: LeducState): string {
    const player = state.betting.length % 2
    const board = state.cards.length > 2 ? CARD_NAMES[state.cards[2]] : '-'
    const history = [...state.past, state.betting].join('/')
    return `${CARD_NAMES[state.cards[player]]}|${board}|${history}`
  },
}

/** 1 if player 0 wins the showdown, -1 if player 1 does, 0 for a split. */
function showdown(cards: number[]): number {
  const [first, second, board] = cards
  if (first === board && second !== board) return 1
  if (second === board && first !== board) return -1
  if (first === second) return 0
  return first > second ? 1 : -1
}
