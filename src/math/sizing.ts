import { DECK_SIZE, type CardInt } from '../poker/fast/cards'
import { evaluateHand } from '../poker/fast/eval7'
import { COMBO_A, COMBO_B, COMBO_COUNT } from './combos'
import type { Range } from './range'

export interface RangeShape {
  /**
   * 0 = every hand in the range is worth about the same on this board,
   * 1 = it is all nuts and all air with nothing in between.
   */
  polarization: number
  /** Share of the range holding a hand in the top fifth of what this board allows. */
  nutted: number
  /** Share holding a hand in the bottom fifth. */
  air: number
  /** Mean strength percentile of the range on this board, 0..1. */
  meanStrength: number
}

/**
 * How a range is shaped on a board, and therefore how it should bet.
 *
 * Sizing is not a style choice and it is not a function of how strong your own
 * hand is. It follows from the distribution of the range you are betting:
 *
 *   Polarized — the nuts plus bluffs, little in between. Bet large. Your value
 *   hands beat everything that can call, so a bigger bet costs you only on the
 *   bluffs and buys folds from hands with real equity.
 *
 *   Condensed — lots of medium-strength hands, few nuts. Bet small. You want
 *   calls from worse and cannot profitably continue against a raise, so you
 *   are buying cheap value and denying equity, not applying pressure.
 *
 * Strength here is a percentile against *every hand that could be held on this
 * board*, not equity against a particular opponent. That is deliberate: it
 * makes the measure a property of the range and the board alone, so two
 * ranges can be compared on the same scale, and it is the literal form of the
 * question worth asking before sizing — do I hold the top of this board more
 * often than they do?
 *
 * It is also cheap. One evaluation per combo rather than an equity run per
 * combo, which is the difference between a fraction of a millisecond and
 * twenty seconds.
 */
export function rangeShape(range: Range, board: CardInt[]): RangeShape {
  if (board.length < 3) {
    throw new Error('Range shape is a property of a board; there is none before the flop')
  }

  const { percentile, dead } = boardStrengthPercentiles(board)

  let totalWeight = 0
  let weightedStrength = 0
  let nutted = 0
  let air = 0
  const entries: { strength: number; weight: number }[] = []

  for (let id = 0; id < COMBO_COUNT; id++) {
    const weight = range[id]
    if (weight <= 0) continue
    if (dead[COMBO_A[id]] || dead[COMBO_B[id]]) continue

    const strength = percentile[id]
    entries.push({ strength, weight })
    totalWeight += weight
    weightedStrength += weight * strength
    if (strength >= 0.8) nutted += weight
    else if (strength < 0.2) air += weight
  }

  if (totalWeight === 0) return { polarization: 0, nutted: 0, air: 0, meanStrength: 0 }

  const mean = weightedStrength / totalWeight
  let variance = 0
  for (const entry of entries) variance += entry.weight * (entry.strength - mean) ** 2
  const spread = Math.sqrt(variance / totalWeight)

  // A range spread uniformly across the board's strengths has a standard
  // deviation of 1/sqrt(12) ≈ 0.289; one split between the extremes
  // approaches 0.5. Those are the natural endpoints, so the scale runs
  // between them rather than over an arbitrary range.
  const polarization = clamp01((spread - 0.289) / (0.5 - 0.289))

  return { polarization, nutted: nutted / totalWeight, air: air / totalWeight, meanStrength: mean }
}

/**
 * Bet size as a fraction of the pot, from how polarized the betting range is.
 *
 * The endpoints are the conventional ones — a quarter pot for the most
 * condensed range, an overbet for the most polarized — with a straight
 * interpolation between, because the relationship is monotone and nobody has
 * a principled curve for it.
 */
export function recommendedSizeFraction(polarization: number): number {
  return 0.25 + clamp01(polarization) * (1.25 - 0.25)
}

export interface BoardFavour {
  /** Share of each range holding a top-fifth hand on this board. */
  heroNutted: number
  villainNutted: number
  heroMean: number
  villainMean: number
  /** True when the hero holds the top of this board more often than the villain. */
  favoursHero: boolean
}

/**
 * The question to ask before choosing a size: do I have the top of this board
 * more often than they do?
 *
 * If yes, a large bet applies an advantage that is really there. If no —
 * a preflop raiser on 8-7-6, say, where the caller's range is full of the
 * hands that connect — betting big is building a pot for someone else's
 * range, and the right size is small or none.
 */
export function boardFavours(heroRange: Range, villainRange: Range, board: CardInt[]): BoardFavour {
  const hero = rangeShape(heroRange, board)
  const villain = rangeShape(villainRange, board)
  return {
    heroNutted: hero.nutted,
    villainNutted: villain.nutted,
    heroMean: hero.meanStrength,
    villainMean: villain.meanStrength,
    favoursHero: hero.nutted > villain.nutted,
  }
}

// --- internals ---------------------------------------------------------------

/**
 * For every combo that can still be held on this board, where its made hand
 * ranks among all of them: 1 is the best hand available, 0 the worst. Ties
 * share the midpoint of the positions they span, so a board that plays gives
 * every hand the same percentile rather than an arbitrary order.
 */
function boardStrengthPercentiles(board: CardInt[]): { percentile: Float64Array; dead: Uint8Array } {
  const dead = new Uint8Array(DECK_SIZE)
  for (const card of board) dead[card] = 1

  const percentile = new Float64Array(COMBO_COUNT)
  const live: { id: number; score: number }[] = []
  const hand = [0, 0, ...board]

  for (let id = 0; id < COMBO_COUNT; id++) {
    const a = COMBO_A[id]
    const b = COMBO_B[id]
    if (dead[a] || dead[b]) continue
    hand[0] = a
    hand[1] = b
    live.push({ id, score: evaluateHand(hand) })
  }

  live.sort((x, y) => x.score - y.score)

  let i = 0
  while (i < live.length) {
    let j = i
    while (j + 1 < live.length && live[j + 1].score === live[i].score) j++
    // Midpoint of the tied block, normalised to 0..1.
    const rank = live.length === 1 ? 0.5 : (i + j) / 2 / (live.length - 1)
    for (let k = i; k <= j; k++) percentile[live[k].id] = rank
    i = j + 1
  }

  return { percentile, dead }
}

function clamp01(x: number): number {
  return Math.min(Math.max(x, 0), 1)
}
