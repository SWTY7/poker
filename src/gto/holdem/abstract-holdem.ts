import { classOf } from '../../math/combos'
import { DECK_SIZE, type CardInt } from '../../poker/fast/cards'
import { evaluateHand } from '../../poker/fast/eval7'
import type { Rng } from '../../utils/random'
import { CHANCE, type Action, type Actor, type ChanceOutcome, type Game } from '../game'
import { DEFAULT_BUCKETS, bucketOf } from './buckets'

/**
 * Heads-up no-limit Hold'em, small enough to solve.
 *
 * Real Hold'em has more decisions in it than there are seconds in the age of
 * the universe, so nobody solves it — they solve an abstraction and play the
 * strategy in the real game. Two things are collapsed:
 *
 *   Cards. Hands are grouped into buckets by strength on the current board
 *   (see buckets.ts). The solver cannot tell one hand from another inside a
 *   bucket, so it plays them identically.
 *
 *   Bet sizes. A real no-limit game allows every size; this allows half pot,
 *   pot, and all-in, with three raises to a street. Every serious solver does
 *   some version of this, because the branching factor is otherwise the whole
 *   problem.
 *
 * Heads-up rather than six-handed, and that is not laziness. CFR's guarantee
 * — that self-play converges to an equilibrium — is a theorem about
 * two-player zero-sum games and nothing else. Run it on a six-way table and
 * it still produces a strategy, but no theorem says the strategy is good, and
 * there is no equilibrium for it to be converging to in the first place. The
 * honest version of "a strong bot" stops at two players.
 *
 * Unlike everything else in this directory, this game has no oracle. Nobody
 * publishes the value of abstracted heads-up Hold'em, and the tree is far too
 * large to walk, so exploitability cannot be computed either. What can be
 * measured is whether the solved strategy beats the bots already in the repo,
 * in chips per hand, over enough hands to mean something — and that is what
 * the tests do.
 */

export interface HoldemOptions {
  /** Effective stack both players sit behind, in big blinds. */
  stack: number
  /** Strength buckets per postflop street. */
  buckets: number
  /** Most bets and raises allowed in one street. */
  betCap: number
}

export const DEFAULT_HOLDEM: HoldemOptions = { stack: 20, buckets: DEFAULT_BUCKETS, betCap: 3 }

export interface HoldemState {
  hole: CardInt[][]
  board: CardInt[]
  /** 0 preflop, 1 flop, 2 turn, 3 river. */
  street: number
  /** Betting so far this street. */
  betting: string
  /** Completed streets' betting, for the information set key. */
  past: string[]
  contributions: number[]
  folded: number
  /** True once somebody is all in and called: the rest is a run-out. */
  allIn: boolean
}

const CHECK: Action = 'k'
const CALL: Action = 'c'
const FOLD: Action = 'f'
const HALF: Action = 'h'
const POT: Action = 'p'
const ALL_IN: Action = 'a'

/** How many board cards each street has. */
const BOARD_SIZE = [0, 3, 4, 5]

