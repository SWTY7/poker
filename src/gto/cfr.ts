import { CHANCE, type Game, type Strategy } from './game'

/**
 * Counterfactual regret minimization.
 *
 * The idea in one sentence: play the game against yourself, and at every
 * decision keep a running total of how much better each action *would* have
 * done than what you actually did; then play in proportion to those regrets
 * where they are positive. Regret matching drives average regret to zero,
 * and in a two-player zero-sum game the pair of average strategies with zero
 * average regret is a Nash equilibrium.
 *
 * The word to hold onto is **average**. The strategy that converges is the
 * average over all iterations, not the strategy at the last one, which keeps
 * moving forever and is usually badly exploitable. Returning the current
 * strategy is the single most common way to implement this and get a
 * confident, wrong answer, so `train` returns the average and never exposes
 * the other.
 *
 * "Counterfactual" is the other thing worth naming. A regret at an
 * information set is weighted by how likely the *opponent and the deck* were
 * to put you there, not by how likely you were to go there yourself. If it
 * were weighted by your own reach, an action you currently never take would
 * never accumulate the regret that would tell you to start taking it, and
 * the whole thing would stall wherever it began.
 */

interface Node {
  actions: string[]
  regretSum: number[]
  strategySum: number[]
  /** The regret-matched strategy for the iteration in progress. */
  current: number[]
}

export interface TrainOptions {
  /**
   * Regret matching+ floors cumulative regret at zero, so an action that has
   * been bad for a long time is reconsidered as soon as it stops being bad
   * rather than after it has worked off a deficit. With linear averaging it
   * is CFR+, which converges an order of magnitude faster on these games.
   */
  plus?: boolean
  /**
   * Weight iteration t by t when averaging. Later iterations are played by a
   * better strategy, so this discounts the early flailing instead of letting
   * it sit in the average forever.
   */
  linearAveraging?: boolean
  /** Called with (iteration, exploitability-free value) if progress is wanted. */
  onIteration?: (iteration: number, value: number) => void
}

export interface TrainResult {
  /** The average strategy — the one that is an equilibrium. */
  strategy: Strategy
  /** The game's value to player 0, as measured by the run. */
  value: number
  /** Information sets discovered. */
  nodeCount: number
  iterations: number
}

export function train<State>(game: Game<State>, iterations: number, options: TrainOptions = {}): TrainResult {
  const nodes = new Map<string, Node>()
  const plus = options.plus ?? false
  const linear = options.linearAveraging ?? plus

  let valueSum = 0
  let weightSum = 0

  for (let t = 1; t <= iterations; t++) {
    // Regret matching is a function of the regrets as they stand at the top
    // of the iteration, so it is computed once per node per iteration rather
    // than re-derived at every visit.
    for (const node of nodes.values()) node.current = regretMatch(node.regretSum)

    const weight = linear ? t : 1
    const value = walk(game, game.root(), 1, 1, 1, nodes, plus, weight)
    valueSum += weight * value
    weightSum += weight
    options.onIteration?.(t, value)
  }

  const strategy: Strategy = new Map()
  for (const [key, node] of nodes) strategy.set(key, normalize(node.strategySum, node.actions.length))

  return {
    strategy,
    value: weightSum === 0 ? 0 : valueSum / weightSum,
    nodeCount: nodes.size,
    iterations,
  }
}

/**
 * One traversal of the whole game tree, returning the expected utility to
 * player 0 with chance averaged in.
 *
 * `reach0` and `reach1` are how likely each player was to play their way
 * here; `reachChance` is how likely the deck was to deal it. A player's
 * counterfactual weight is the product of the *other* two, which is exactly
 * the "if I had tried to get here" in counterfactual regret.
 */
function walk<State>(
  game: Game<State>,
  state: State,
  reach0: number,
  reach1: number,
  reachChance: number,
  nodes: Map<string, Node>,
  plus: boolean,
  weight: number,
): number {
  if (game.isTerminal(state)) return game.utility(state)

  const actor = game.actor(state)
  if (actor === CHANCE) {
    let value = 0
    for (const outcome of game.chanceOutcomes(state)) {
      value +=
        outcome.probability *
        walk(
          game,
          game.apply(state, outcome.action),
          reach0,
          reach1,
          reachChance * outcome.probability,
          nodes,
          plus,
          weight,
        )
    }
    return value
  }

  const key = game.infoSet(state)
  const actions = game.legalActions(state)
  let node = nodes.get(key)
  if (!node) {
    node = {
      actions,
      regretSum: actions.map(() => 0),
      strategySum: actions.map(() => 0),
      current: actions.map(() => 1 / actions.length),
    }
    nodes.set(key, node)
  } else if (node.actions.length !== actions.length) {
    // Two states sharing an information set must offer the same choice, or
    // the regrets stored against it are regrets about different things. An
    // abstraction that collapses them too far breaks this quietly, so it is
    // checked rather than trusted.
    throw new Error(
      `Information set "${key}" offered ${node.actions.length} actions and now ${actions.length}`,
    )
  }

  const strategy = node.current
  const actionValues = new Array<number>(actions.length)
  let value = 0

  for (let i = 0; i < actions.length; i++) {
    const child = game.apply(state, actions[i])
    actionValues[i] =
      actor === 0
        ? walk(game, child, reach0 * strategy[i], reach1, reachChance, nodes, plus, weight)
        : walk(game, child, reach0, reach1 * strategy[i], reachChance, nodes, plus, weight)
    value += strategy[i] * actionValues[i]
  }

  // Utility is always stated for player 0, so player 1's regrets are for the
  // negative of it. Forgetting this sign is how a solver ends up teaching one
  // seat to lose on purpose.
  const sign = actor === 0 ? 1 : -1
  const counterfactual = reachChance * (actor === 0 ? reach1 : reach0)
  const ownReach = actor === 0 ? reach0 : reach1

  for (let i = 0; i < actions.length; i++) {
    node.regretSum[i] += counterfactual * sign * (actionValues[i] - value)
    if (plus && node.regretSum[i] < 0) node.regretSum[i] = 0
    node.strategySum[i] += weight * ownReach * strategy[i]
  }

  return value
}

/**
 * Regret matching: play each action in proportion to how much regret it has
 * accumulated, ignoring the ones you do not regret failing to take. With
 * nothing regretted yet — the first iteration, or an action set that has
 * never been reached — play uniformly.
 */
export function regretMatch(regrets: number[]): number[] {
  let positive = 0
  for (const regret of regrets) if (regret > 0) positive += regret
  if (positive <= 0) return regrets.map(() => 1 / regrets.length)
  return regrets.map((regret) => (regret > 0 ? regret / positive : 0))
}

function normalize(sums: number[], size: number): number[] {
  let total = 0
  for (const sum of sums) total += sum
  if (total <= 0) return new Array(size).fill(1 / size)
  return sums.map((sum) => sum / total)
}
