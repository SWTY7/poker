import { RANK_COUNT, type CardInt } from '../poker/fast/cards'
import {
  COMBO_A,
  COMBO_B,
  COMBO_CLASS,
  COMBO_COUNT,
  classFromLabel,
  classLabel,
  deadCardMask,
} from './combos'

/**
 * A range is a weight per combo — 0 for "never has this", 1 for "always", and
 * anything between for a hand played some of the time. Mixed frequencies are
 * not an afterthought: equilibrium strategies are mixed by necessity, so a
 * range type that can only say yes or no would have to be replaced the moment
 * the GTO layer arrives.
 *
 * Indexed by combo id, so intersecting a range with the cards already visible
 * is a single pass and card removal is not a special case.
 */
export type Range = Float64Array

export function emptyRange(): Range {
  return new Float64Array(COMBO_COUNT)
}

/** Every combo, weight 1 — "any two cards". */
export function fullRange(): Range {
  return new Float64Array(COMBO_COUNT).fill(1)
}

export function cloneRange(range: Range): Range {
  return range.slice()
}

/** Total combos in the range, counting partial weights as fractions. */
export function rangeWeight(range: Range): number {
  let total = 0
  for (let id = 0; id < COMBO_COUNT; id++) total += range[id]
  return total
}

/**
 * Zeroes every combo that uses a card we can already see.
 *
 * This is card removal, and it is why a range must be stored by combo rather
 * than by class: with an ace on the board the opponent's AK is 12 combos, not
 * 16, and no amount of bookkeeping at the class level can express that
 * without knowing which ace.
 */
export function removeBlockers(range: Range, dead: CardInt[]): Range {
  const mask = deadCardMask(dead)
  const out = range.slice()
  for (let id = 0; id < COMBO_COUNT; id++) {
    if (mask[COMBO_A[id]] || mask[COMBO_B[id]]) out[id] = 0
  }
  return out
}

/** The combos with non-zero weight, as ids. */
export function liveCombos(range: Range): number[] {
  const out: number[] = []
  for (let id = 0; id < COMBO_COUNT; id++) if (range[id] > 0) out.push(id)
  return out
}

/** Combined weight of one hand class within a range. */
export function classWeight(range: Range, label: string): number {
  const target = classFromLabel(label)
  let total = 0
  for (let id = 0; id < COMBO_COUNT; id++) if (COMBO_CLASS[id] === target) total += range[id]
  return total
}

/** Sets every combo of a class to a weight. */
export function setClass(range: Range, classIndex: number, weight: number): Range {
  for (let id = 0; id < COMBO_COUNT; id++) if (COMBO_CLASS[id] === classIndex) range[id] = weight
  return range
}

/** The class labels present in a range, in grid order. */
export function rangeClasses(range: Range): string[] {
  const present = new Set<number>()
  for (let id = 0; id < COMBO_COUNT; id++) if (range[id] > 0) present.add(COMBO_CLASS[id])
  return [...present].sort((a, b) => a - b).map(classLabel)
}

/**
 * Parses the notation players actually write: a comma-separated list of hand
 * classes, with `+` meaning "and everything stronger of this shape" and `-`
 * spanning two endpoints. A trailing `:w` sets a weight, so a range can say a
 * hand is played some of the time.
 *
 *     parseRange('88+, AQs+, KQo, A5s-A2s, 76s:0.5')
 *
 * What `+` means depends on the shape, and matching the convention matters
 * more than any internal consistency:
 *   - `88+`   pairs from eights up   (88, 99, ..., AA)
 *   - `AQs+`  same high card, kicker climbing (AQs, AKs)
 *   - `T9o+`  connectors of the same gap climbing (T9o, JTo, QJo, KQo, AKo)
 */
export function parseRange(spec: string): Range {
  const range = emptyRange()
  for (const rawTerm of spec.split(',')) {
    const term = rawTerm.trim()
    if (!term) continue

    const [body, weightText] = term.split(':')
    const weight = weightText === undefined ? 1 : Number(weightText)
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) {
      throw new Error(`Weight must be between 0 and 1: "${term}"`)
    }

    for (const classIndex of expandTerm(body.trim())) {
      setClass(range, classIndex, weight)
    }
  }
  return range
}

function expandTerm(term: string): number[] {
  if (term.includes('-')) {
    const [fromText, toText] = term.split('-').map((s) => s.trim())
    return expandSpan(fromText, toText)
  }
  if (term.endsWith('+')) return expandPlus(term.slice(0, -1).trim())
  return [classFromLabel(term)]
}

const RANK_LETTERS = '23456789TJQKA'
const rankIndex = (letter: string) => RANK_LETTERS.indexOf(letter.toUpperCase())

function expandPlus(label: string): number[] {
  const high = rankIndex(label[0])
  const low = rankIndex(label[1])
  if (high < 0 || low < 0) throw new Error(`Not a hand class: "${label}+"`)
  const suffix = label.slice(2)

  // A pair: climb the pairs.
  if (high === low) {
    const out: number[] = []
    for (let r = Math.min(high, low); r < RANK_COUNT; r++) out.push(classFromLabel(RANK_LETTERS[r] + RANK_LETTERS[r]))
    return out
  }

  const top = Math.max(high, low)
  const bottom = Math.min(high, low)

  // Shared high card (AQs+): raise the kicker up to just under the high card.
  const out: number[] = []
  for (let kicker = bottom; kicker < top; kicker++) {
    out.push(classFromLabel(RANK_LETTERS[top] + RANK_LETTERS[kicker] + suffix))
  }
  return out
}

function expandSpan(fromLabel: string, toLabel: string): number[] {
  const a = classFromLabel(fromLabel)
  const b = classFromLabel(toLabel)
  const aHigh = rankIndex(fromLabel[0])
  const aLow = rankIndex(fromLabel[1])
  const bHigh = rankIndex(toLabel[0])
  const bLow = rankIndex(toLabel[1])
  const suffix = fromLabel.slice(2)

  if (fromLabel.slice(2) !== toLabel.slice(2)) {
    throw new Error(`Both ends of a span must be the same shape: "${fromLabel}-${toLabel}"`)
  }

  // Pairs: 88-55 walks the diagonal.
  if (aHigh === aLow && bHigh === bLow) {
    const lo = Math.min(aHigh, bHigh)
    const hi = Math.max(aHigh, bHigh)
    const out: number[] = []
    for (let r = lo; r <= hi; r++) out.push(classFromLabel(RANK_LETTERS[r] + RANK_LETTERS[r]))
    return out
  }

  // Shared high card: A5s-A2s walks the kicker.
  if (aHigh === bHigh) {
    const lo = Math.min(aLow, bLow)
    const hi = Math.max(aLow, bLow)
    const out: number[] = []
    for (let k = lo; k <= hi; k++) out.push(classFromLabel(RANK_LETTERS[aHigh] + RANK_LETTERS[k] + suffix))
    return out
  }

  // Anything else is ambiguous, and guessing at it would be worse than saying so.
  void a
  void b
  throw new Error(`Cannot read "${fromLabel}-${toLabel}" — spans need a shared pair or high card`)
}