export function abstractHoldem(options: HoldemOptions = DEFAULT_HOLDEM): Game<HoldemState> {
  const { stack, buckets, betCap } = options
  if (!(stack > 1)) throw new Error(`Need more than a big blind behind, got ${stack}`)

  /** Who acts first this street: the small blind before the flop, the big blind after. */
  const firstActor = (street: number) => (street === 0 ? 0 : 1)

  /**
   * A street is over once both players have acted and nobody is owed
   * anything — which is not the same as "somebody called". The small blind
   * calling before the flop is the case that catches people out: the money is
   * matched, but the big blind still has the option, and a solver that closes
   * the street there never lets them use it.
   */
  const closed = (betting: string, contributions: number[]): boolean => {
    if (betting.includes(FOLD)) return true
    if (betting.length < 2) return false
    const last = betting[betting.length - 1]
    if (last === CALL || last === CHECK) return true
    // A raise that could not actually raise — the stack ran out first — is a
    // call wearing a raise's name, and it has to close the street like one.
    // Leaving it open lets the same player act twice with nothing left to
    // bet, which is not a decision and not a legal one either.
    return Math.abs(contributions[0] - contributions[1]) < 1e-9
  }

  /**
   * A finished street, compressed to how much action it held and who started
   * it.
   *
   * The exact order of a settled street stops mattering once it is settled —
   * what carries forward is that somebody bet twice and who it was. Keeping
   * the raw sequence instead multiplies the information sets by the number of
   * ways each street could have gone, and by the river that factor is cubed:
   * it was the difference between fourteen thousand information sets and
   * fifty-eight thousand, on a training budget that can properly fill the
   * smaller number and not the larger.
   */
  const summarise = (betting: string, street: number): string => {
    const first = [...betting].findIndex((a) => a === HALF || a === POT || a === ALL_IN)
    if (first < 0) return 'x'
    const raises = [...betting].filter((a) => a === HALF || a === POT || a === ALL_IN).length
    return `${raises}${(firstActor(street) + first) % 2}`
  }

  const raiseTargets = (state: HoldemState, player: number): { action: Action; to: number }[] => {
    const pot = state.contributions[0] + state.contributions[1]
    const owed = state.contributions[1 - player] - state.contributions[player]
    const after = pot + owed
    // Always all three, even when two of them come to the same bet.
    //
    // The tempting thing is to drop a size that would commit the stack anyway
    // — it is the all-in under another name. But then the number of actions
    // at an information set depends on the pot, the pot depends on streets
    // that the abstracted history has already summarised away, and a solver
    // that stores regrets per action finds a different number of them on the
    // second visit. Clamping instead leaves a duplicate, which costs nothing:
    // splitting a frequency between two identical bets is the same bet.
    const targets: { action: Action; to: number }[] = [
      { action: HALF, to: Math.min(state.contributions[player] + owed + 0.5 * after, stack) },
      { action: POT, to: Math.min(state.contributions[player] + owed + after, stack) },
      { action: ALL_IN, to: stack },
    ]
    return targets
  }

  const game: Game<HoldemState> = {
    name: `Heads-up abstracted Hold'em, ${stack}bb, ${buckets} buckets`,
    bigBlind: 1,

    root(): HoldemState {
      return {
        hole: [],
        board: [],
        street: 0,
        betting: '',
        past: [],
        contributions: [0.5, 1],
        folded: -1,
        allIn: false,
      }
    },

    actor(state: HoldemState): Actor {
      if (state.hole.length < 2) return CHANCE
      if (state.board.length < BOARD_SIZE[state.street]) return CHANCE
      if (state.allIn) return CHANCE
      return ((firstActor(state.street) + state.betting.length) % 2) as 0 | 1
    },

    chanceOutcomes(state: HoldemState): ChanceOutcome[] {
      if (state.hole.length < 2) {
        throw new Error('Dealing hole cards has 1.6 million outcomes; this game is sampled, not enumerated')
      }
      const need = BOARD_SIZE[state.street] - state.board.length
      if (need !== 1) {
        throw new Error(`Dealing ${need} board cards at once is sampled, not enumerated`)
      }
      const dead = deadMask(state)
      const outcomes: ChanceOutcome[] = []
      const live: CardInt[] = []
      for (let card = 0; card < DECK_SIZE; card++) if (!dead[card]) live.push(card)
      for (const card of live) outcomes.push({ action: String(card), probability: 1 / live.length })
      return outcomes
    },

    sampleChance(state: HoldemState, rng: Rng): Action {
      const dead = deadMask(state)
      const live: CardInt[] = []
      for (let card = 0; card < DECK_SIZE; card++) if (!dead[card]) live.push(card)

      const need = state.hole.length < 2 ? 2 : BOARD_SIZE[state.street] - state.board.length
      const drawn: CardInt[] = []
      for (let i = 0; i < need; i++) {
        const j = i + Math.floor(rng() * (live.length - i))
        const swap = live[i]
        live[i] = live[j]
        live[j] = swap
        drawn.push(live[i])
      }
      return drawn.join(',')
    },

    apply(state: HoldemState, action: Action): HoldemState {
      if (state.hole.length < 2) {
        const cards = action.split(',').map(Number)
        return { ...state, hole: [...state.hole, cards] }
      }
      if (state.board.length < BOARD_SIZE[state.street]) {
        const cards = action.split(',').map(Number)
        return { ...state, board: [...state.board, ...cards] }
      }
      if (state.allIn) {
        // Only the run-out is left; every street past this one is a deal.
        return { ...state, street: state.street + 1 }
      }

      const player = (firstActor(state.street) + state.betting.length) % 2
      const contributions = [...state.contributions]

      if (action === FOLD) {
        return { ...state, betting: state.betting + action, folded: player }
      }

      // Narrowed to false by the run-out branch above; widened back because a
      // call can set it.
      if (action === CALL) {
        contributions[player] = contributions[1 - player]
      } else if (action !== CHECK) {
        const target = raiseTargets(state, player).find((t) => t.action === action)
        if (!target) throw new Error(`Illegal action "${action}"`)
        contributions[player] = target.to
      }

      // Both stacks in the middle means there is nothing left to decide on
      // any street after this one — however the chips got there.
      const allIn = contributions[0] >= stack - 1e-9 && contributions[1] >= stack - 1e-9
      const betting = state.betting + action
      if (!closed(betting, contributions)) return { ...state, betting, contributions, allIn }
      return {
        ...state,
        betting: '',
        past: [...state.past, betting],
        street: state.street + 1,
        contributions,
        allIn,
      }
    },

    legalActions(state: HoldemState): Action[] {
      const player = (firstActor(state.street) + state.betting.length) % 2
      const owed = state.contributions[1 - player] - state.contributions[player]
      const raises = [...state.betting].filter((a) => a === HALF || a === POT || a === ALL_IN).length
      const actions: Action[] = []

      if (owed > 1e-9) actions.push(FOLD, CALL)
      else actions.push(CHECK)

      // Nothing to raise with once the stack is in, and a street only takes
      // so much action before the tree stops being worth the branching.
      if (raises < betCap && state.contributions[player] < stack - 1e-9) {
        for (const target of raiseTargets(state, player)) actions.push(target.action)
      }
      return actions
    },

    isTerminal(state: HoldemState): boolean {
      if (state.folded >= 0) return true
      return state.street > 3
    },

    utility(state: HoldemState): number {
      const [a, b] = state.contributions
      if (state.folded >= 0) return state.folded === 0 ? -a : b
      const first = evaluateHand([...state.hole[0], ...state.board])
      const second = evaluateHand([...state.hole[1], ...state.board])
      if (first === second) return 0
      // Whoever wins takes what the loser put in; both risked the same by the
      // time it reached a showdown.
      return first > second ? b : -a
    },

    /**
     * The acting player's bucket and the public betting.
     *
     * Preflop the "bucket" is the hand's own class — 169 of them, which is
     * small enough that abstracting further would throw away information for
     * nothing. After the flop it is the strength bucket for this board.
     */
    infoSet(state: HoldemState): string {
      const player = (firstActor(state.street) + state.betting.length) % 2
      const hole = state.hole[player] as [CardInt, CardInt]
      const bucket =
        state.street === 0 ? classOf(hole[0], hole[1]) : bucketOf(hole, state.board, buckets)
      const history = [...state.past.map((betting, street) => summarise(betting, street)), state.betting].join('/')
      return `${state.street}|${bucket}|${history}`
    },
  }

  return game
}

function deadMask(state: HoldemState): Uint8Array {
  const dead = new Uint8Array(DECK_SIZE)
  for (const hand of state.hole) for (const card of hand) dead[card] = 1
  for (const card of state.board) dead[card] = 1
  return dead
}
