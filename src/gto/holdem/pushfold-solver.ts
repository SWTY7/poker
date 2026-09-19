import { CLASS_COUNT } from '../../math/combos'
import { classEquity, classProbability, conditionalProbability } from './preflop'

/**
 * A second, independent solver for the same game.
 *
 * This one knows it is looking at push/fold: the decision is binary and the
 * game is two decisions deep, so a best response can be written down in
 * closed form — shove when shoving beats giving up the half blind, call when
 * calling beats giving up the blind — and fictitious play drives the pair of
 * them to the equilibrium. Nothing here shares a line of code with CFR.
 *
 * That is the entire point of it. CFR is a general method that is supposed to
 * work on games nobody can check, so the way to trust it is to point it at a
 * game that *can* be checked by other means and see the same answer come
 * back. Kuhn's closed form did that for the toy; this does it for real cards,
 * real equities and real card removal.
 *
 * Fictitious play converges in two-player zero-sum games (Robinson, 1951),
 * which is the same condition CFR needs, so both are on solid ground here —
 * and they are different enough algorithms that agreeing is evidence rather
 * than a shared bug.
 */

export interface PushFoldSolution {
  /** How often the small blind shoves each hand class. */
  shove: number[]
  /** How often the big blind calls each hand class, facing a shove. */
  call: number[]
  /** What the game is worth to the small blind, in big blinds per hand. */
  value: number
  iterations: number
}

interface Tables {
  /** P(villain holds b | hero holds a). */
  conditional: Float64Array
  /** Equity of a against b, all in. */
  equity: Float64Array
  /** P(hero is dealt a). */
  prior: Float64Array
}

let cached: Tables | null = null

function tables(): Tables {
  if (cached) return cached
  const conditional = new Float64Array(CLASS_COUNT * CLASS_COUNT)
  const equity = new Float64Array(CLASS_COUNT * CLASS_COUNT)
  const prior = new Float64Array(CLASS_COUNT)
  for (let a = 0; a < CLASS_COUNT; a++) {
    prior[a] = classProbability(a)
    for (let b = 0; b < CLASS_COUNT; b++) {
      conditional[a * CLASS_COUNT + b] = conditionalProbability(a, b)
      equity[a * CLASS_COUNT + b] = classEquity(a, b)
    }
  }
  cached = { conditional, equity, prior }
  return cached
}

export function solvePushFold(stack: number, iterations = 3000): PushFoldSolution {
  if (!(stack >= 1)) throw new Error(`Push-fold needs at least one big blind behind, got ${stack}`)
  const { conditional, equity, prior } = tables()

  const shove = new Array<number>(CLASS_COUNT).fill(0.5)
  const call = new Array<number>(CLASS_COUNT).fill(0.5)

  for (let t = 1; t <= iterations; t++) {
    const shoveBest = bestShove(stack, call, conditional, equity)
    const callBest = bestCall(stack, shove, conditional, equity)
    // The average of every best response so far, updated in place. Averaging
    // is what makes this converge rather than oscillate: a pure best response
    // to a pure strategy flips the whole range at once, and two of them chase
    // each other forever.
    const step = 1 / (t + 1)
    for (let c = 0; c < CLASS_COUNT; c++) {
      shove[c] += step * (shoveBest[c] - shove[c])
      call[c] += step * (callBest[c] - call[c])
    }
  }

  return { shove, call, value: gameValue(stack, shove, call, conditional, equity, prior), iterations }
}

/** Shove whenever shoving beats surrendering the small blind. */
function bestShove(stack: number, call: number[], conditional: Float64Array, equity: Float64Array): number[] {
  const best = new Array<number>(CLASS_COUNT)
  for (let a = 0; a < CLASS_COUNT; a++) {
    best[a] = shoveValue(a, stack, call, conditional, equity) > -0.5 ? 1 : 0
  }
  return best
}

function shoveValue(a: number, stack: number, call: number[], conditional: Float64Array, equity: Float64Array): number {
  let value = 0
  const row = a * CLASS_COUNT
  for (let b = 0; b < CLASS_COUNT; b++) {
    const weight = conditional[row + b]
    if (weight === 0) continue
    const called = call[b]
    // Folded to: the big blind's blind. Called: the whole stack at stake,
    // and equity decides how much of the doubled pot comes back.
    value += weight * ((1 - called) * 1 + called * stack * (2 * equity[row + b] - 1))
  }
  return value
}

/**
 * Call whenever calling beats surrendering the big blind — weighted by which
 * hands actually shove, which is the part that makes a calling range tighter
 * than a shoving one against a tight opponent and wider against a loose one.
 */
function bestCall(stack: number, shove: number[], conditional: Float64Array, equity: Float64Array): number[] {
  const best = new Array<number>(CLASS_COUNT)
  for (let b = 0; b < CLASS_COUNT; b++) {
    const row = b * CLASS_COUNT
    let gain = 0
    for (let a = 0; a < CLASS_COUNT; a++) {
      const weight = conditional[row + a] * shove[a]
      if (weight === 0) continue
      gain += weight * (stack * (2 * equity[row + a] - 1) + 1)
    }
    best[b] = gain > 0 ? 1 : 0
  }
  return best
}

function gameValue(
  stack: number,
  shove: number[],
  call: number[],
  conditional: Float64Array,
  equity: Float64Array,
  prior: Float64Array,
): number {
  let value = 0
  for (let a = 0; a < CLASS_COUNT; a++) {
    const shoving = shoveValue(a, stack, call, conditional, equity)
    value += prior[a] * (shove[a] * shoving + (1 - shove[a]) * -0.5)
  }
  return value
}

export interface PushFoldEdges {
  /** What shoving is worth over folding, per hand class, in big blinds. */
  shove: number[]
  /** What calling is worth over folding, per class, given the shove happened. */
  call: number[]
}

/**
 * How much each hand actually gains by taking the aggressive line at the
 * equilibrium.
 *
 * This is what makes a disagreement between two solvers readable. A hand
 * whose edge is a hundredth of a blind is *indifferent* — the equilibrium
 * does not care what it does, and two correct solvers can and will settle it
 * differently. A hand with a real edge that they disagree about is a bug.
 * Without this, every difference looks the same.
 */
export function edges(stack: number, solution: PushFoldSolution): PushFoldEdges {
  const { conditional, equity } = tables()
  const shove = new Array<number>(CLASS_COUNT)
  const call = new Array<number>(CLASS_COUNT)

  for (let a = 0; a < CLASS_COUNT; a++) {
    shove[a] = shoveValue(a, stack, solution.call, conditional, equity) - -0.5
  }

  for (let b = 0; b < CLASS_COUNT; b++) {
    const row = b * CLASS_COUNT
    let gain = 0
    let facing = 0
    for (let a = 0; a < CLASS_COUNT; a++) {
      const weight = conditional[row + a] * solution.shove[a]
      if (weight === 0) continue
      gain += weight * (stack * (2 * equity[row + a] - 1) + 1)
      facing += weight
    }
    // Per hand actually facing a shove, so the number is comparable across
    // classes rather than scaled by how often they get the chance.
    call[b] = facing === 0 ? 0 : gain / facing
  }

  return { shove, call }
}
