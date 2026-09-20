import type { Strategy } from '../game'
import type { HoldemOptions } from './abstract-holdem'

/**
 * A solved strategy, on disk.
 *
 * Training takes minutes and the browser has none to spare, so the blueprint
 * is computed once by `scripts/train-blueprint.ts` and shipped as data. What
 * is stored is the average strategy — the one CFR converges to — as a
 * probability per action per information set, with the actions in the order
 * the game lists them.
 *
 * Probabilities are rounded to thousandths and stored as integers, which
 * halves the file and costs nothing a solver would notice: no decision turns
 * on the fourth decimal place of a frequency.
 */
export interface BlueprintFile {
  options: HoldemOptions
  iterations: number
  /** Information set key to per-action probabilities in thousandths. */
  strategy: Record<string, number[]>
}

export function encodeBlueprint(strategy: Strategy, options: HoldemOptions, iterations: number): BlueprintFile {
  const encoded: Record<string, number[]> = {}
  for (const [key, probabilities] of strategy) {
    encoded[key] = probabilities.map((p) => Math.round(p * 1000))
  }
  return { options, iterations, strategy: encoded }
}

export function decodeBlueprint(file: BlueprintFile): Strategy {
  const strategy: Strategy = new Map()
  for (const [key, thousandths] of Object.entries(file.strategy)) {
    const total = thousandths.reduce((sum, value) => sum + value, 0)
    strategy.set(
      key,
      total > 0 ? thousandths.map((value) => value / total) : thousandths.map(() => 1 / thousandths.length),
    )
  }
  return strategy
}
