import type { CardInt } from './cards'
import type { HandCategory } from '../hand-evaluator'

/**
 * A hand evaluator built for inner loops.
 *
 * `evaluateBestHand` in ../hand-evaluator.ts is the readable one: it takes
 * `Card` objects, enumerates all 21 five-card subsets of a seven-card hand
 * through a generator, and returns a structured `HandValue`. That costs about
 * 63 microseconds per hand — fine for a showdown, which happens once, and
 * hopeless for anything that needs millions of evaluations. Equity against a
 * range, CFR, and self-play all do.
 *
 * This one takes integer cards and returns a single integer score. Bigger is
 * better, and comparison is `<`. There is no allocation on the hot path, no
 * subset enumeration, and no string handling.
 *
 * ## The score
 *
 * Twenty-four bits, laid out so that plain numeric comparison reproduces
 * poker's ordering exactly:
 *
 *     bits 20-23   category   0 = high card ... 8 = straight flush
 *     bits 16-19   tiebreak 1  \
 *     bits 12-15   tiebreak 2   |  rank values 2..14, most significant first,
 *     bits  8-11   tiebreak 3   |  zero-padded when a category needs fewer
 *     bits  4-7    tiebreak 4   |
 *     bits  0-3    tiebreak 5  /
 *
 * A rank value fits in four bits (2..14), and the category in four more, so a
 * score is always a small positive integer well inside the 32-bit range V8
 * keeps unboxed.
 *
 * ## How it avoids enumerating subsets
 *
 * The best five-card hand out of seven never needs searching for. A flush is
 * decided by the suit counts; a straight by the set of ranks present; and
 * everything else by how the ranks group. Each is a direct computation over
 * two small summaries of the hand — a 13-bit mask of which ranks appear, and
 * a count per rank — both built in one pass over the seven cards.
 */

/** Category ranks, matching CATEGORY_RANK in ../hand-evaluator.ts. */
export const HIGH_CARD = 0
export const PAIR = 1
export const TWO_PAIR = 2
export const TRIPS = 3
export const STRAIGHT = 4
export const FLUSH = 5
export const FULL_HOUSE = 6
export const QUADS = 7
export const STRAIGHT_FLUSH = 8

const CATEGORY_NAMES: HandCategory[] = [
  'high-card',
  'pair',
  'two-pair',
  'trips',
  'straight',
  'flush',
  'full-house',
  'quads',
  'straight-flush',
]

/**
 * For every possible 13-bit set of ranks, the rank value of the highest
 * straight it contains, or 0 for none. Index bit 0 is a deuce, bit 12 an ace.
 *
 * The wheel (A-2-3-4-5) is the one straight whose ace plays low, so it is
 * checked separately and reported as five-high — which is exactly how it must
 * compare against other straights.
 */
const STRAIGHT_HIGH = new Int8Array(1 << 13)

/**
 * For every possible 13-bit set of ranks, the top five ranks packed into the
 * low twenty bits, four bits each, highest first. Used for flushes and for
 * high-card hands, where all five cards are kickers.
 */
const TOP5 = new Int32Array(1 << 13)

;(function buildTables() {
  // Five consecutive ranks, from 6-high (bits 0-4) up to ace-high (bits 8-12).
  const RUNS: { mask: number; high: number }[] = []
  for (let low = 0; low <= 8; low++) RUNS.push({ mask: 0b11111 << low, high: low + 6 })
  // A-2-3-4-5: the ace bit plus the four lowest.
  const WHEEL = (1 << 12) | 0b1111

  for (let mask = 0; mask < 1 << 13; mask++) {
    let high = 0
    for (let i = RUNS.length - 1; i >= 0; i--) {
      if ((mask & RUNS[i].mask) === RUNS[i].mask) {
        high = RUNS[i].high
        break
      }
    }
    if (high === 0 && (mask & WHEEL) === WHEEL) high = 5
    STRAIGHT_HIGH[mask] = high

    let packed = 0
    let taken = 0
    for (let r = 12; r >= 0 && taken < 5; r--) {
      if (mask & (1 << r)) {
        packed = (packed << 4) | (r + 2)
        taken++
      }
    }
    // Left-align to five nibbles so a four-card mask doesn't outrank a
    // five-card one purely by being shifted further right.
    TOP5[mask] = packed << ((5 - taken) * 4)
  }
})()

/**
 * Scores a hand of five to seven integer cards. Larger is better; two hands
 * that tie in poker produce the same number.
 */
