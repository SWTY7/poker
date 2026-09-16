/**
 * Prospect theory (Kahneman & Tversky, 1979) — the best single model of how
 * people actually gamble, and the one that explains most of what a losing
 * poker player does.
 *
 * Three claims, each of which becomes one function here:
 *
 *   Reference dependence. Outcomes are felt as gains and losses from a
 *   reference point, not as levels of wealth. A player up 500 and a player
 *   down 500 holding the same hand play it differently. Where that reference
 *   point sits is `accounting.ts`; this file takes it as given.
 *
 *   Loss aversion. The value function is steeper below the reference point
 *   than above it by a factor of lambda, about 2.25 — losing 100 hurts about
 *   as much as winning 225 pleases.
 *
 *   Diminishing sensitivity. The curve is concave in gains and *convex in
 *   losses*, which is the important half: a player already behind prefers a
 *   gamble to a certain loss of the same size. That is the whole mechanism
 *   behind chasing, and in poker it shows up as calling rivers too wide,
 *   because folding realises a certain loss while calling is a gamble.
 *
 * Plus a fourth, separate claim about probabilities rather than payoffs:
 * small probabilities are overweighted and moderate ones underweighted, so a
 * gutshot feels twice as likely as it is and a 60% favourite feels closer to
 * a coinflip.
 *
 * Nothing here knows about poker. It is fed outcomes in chips and gives back
 * a number that ranks them the way a person would.
 */

export interface ProspectParams {
  /** Curvature in gains. Below 1 is concave: risk-averse when ahead. */
  alpha: number
  /** Curvature in losses. Below 1 makes the loss branch convex: risk-seeking when behind. */
  beta: number
  /** Loss aversion. The steepness multiplier applied below the reference point. */
  lambda: number
  /** Probability-weighting curvature. Below 1 overweights the unlikely. */
  gamma: number
}

/**
 * The measured population values. alpha = beta = 0.88 and lambda = 2.25 are
 * Kahneman and Tversky's own estimates; gamma = 0.61 is the value that
 * reproduces the two anchors worth remembering, pi(0.05) = 0.13 and
 * pi(0.5) = 0.42.
 */
export const HUMAN_PROSPECT: ProspectParams = { alpha: 0.88, beta: 0.88, lambda: 2.25, gamma: 0.61 }

/**
 * The degenerate parameters that turn every distortion off: linear value,
 * no loss aversion, true probabilities. A bot given these maximizes plain
 * expected value, which makes it the control the others are compared against.
 */
export const RATIONAL_PROSPECT: ProspectParams = { alpha: 1, beta: 1, lambda: 1, gamma: 1 }

/**
 * The value function.
 *
 *   v(x) = x^alpha                for x >= 0
 *   v(x) = -lambda * (-x)^beta    for x < 0
 *
 * `x` is already relative to the reference point — a gain or a loss, not a
 * stack size.
 */
export function valueOf(x: number, params: ProspectParams = HUMAN_PROSPECT): number {
  if (x >= 0) return Math.pow(x, params.alpha)
  return -params.lambda * Math.pow(-x, params.beta)
}

/**
 * The probability weighting function, in Kahneman and Tversky's 1992 form:
 *
 *   pi(p) = p^gamma / (p^gamma + (1-p)^gamma)^(1/gamma)
 *
 * It is not a probability distribution and does not have to sum to one; it is
 * how much weight a decision actually gives an outcome of that likelihood.
 * With gamma below 1 the curve crosses the diagonal around a third: rarer
 * than that is felt as more likely than it is, commoner as less.
 */
export function weightProbability(p: number, params: ProspectParams = HUMAN_PROSPECT): number {
  if (p <= 0) return 0
  if (p >= 1) return 1
  const g = params.gamma
  const pg = Math.pow(p, g)
  const qg = Math.pow(1 - p, g)
  return pg / Math.pow(pg + qg, 1 / g)
}

export interface Outcome {
  /** Chips won or lost relative to the reference point. */
  payoff: number
  probability: number
}

/**
 * The subjective value of a gamble: sum of pi(p) * v(x) over its outcomes.
 *
 * This is the separable form from the 1979 paper rather than the cumulative
 * (rank-dependent) 1992 version. The separable form is what the behaviour
 * this models was originally derived from, and with the two- and three-
 * outcome gambles a poker decision reduces to, the two agree on the ordering
 * anyway. The cost is that the weights do not sum to one, so this number is
 * not an expected value in chips and is only ever compared against another
 * subjective value computed the same way — never against a pot size.
 */
export function subjectiveValue(outcomes: Outcome[], params: ProspectParams = HUMAN_PROSPECT): number {
  let total = 0
  for (const outcome of outcomes) {
    total += weightProbability(outcome.probability, params) * valueOf(outcome.payoff, params)
  }
  return total
}

/** Plain expected value of the same gamble, for comparison. */
export function expectedValue(outcomes: Outcome[]): number {
  let total = 0
  for (const outcome of outcomes) total += outcome.probability * outcome.payoff
  return total
}

/**
 * The equity a two-outcome call has to have before it feels break-even.
 *
 * Calling `bet` to win `pot` is the gamble {+pot with probability e, -bet
 * otherwise}. Setting its subjective value to zero and solving for e gives
 * the threshold a player with these parameters actually uses, against the
 * bet/(pot + 2*bet) that pot odds say. Comparing the two is the cleanest
 * statement of how far a bias moves a decision, so it is worth having as a
 * function rather than as a fact buried in a test.
 *
 * The reference point here is the current stack — a player treating this pot
 * as its own account, even for the session so far. That is the case where
 * loss aversion dominates and the threshold comes out *above* pot odds. Move
 * the reference point and the answer moves with it, which is the whole point
 * of reference dependence; `accounting.ts` is where it moves.
 */
export function subjectiveCallThreshold(bet: number, pot: number, params: ProspectParams = HUMAN_PROSPECT): number {
  const gain = valueOf(pot + bet, params)
  const loss = valueOf(-bet, params)
  // Binary search on e: subjective value is monotone increasing in it.
  let low = 0
  let high = 1
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2
    const value = weightProbability(mid, params) * gain + weightProbability(1 - mid, params) * loss
    if (value < 0) low = mid
    else high = mid
  }
  return (low + high) / 2
}
