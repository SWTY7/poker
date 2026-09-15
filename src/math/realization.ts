import type { PositionLabel } from '../poker/position'
import { DECK_SIZE } from '../poker/fast/cards'
import { evaluateHand } from '../poker/fast/eval7'
import { classLabel, COMBO_CLASS, COMBO_COUNT } from './combos'
import { emptyRange, type Range } from './range'
import { classCombos, allClassIndices } from './combos'
import { COMBO_A, COMBO_B } from './combos'
import { createRng, shuffle } from '../utils/random'

/**
 * Position does not change how often your hand is best. It changes how much
 * of that you get to keep.
 *
 * Acting last means every decision is made already knowing what everyone else
 * did, which turns marginal spots into cheap ones and lets speculative hands
 * see cards without paying for the privilege. Acting first means the reverse.
 * The effect is real but it is not an equity adjustment — the cards do not
 * care where you sit — so it is modelled as a separate multiplier applied to
 * equity when estimating what a hand is worth:
 *
 *     effective = R * raw
 *
 * R above 1 for hands that want to see cards cheaply in position, below 1 for
 * hands that will be guessing out of position.
 */

export type HandType = 'made' | 'marginal' | 'speculative'

export type PositionClass = 'early' | 'middle' | 'late' | 'blinds'

/** Which broad seat group a position label belongs to. */
export function positionClass(position: PositionLabel): PositionClass {
  switch (position) {
    case 'SB':
    case 'BB':
      return 'blinds'
    case 'BTN':
    case 'CO':
    case 'HJ':
      return 'late'
    case 'MP':
    case 'MP+1':
    case 'MP+2':
      return 'middle'
    default:
      return 'early'
  }
}

/** True when this seat acts after the flop with information, not before it. */
export function hasPosition(position: PositionLabel): boolean {
  return positionClass(position) === 'late'
}

/**
 * Realization factors. In position a made hand keeps roughly what it is
 * worth and a speculative one keeps more than it is worth, because the times
 * it connects are the times it gets paid. Out of position the marginal hands
 * suffer most: they are the ones forced to guess.
 */
const REALIZATION: Record<PositionClass, Record<HandType, number>> = {
  late: { made: 1.05, marginal: 1.0, speculative: 1.15 },
  middle: { made: 1.0, marginal: 0.92, speculative: 1.0 },
  early: { made: 0.98, marginal: 0.85, speculative: 0.9 },
  blinds: { made: 0.95, marginal: 0.8, speculative: 0.85 },
}

export function realization(position: PositionLabel, handType: HandType): number {
  return REALIZATION[positionClass(position)][handType]
}

/** Equity adjusted for how much of it this seat will actually capture. */
export function effectiveEquity(rawEquity: number, position: PositionLabel, handType: HandType): number {
  return rawEquity * realization(position, handType)
}

/**
 * How wide each seat opens, as a share of all hands.
 *
 * These are the conventional figures, and they are a consequence of the
 * realization factors above rather than an independent fact: a seat that
 * keeps more of its equity can profitably enter with less of it.
 */
export const OPEN_PERCENT: Record<PositionLabel, number> = {
  UTG: 0.15,
  'UTG+1': 0.16,
  'UTG+2': 0.17,
  MP: 0.18,
  'MP+1': 0.2,
  'MP+2': 0.22,
  HJ: 0.24,
  CO: 0.27,
  BTN: 0.45,
  SB: 0.4,
  BB: 0.4,
}

/**
 * Hand classes ordered by raw preflop strength — equity against a single
 * random hand, measured rather than asserted.
 *
 * This is what lets an opening range be derived ("the top 15% of hands")
 * instead of transcribed from a chart, which means the ranges cannot silently
 * disagree with the equities the rest of the app computes. It is the only
 * expensive thing in this module, so it is computed once on first use and
 * kept; `trials` is read on that first call and ignored afterwards.
 */
let strengthOrder: number[] | null = null

export function classStrengthOrder(trials = 4000): number[] {
  if (strengthOrder) return strengthOrder

  // Common random numbers. Every class is measured against the *same* list of
  // shuffled decks, so the differences between two classes come from the cards
  // they hold rather than from the luck of the deals they were dealt. Without
  // this the bottom of the order is noise: 32o and 72o differ by well under a
  // percentage point of equity, which a few thousand independent deals cannot
  // resolve, and the order comes out different for every seed.
  const rng = createRng(20250915)
  const deals = new Int8Array(trials * DECK_SIZE)
  const deck = Array.from({ length: DECK_SIZE }, (_, i) => i)
  for (let t = 0; t < trials; t++) {
    shuffle(deck, rng)
    for (let i = 0; i < DECK_SIZE; i++) deals[t * DECK_SIZE + i] = deck[i]
  }

  const heroHand = [0, 0, 0, 0, 0, 0, 0]
  const villainHand = [0, 0, 0, 0, 0, 0, 0]

  const scored = allClassIndices().map((classIndex) => {
    const id = classCombos(classIndex)[0]
    const a = COMBO_A[id]
    const b = COMBO_B[id]
    heroHand[0] = a
    heroHand[1] = b

    let score = 0
    for (let t = 0; t < trials; t++) {
      const base = t * DECK_SIZE
      // The first seven cards of this deck that the hero is not already
      // holding: two for the opponent, five for the board.
      let taken = 0
      for (let i = 0; i < DECK_SIZE && taken < 7; i++) {
        const card = deals[base + i]
        if (card === a || card === b) continue
        if (taken < 2) villainHand[taken] = card
        else {
          heroHand[taken] = card
          villainHand[taken] = card
        }
        taken++
      }
      const hero = evaluateHand(heroHand)
      const villain = evaluateHand(villainHand)
      if (hero > villain) score += 1
      else if (hero === villain) score += 0.5
    }
    return { classIndex, equity: score / trials }
  })

  scored.sort((x, y) => y.equity - x.equity)
  strengthOrder = scored.map((s) => s.classIndex)
  return strengthOrder
}

/**
 * The strongest `percent` of all hands, by combos rather than by class — the
 * only counting that matches what "opens 15% of hands" means, since offsuit
 * classes are three times as common as suited ones.
 */
export function topPercentRange(percent: number): Range {
  const target = percent * 1326
  const range = emptyRange()
  let taken = 0
  for (const classIndex of classStrengthOrder()) {
    if (taken >= target) break
    for (let id = 0; id < COMBO_COUNT; id++) {
      if (COMBO_CLASS[id] === classIndex) {
        range[id] = 1
        taken++
      }
    }
  }
  return range
}

/** The range a seat opens with, derived from its width. */
export function openingRange(position: PositionLabel): Range {
  return topPercentRange(OPEN_PERCENT[position])
}

/** Readable form, for eyeballing a derived range against a known chart. */
export function describeRange(range: Range): string {
  const present = new Set<number>()
  for (let id = 0; id < COMBO_COUNT; id++) if (range[id] > 0) present.add(COMBO_CLASS[id])
  return [...present]
    .sort((a, b) => a - b)
    .map(classLabel)
    .join(', ')
}
