import { CLASS_COUNT, COMBO_A, COMBO_B, COMBO_CLASS, COMBO_COUNT, classLabel } from '../../math/combos'
import table from './preflop-equity.json'

/**
 * All-in preflop equity and how often two hand classes meet.
 *
 * Both are facts about the deck rather than about strategy, so both are
 * computed once and never again: the equities are measured offline by
 * `scripts/preflop-equity.ts` and checked in, and the meeting frequencies are
 * counted exactly on first use.
 *
 * The second one is the part that is easy to get wrong. Two players cannot
 * hold the same card, so the chance of facing pocket aces is not 6/1326 when
 * you hold an ace yourself — it is half that. A preflop solver that deals
 * both hands independently is solving a game with a different deck from the
 * one on the table, and the error lands exactly where it matters most, on the
 * big hands.
 */

const EQUITY: number[] = table.equity

if (table.classCount !== CLASS_COUNT) {
  throw new Error(`Preflop table is for ${table.classCount} classes, not ${CLASS_COUNT}`)
}

/**
 * Share of the pot class `a` takes all-in against class `b`, ties counted
 * half. Exactly complementary: equity(a, b) + equity(b, a) is 1.
 */
export function classEquity(a: number, b: number): number {
  return a <= b ? EQUITY[index(a, b)] / 1000 : 1 - EQUITY[index(b, a)] / 1000
}

function index(a: number, b: number): number {
  return (a * (2 * CLASS_COUNT - a + 1)) / 2 + (b - a)
}

let pairCounts: Float64Array | null = null
let classCounts: Float64Array | null = null

/** Ordered pairs of combos, one from each class, that can be dealt at once. */
function counts(): { pairs: Float64Array; single: Float64Array } {
  if (!pairCounts || !classCounts) {
    const pairs = new Float64Array(CLASS_COUNT * CLASS_COUNT)
    const single = new Float64Array(CLASS_COUNT)
    for (let first = 0; first < COMBO_COUNT; first++) {
      single[COMBO_CLASS[first]]++
      const a0 = COMBO_A[first]
      const a1 = COMBO_B[first]
      for (let second = 0; second < COMBO_COUNT; second++) {
        const b0 = COMBO_A[second]
        const b1 = COMBO_B[second]
        if (a0 === b0 || a0 === b1 || a1 === b0 || a1 === b1) continue
        pairs[COMBO_CLASS[first] * CLASS_COUNT + COMBO_CLASS[second]]++
      }
    }
    pairCounts = pairs
    classCounts = single
  }
  return { pairs: pairCounts, single: classCounts }
}

/** How often a class is dealt to one player: 6/1326 for a pair, 4 suited, 12 offsuit. */
export function classProbability(classIndex: number): number {
  return counts().single[classIndex] / COMBO_COUNT
}

/**
 * How often the player across the table holds class `b`, given you hold `a`.
 *
 * This is where card removal lives. Holding aces yourself halves the chance
 * they have them, and holding an ace takes a quarter off every ace they could
 * have had.
 */
export function conditionalProbability(a: number, b: number): number {
  const { pairs } = counts()
  let total = 0
  for (let other = 0; other < CLASS_COUNT; other++) total += pairs[a * CLASS_COUNT + other]
  return total === 0 ? 0 : pairs[a * CLASS_COUNT + b] / total
}

const opposingCache = new Map<number, { classIndex: number; probability: number }[]>()

/**
 * The classes that can be dealt opposite `a`, with their conditional
 * probabilities.
 *
 * Kept, because a solver asks for this at every chance node of every
 * iteration and the answer never changes. Building the list fresh each time
 * allocated a hundred and sixty-nine objects per visit, which was most of the
 * cost of a solve.
 */
export function opposingClasses(a: number): { classIndex: number; probability: number }[] {
  const cached = opposingCache.get(a)
  if (cached) return cached
  const { pairs } = counts()
  const row: { classIndex: number; probability: number }[] = []
  let total = 0
  for (let other = 0; other < CLASS_COUNT; other++) total += pairs[a * CLASS_COUNT + other]
  for (let other = 0; other < CLASS_COUNT; other++) {
    const count = pairs[a * CLASS_COUNT + other]
    if (count > 0) row.push({ classIndex: other, probability: count / total })
  }
  opposingCache.set(a, row)
  return row
}

/** Readable form of a solved range: the classes played, most often first. */
export function describeFrequencies(frequencies: number[], threshold = 0.5): string[] {
  return frequencies
    .map((frequency, classIndex) => ({ frequency, classIndex }))
    .filter((entry) => entry.frequency >= threshold)
    .sort((x, y) => y.frequency - x.frequency)
    .map((entry) => classLabel(entry.classIndex))
}

/** Share of all 1326 hands a per-class frequency table plays, which is how ranges are quoted. */
export function rangeWidth(frequencies: number[]): number {
  let total = 0
  for (let classIndex = 0; classIndex < CLASS_COUNT; classIndex++) {
    total += frequencies[classIndex] * classProbability(classIndex)
  }
  return total
}
