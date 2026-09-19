import { CHANCE, type Game, type Player, type Strategy } from './game'
import { regretMatch } from './cfr'
import { createRng, type Rng } from '../utils/random'

/**
 * Monte Carlo CFR, external sampling.
 *
 * Vanilla CFR walks the entire game tree on every iteration. That is exactly
 * right and it is why Kuhn and Leduc can be solved here in seconds — and it
 * is also the reason it stops at Leduc. An abstraction of Hold'em has
 * billions of information sets, and a method whose per-iteration cost is the
 * size of the tree cannot take a single step through one.
 *
 * External sampling keeps the full walk only where the information is:
 *
 *   at the updating player's nodes, every action is explored, because that
 *   is where regret is being measured and a sampled action would measure
 *   nothing about the others
 *
 *   at the opponent's nodes and at the deck, one outcome is sampled, because
 *   those are expectations and an unbiased sample of an expectation is still
 *   an expectation
 *
 * The result is unbiased — the sampled counterfactual values have the right
 * mean — so the same convergence guarantee applies, with a constant that
 * depends on the variance the sampling introduces. In exchange an iteration
 * costs a path through the tree instead of the whole thing.
 *
 * The trade is a real one and it goes the wrong way on small games: on Leduc
 * an MCCFR iteration is worth much less than a vanilla one, and it takes
 * many more of them to reach the same exploitability. What matters is the
 * cost per iteration falling faster than the number needed rises, which it
 * does as soon as the tree is big enough that walking it is the bottleneck.
 * Comparing them per iteration is therefore meaningless; the honest
 * comparison is exploitability against wall-clock, and that is how the tests
 * measure it.
 */

interface Node {
  actions: string[]
  regretSum: number[]
  strategySum: number[]
}

export interface MccfrOptions {
  rng?: Rng
  /** Floor regrets at zero, as in CFR+. */
  plus?: boolean
}

export interface MccfrResult {
  strategy: Strategy
  /**
   * How much evidence each information set's strategy rests on.
   *
   * Sampling reaches the common spots thousands of times and the rare ones
   * twice, and an average strategy built from two visits is noise wearing a
   * strategy's clothes. Keeping the weight lets a caller tell the two apart —
   * which is what decides whether an entry is worth shipping.
   */
  weight: Map<string, number>
  nodeCount: number
  iterations: number
}

export function trainMccfr<State>(
  game: Game<State>,
  iterations: number,
  options: MccfrOptions = {},
): MccfrResult {
  const nodes = new Map<string, Node>()
  const rng = options.rng ?? createRng(1)
  const plus = options.plus ?? false

  for (let t = 1; t <= iterations; t++) {
    // One pass per seat: a player's regrets are only measured on the passes
    // where they are the one being updated.
    walk(game, game.root(), 0, nodes, rng, plus)
    walk(game, game.root(), 1, nodes, rng, plus)
  }

  const strategy: Strategy = new Map()
  const weight = new Map<string, number>()
  for (const [key, node] of nodes) {
    strategy.set(key, normalize(node.strategySum, node.actions.length))
    weight.set(key, node.strategySum.reduce((sum, value) => sum + value, 0))
  }
  return { strategy, weight, nodeCount: nodes.size, iterations }
}

/** Expected utility to `player`, along one sampled path through everyone else's choices. */
function walk<State>(
  game: Game<State>,
  state: State,
  player: Player,
  nodes: Map<string, Node>,
  rng: Rng,
  plus: boolean,
): number {
  if (game.isTerminal(state)) {
    const utility = game.utility(state)
    return player === 0 ? utility : -utility
  }

  const actor = game.actor(state)
  if (actor === CHANCE) {
    const outcome = game.sampleChance
      ? game.sampleChance(state, rng)
      : sample(game.chanceOutcomes(state), rng)
    return walk(game, game.apply(state, outcome), player, nodes, rng, plus)
  }

  const key = game.infoSet(state)
  const actions = game.legalActions(state)
  let node = nodes.get(key)
  if (!node) {
    node = { actions, regretSum: actions.map(() => 0), strategySum: actions.map(() => 0) }
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
  const strategy = regretMatch(node.regretSum)

  if (actor !== player) {
    // The opponent's turn: sample it, and bank the strategy that sampled it.
    // This is where the average strategy is accumulated, because this pass is
    // the one that visits this information set in proportion to how often it
    // is actually reached.
    for (let i = 0; i < actions.length; i++) node.strategySum[i] += strategy[i]
    const index = sampleIndex(strategy, rng)
    return walk(game, game.apply(state, actions[index]), player, nodes, rng, plus)
  }

  const actionValues = new Array<number>(actions.length)
  let value = 0
  for (let i = 0; i < actions.length; i++) {
    actionValues[i] = walk(game, game.apply(state, actions[i]), player, nodes, rng, plus)
    value += strategy[i] * actionValues[i]
  }

  // No reach weighting: the sampling already visited this information set in
  // proportion to the opponent and chance reach that vanilla CFR has to
  // multiply in by hand. Putting it in as well would count it twice.
  for (let i = 0; i < actions.length; i++) {
    node.regretSum[i] += actionValues[i] - value
    if (plus && node.regretSum[i] < 0) node.regretSum[i] = 0
  }

  return value
}

function sample(outcomes: { action: string; probability: number }[], rng: Rng): string {
  let roll = rng()
  for (const outcome of outcomes) {
    roll -= outcome.probability
    if (roll <= 0) return outcome.action
  }
  return outcomes[outcomes.length - 1].action
}

function sampleIndex(probabilities: number[], rng: Rng): number {
  let roll = rng()
  for (let i = 0; i < probabilities.length; i++) {
    roll -= probabilities[i]
    if (roll <= 0) return i
  }
  return probabilities.length - 1
}

function normalize(sums: number[], size: number): number[] {
  let total = 0
  for (const sum of sums) total += sum
  if (total <= 0) return new Array(size).fill(1 / size)
  return sums.map((sum) => sum / total)
}
