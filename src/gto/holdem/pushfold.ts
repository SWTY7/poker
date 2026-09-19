import { CLASS_COUNT, classFromLabel, classLabel } from '../../math/combos'
import { CHANCE, type Action, type Actor, type ChanceOutcome, type Game } from '../game'
import { classEquity, classProbability, opposingClasses } from './preflop'

/**
 * Heads-up push or fold: real cards, and still exactly solvable.
 *
 * Both players are dealt a hand from a real deck. The small blind either
 * moves all in or folds; facing a shove the big blind either calls or folds.
 * That is the whole game, and it is not a toy — it is how a heads-up match is
 * actually played once the stacks get short enough that any raise commits the
 * stack anyway, and the solved charts for it are published and memorised by
 * tournament players.
 *
 * It earns its place here for the same reason Kuhn did. Kuhn proved the
 * solver right on a game with three cards and no equity; this proves it right
 * on a game with all 52, real hand strengths and real card removal, while
 * still being small enough — 338 information sets — to solve exactly and
 * check against something. There are two things to check against: an
 * independently written solver in `pushfold-solver.ts`, and the published
 * charts.
 *
 * Between them and the Leduc solve, the parts about to be pointed at a game
 * nobody can solve have each been pointed at a game somebody has.
 */

export interface PushFoldState {
  /** Hand classes: index 0 the small blind's, index 1 the big blind's. */
  hands: number[]
  /** 's' shove, 'f' fold, 'c' call. */
  history: string
}

const SHOVE: Action = 's'
const FOLD: Action = 'f'
const CALL: Action = 'c'

// A solver visits every one of these hundreds of thousands of times, so the
// keys are built once. Composing them per visit is not a rounding error here
// — it was most of the running time.
const SB_KEYS: string[] = []
const BB_KEYS: string[] = []
for (let classIndex = 0; classIndex < CLASS_COUNT; classIndex++) {
  SB_KEYS.push(`SB:${classLabel(classIndex)}`)
  BB_KEYS.push(`BB:${classLabel(classIndex)}`)
}

const FIRST_DEAL: ChanceOutcome[] = []
for (let classIndex = 0; classIndex < CLASS_COUNT; classIndex++) {
  FIRST_DEAL.push({ action: String(classIndex), probability: classProbability(classIndex) })
}

const SECOND_DEAL: ChanceOutcome[][] = []
function secondDeal(first: number): ChanceOutcome[] {
  let outcomes = SECOND_DEAL[first]
  if (!outcomes) {
    outcomes = opposingClasses(first).map((entry) => ({
      action: String(entry.classIndex),
      probability: entry.probability,
    }))
    SECOND_DEAL[first] = outcomes
  }
  return outcomes
}

const OPEN_ACTIONS: Action[] = [FOLD, SHOVE]
const FACING_ACTIONS: Action[] = [FOLD, CALL]

export interface PushFoldGame extends Game<PushFoldState> {
  /** Effective stack, in big blinds, both players sitting behind. */
  readonly stack: number
}

/**
 * @param stack Effective stack in big blinds. Charts are quoted from about 2
 *   to 20; below one big blind the blinds are already all in and the game
 *   stops being a decision.
 */
export function pushFold(stack: number): PushFoldGame {
  if (!(stack >= 1)) throw new Error(`Push-fold needs at least one big blind behind, got ${stack}`)

  return {
    name: `Heads-up push/fold at ${stack}bb`,
    bigBlind: 1,
    stack,

    root(): PushFoldState {
      return { hands: [], history: '' }
    },

    actor(state: PushFoldState): Actor {
      if (state.hands.length < 2) return CHANCE
      return state.history.length === 0 ? 0 : 1
    },

    chanceOutcomes(state: PushFoldState): ChanceOutcome[] {
      // Card removal: what the small blind holds changes what the big blind
      // can hold, and by a lot for exactly the hands that decide the spot.
      return state.hands.length === 0 ? FIRST_DEAL : secondDeal(state.hands[0])
    },

    legalActions(state: PushFoldState): Action[] {
      return state.history.length === 0 ? OPEN_ACTIONS : FACING_ACTIONS
    },

    apply(state: PushFoldState, action: Action): PushFoldState {
      if (state.hands.length < 2) return { hands: [...state.hands, Number(action)], history: state.history }
      return { hands: state.hands, history: state.history + action }
    },

    isTerminal(state: PushFoldState): boolean {
      if (state.hands.length < 2) return false
      return state.history === FOLD || state.history.length === 2
    },

    /**
     * Chips won by the small blind, in big blinds.
     *
     * The showdown branch is the *expectation* over every board rather than
     * one sampled run-out. Nothing is lost by it — a terminal utility is
     * allowed to be an expectation — and it takes all the variance out of the
     * solve, which is why this game converges in a few hundred iterations
     * where Leduc needs thousands.
     */
    utility(state: PushFoldState): number {
      switch (state.history) {
        case FOLD:
          // The small blind gives up half a blind and the hand is over.
          return -0.5
        case SHOVE + FOLD:
          // The big blind's blind, and nothing else.
          return 1
        case SHOVE + CALL: {
          const equity = classEquity(state.hands[0], state.hands[1])
          return stack * (2 * equity - 1)
        }
        default:
          throw new Error(`Not a terminal history: "${state.history}"`)
      }
    },

    infoSet(state: PushFoldState): string {
      return state.history.length === 0 ? SB_KEYS[state.hands[0]] : BB_KEYS[state.hands[1]]
    },
  }
}

/** Index 1 of a push/fold strategy is the aggressive action: shove, or call. */
export const AGGRESSIVE = 1

/** Pulls a solved strategy back out as one frequency per hand class. */
export function frequencies(strategy: Map<string, number[]>, seat: 'SB' | 'BB'): number[] {
  const result = new Array<number>(CLASS_COUNT).fill(0)
  for (let classIndex = 0; classIndex < CLASS_COUNT; classIndex++) {
    const probabilities = strategy.get(`${seat}:${classLabel(classIndex)}`)
    if (probabilities) result[classIndex] = probabilities[AGGRESSIVE]
  }
  return result
}

/** How often one named hand is played, for spot checks against a chart. */
export function frequencyOf(strategy: Map<string, number[]>, seat: 'SB' | 'BB', label: string): number {
  return frequencies(strategy, seat)[classFromLabel(label)]
}
