/**
 * An extensive-form game, which is the only thing the solver is allowed to
 * know about.
 *
 * Everything in `src/gto/` is written against this interface and nothing
 * else. That is not architectural politeness — it is how the solver becomes
 * testable. Kuhn poker has a known analytic solution, so a solver that only
 * speaks this interface can be pointed at Kuhn and *checked*, and the same
 * code then runs on Leduc and on an abstraction of Hold'em. A solver written
 * against Hold'em directly can only be checked against opinion.
 *
 * The games here are two-player and zero-sum: `utility` is the payoff to
 * player 0, and player 1's is its negative. That restriction is what makes
 * the equilibrium unique in value, the exploitability of a strategy well
 * defined, and CFR's convergence guarantee apply at all.
 */

export type Action = string

/** Seat 0 acts first at the root. */
export type Player = 0 | 1

/** The dealer: a node where nobody chooses and the deck does. */
export const CHANCE = -1
export type Actor = Player | typeof CHANCE

export interface ChanceOutcome {
  action: Action
  probability: number
}

export interface Game<State> {
  readonly name: string
  /** Chips one player puts up before any cards, for reporting results in a comparable unit. */
  readonly bigBlind: number

  root(): State
  isTerminal(state: State): boolean
  /** Payoff to player 0. Player 1 receives the negative of it. */
  utility(state: State): number

  actor(state: State): Actor
  legalActions(state: State): Action[]
  apply(state: State, action: Action): State

  /** Only called at chance nodes. Probabilities must sum to 1. */
  chanceOutcomes(state: State): ChanceOutcome[]

  /**
   * Everything the player to act can tell apart, as a string.
   *
   * Two histories with the same key are the same decision as far as that
   * player is concerned — they hold the same cards and have seen the same
   * betting, and any strategy has to play them identically because they
   * cannot tell which one they are in. Getting this wrong is the single
   * easiest way to build a solver that converges confidently to nonsense, so
   * the key must contain the acting player's private information and the
   * public history, and nothing else.
   */
  infoSet(state: State): string
}

/**
 * A behavioural strategy: for each information set, a probability for each
 * legal action, in the order `legalActions` returns them.
 */
export type Strategy = Map<string, number[]>

/** Uniform play, which is where every solver starts and what it is measured against. */
export function uniformStrategy<State>(game: Game<State>): Strategy {
  const strategy: Strategy = new Map()
  const visit = (state: State) => {
    if (game.isTerminal(state)) return
    const actor = game.actor(state)
    if (actor === CHANCE) {
      for (const outcome of game.chanceOutcomes(state)) visit(game.apply(state, outcome.action))
      return
    }
    const actions = game.legalActions(state)
    const key = game.infoSet(state)
    if (!strategy.has(key)) strategy.set(key, actions.map(() => 1 / actions.length))
    for (const action of actions) visit(game.apply(state, action))
  }
  visit(game.root())
  return strategy
}

/** How often a strategy takes one named action at one information set. */
export function actionProbability(strategy: Strategy, infoSet: string, index: number): number {
  const probabilities = strategy.get(infoSet)
  if (!probabilities) throw new Error(`No strategy for information set "${infoSet}"`)
  return probabilities[index]
}

/** Every information set a strategy has an entry for, sorted for readable output. */
export function infoSets(strategy: Strategy): string[] {
  return [...strategy.keys()].sort()
}