export function evaluateHand(cards: CardInt[]): number {
  const n = cards.length

  // One pass, two summaries: how many of each rank, and which ranks appear in
  // each suit.
  let rankMask = 0
  const rankCount = COUNT_SCRATCH
  rankCount.fill(0)
  let s0 = 0
  let s1 = 0
  let s2 = 0
  let s3 = 0

  for (let i = 0; i < n; i++) {
    const card = cards[i]
    const r = card >> 2
    rankMask |= 1 << r
    rankCount[r]++
    switch (card & 3) {
      case 0:
        s0 |= 1 << r
        break
      case 1:
        s1 |= 1 << r
        break
      case 2:
        s2 |= 1 << r
        break
      default:
        s3 |= 1 << r
    }
  }

  // --- flushes ---------------------------------------------------------------
  // At most one suit can hold five of seven cards, so this is a straight
  // choice rather than a search.
  let flushMask = 0
  if (popcount13(s0) >= 5) flushMask = s0
  else if (popcount13(s1) >= 5) flushMask = s1
  else if (popcount13(s2) >= 5) flushMask = s2
  else if (popcount13(s3) >= 5) flushMask = s3

  if (flushMask !== 0) {
    // A straight flush is a straight *within the flush suit*, which is why
    // this looks at the suit's own mask rather than the hand's.
    const sfHigh = STRAIGHT_HIGH[flushMask]
    if (sfHigh !== 0) return (STRAIGHT_FLUSH << 20) | (sfHigh << 16)
    return (FLUSH << 20) | TOP5[flushMask]
  }

  // --- straights -------------------------------------------------------------
  const straightHigh = STRAIGHT_HIGH[rankMask]
  if (straightHigh !== 0) return (STRAIGHT << 20) | (straightHigh << 16)

  // --- everything decided by how the ranks group -----------------------------
  // Walk high to low once, noting the best trips/pairs and collecting kickers.
  let quad = 0
  let trip = 0
  let pair1 = 0
  let pair2 = 0
  for (let r = 12; r >= 0; r--) {
    const c = rankCount[r]
    if (c === 0) continue
    const value = r + 2
    if (c === 4) {
      if (quad === 0) quad = value
    } else if (c === 3) {
      if (trip === 0) trip = value
      else if (pair1 === 0) pair1 = value // a second trip plays as a pair
    } else if (c === 2) {
      if (pair1 === 0) pair1 = value
      else if (pair2 === 0) pair2 = value
    }
  }

  if (quad !== 0) {
    const kicker = highestExcluding(rankMask, quad)
    return (QUADS << 20) | (quad << 16) | (kicker << 12)
  }

  if (trip !== 0 && pair1 !== 0) {
    return (FULL_HOUSE << 20) | (trip << 16) | (pair1 << 12)
  }

  if (trip !== 0) {
    const k1 = highestExcluding(rankMask, trip)
    const k2 = highestExcluding(rankMask, trip, k1)
    return (TRIPS << 20) | (trip << 16) | (k1 << 12) | (k2 << 8)
  }

  if (pair2 !== 0) {
    const kicker = highestExcluding(rankMask, pair1, pair2)
    return (TWO_PAIR << 20) | (pair1 << 16) | (pair2 << 12) | (kicker << 8)
  }

  if (pair1 !== 0) {
    const k1 = highestExcluding(rankMask, pair1)
    const k2 = highestExcluding(rankMask, pair1, k1)
    const k3 = highestExcluding(rankMask, pair1, k1, k2)
    return (PAIR << 20) | (pair1 << 16) | (k1 << 12) | (k2 << 8) | (k3 << 4)
  }

  return (HIGH_CARD << 20) | TOP5[rankMask]
}

/**
 * Seven cards by argument rather than array — the shape the hot loops want,
 * since it lets a caller avoid building an array per evaluation.
 */
export function evaluate7(
  a: CardInt,
  b: CardInt,
  c: CardInt,
  d: CardInt,
  e: CardInt,
  f: CardInt,
  g: CardInt,
): number {
  SEVEN_SCRATCH[0] = a
  SEVEN_SCRATCH[1] = b
  SEVEN_SCRATCH[2] = c
  SEVEN_SCRATCH[3] = d
  SEVEN_SCRATCH[4] = e
  SEVEN_SCRATCH[5] = f
  SEVEN_SCRATCH[6] = g
  return evaluateHand(SEVEN_SCRATCH)
}

/** The hand category a score belongs to, as the name the rest of the app uses. */
export function categoryOfScore(score: number): HandCategory {
  return CATEGORY_NAMES[score >>> 20]
}

/** The category's numeric rank, 0..8, matching CATEGORY_RANK. */
export function categoryRankOfScore(score: number): number {
  return score >>> 20
}

// --- internals ---------------------------------------------------------------

/**
 * Reused across calls so a hand costs no allocation. Safe because evaluation
 * is synchronous and single-threaded: nothing can observe these between the
 * write and the read.
 */
const COUNT_SCRATCH = new Int8Array(13)
const SEVEN_SCRATCH: CardInt[] = [0, 0, 0, 0, 0, 0, 0]

function popcount13(mask: number): number {
  let m = mask - ((mask >> 1) & 0x1555)
  m = (m & 0x1333) + ((m >> 2) & 0x1333)
  m = (m + (m >> 4)) & 0x0f0f
  return (m + (m >> 8)) & 0x1f
}

/** Highest rank value in the mask that isn't one of the excluded values. */
function highestExcluding(rankMask: number, x: number, y = 0, z = 0): number {
  for (let r = 12; r >= 0; r--) {
    if ((rankMask & (1 << r)) === 0) continue
    const value = r + 2
    if (value === x || value === y || value === z) continue
    return value
  }
  return 0
}
