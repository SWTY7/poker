import { COMBO_A, COMBO_B, COMBO_COUNT, comboId } from '../../math/combos'
import { DECK_SIZE, type CardInt } from '../../poker/fast/cards'
import { evaluateHand } from '../../poker/fast/eval7'
import { createRng } from '../../utils/random'
import { canonicalBoardKey, canonicalSuitMap, relabel } from './isomorphism'

/**
 * Card abstraction: which hands a solver is allowed to tell apart.
 *
 * There are more hand-and-board combinations in Hold'em than there are
 * atoms worth counting, so no solver plays the real game — it plays a smaller
 * one where similar hands are treated as identical, and hopes the answer
 * transfers. Choosing what counts as similar is the whole art, and unlike
 * everything else in this directory it has no oracle: there is no published
 * number to check a bucketing against.
 *
 * So this one is built to be explainable rather than clever.
 *
 *   A hand's strength is its *percentile among every hand that could be held
 *   on this board*. Not its category, not its equity against a particular
 *   range — where it sits in the field. Top pair is strong on one flop and
 *   thin on another, and a percentile says so while a category does not.
 *
 *   It is measured on the river, over sampled run-outs, and averaged. That is
 *   what keeps draws from being read as air: a flush draw is nothing on the
 *   flop and the nuts on the third of run-outs that complete it. Bucketing on
 *   current strength alone — the cheap thing to do — produces a solver that
 *   never has a draw and therefore never semi-bluffs.
 *
 *   What is averaged is the *square* of the final percentile, not the
 *   percentile. Averaging the percentile itself is the textbook E[HS], and
 *   its known failure is exactly the case this abstraction exists to handle:
 *   a hand that is the nuts a third of the time and nothing the rest averages
 *   the same as a hand that is mediocre always, so the solver cannot tell a
 *   draw from a weak pair and plays both as a weak pair. Squaring rewards the
 *   spread, which is E[HS^2], and it is what separates ace-king with the nut
 *   flush draw from ace-king without it.
 *
 *   Buckets are equal-frequency within the board, so every bucket is the same
 *   size and the abstraction spends its resolution where the hands are.
 *
 * Everything here is a function of the *canonical* board, because suits mean
 * nothing on their own. That is what makes the cache work: 1,755 flops rather
 * than 22,100, and 16,432 turns rather than 270,725.
 */

export const DEFAULT_BUCKETS = 8
/** Dead hands — ones the board is holding — get this instead of a bucket. */
export const NO_BUCKET = 255

/** Room for a combo id alongside a hand score in one double. */
const ID_SPACE = 2048

/** How many run-outs to average over, by how many cards the board already has. */
const RUNOUT_SAMPLES: Record<number, number> = { 3: 20, 4: 10, 5: 1 }

interface Profile {
  /** Bucket per combo id, in canonical suit space. */
  buckets: Uint8Array
  /** Mean final percentile — the textbook E[HS], for inspection. */
  mean: Float64Array
  /** Mean squared final percentile — E[HS^2], what the buckets are cut on. */
  potential: Float64Array
}

/**
 * Only the buckets are kept. The two strength arrays are eight bytes a hand
 * against the bucket's one, and there are 16,432 turns worth caching — the
 * difference between twenty megabytes and a gigabyte.
 */
const cache = new Map<string, Uint8Array>()

/**
 * Bucket for one hand on one board, 0 the weakest.
 *
 * The hand is relabelled into the board's canonical suit space before the
 * lookup, which is what lets one computed board answer for the twelve or
 * twenty-four that play identically.
 */
export function bucketOf(hole: readonly [CardInt, CardInt], board: CardInt[], buckets = DEFAULT_BUCKETS): number {
  const map = canonicalSuitMap(board)
  return bucketsFor(board, buckets, map)[comboId(relabel(hole[0], map), relabel(hole[1], map))]
}

/**
 * The two strength numbers behind a hand's bucket: E[HS] and E[HS^2].
 *
 * Recomputed rather than cached, because this is the inspection path — tests
 * and chart printing — and caching it would cost fifty times what caching the
 * bucket does.
 */
export function strengthOf(
  hole: readonly [CardInt, CardInt],
  board: CardInt[],
  buckets = DEFAULT_BUCKETS,
): { mean: number; potential: number } {
  const map = canonicalSuitMap(board)
  const canonical = board.map((card) => relabel(card, map)).sort((a, b) => a - b)
  const profile = build(canonical, buckets, `${buckets}:${canonicalBoardKey(board)}`)
  const id = comboId(relabel(hole[0], map), relabel(hole[1], map))
  return { mean: profile.mean[id], potential: profile.potential[id] }
}

/** Clears the cache. Only tests want this; a training run wants the opposite. */
export function clearBucketCache(): void {
  cache.clear()
}

export function bucketCacheSize(): number {
  return cache.size
}

function bucketsFor(board: CardInt[], buckets: number, map: number[]): Uint8Array {
  const key = `${buckets}:${canonicalBoardKey(board)}`
  let cached = cache.get(key)
  if (!cached) {
    const canonical = board.map((card) => relabel(card, map)).sort((a, b) => a - b)
    cached = build(canonical, buckets, key).buckets
    cache.set(key, cached)
  }
  return cached
}

function build(board: CardInt[], buckets: number, key: string): Profile {
  const dead = new Uint8Array(DECK_SIZE)
  for (const card of board) dead[card] = 1

  const live: number[] = []
  for (let id = 0; id < COMBO_COUNT; id++) {
    if (!dead[COMBO_A[id]] && !dead[COMBO_B[id]]) live.push(id)
  }

  const mean = new Float64Array(COMBO_COUNT)
  const potential = new Float64Array(COMBO_COUNT)
  const bucketOfCombo = new Uint8Array(COMBO_COUNT).fill(NO_BUCKET)

  const remaining: CardInt[] = []
  for (let card = 0; card < DECK_SIZE; card++) if (!dead[card]) remaining.push(card)

  const need = 5 - board.length
  const samples = RUNOUT_SAMPLES[board.length] ?? 1
  // Seeded from the board itself, so a hand's bucket is a function of the
  // cards and nothing else. An abstraction that answered differently on two
  // visits would not be an abstraction.
  const rng = createRng(hash(key))

  const hand = [0, 0, ...board, 0, 0, 0, 0, 0].slice(0, 7)
  const slot = 2 + board.length
  const pool = [...remaining]
  const drawn = new Uint8Array(DECK_SIZE)
  // Score and combo id packed into one number, so ranking is a plain numeric
  // sort with no comparator. A hand score is under 2^24 and a combo id under
  // 2^11, so the product is exact in a double — and a typed array sorting
  // itself is several times faster than sorting ids through a closure, which
  // was most of the cost of a board and therefore most of the cost of
  // training.
  const packed = new Float64Array(live.length)

  for (let sample = 0; sample < samples; sample++) {
    // A run-out, drawn without replacement from what is left.
    drawn.fill(0)
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (pool.length - i))
      const swap = pool[i]
      pool[i] = pool[j]
      pool[j] = swap
      hand[slot + i] = pool[i]
      drawn[pool[i]] = 1
    }

    let count = 0
    for (const id of live) {
      const a = COMBO_A[id]
      const b = COMBO_B[id]
      // A hand using a run-out card is not a hand anyone can hold on this
      // board; skip it rather than score a hand that is partly the board.
      if (drawn[a] || drawn[b]) continue
      hand[0] = a
      hand[1] = b
      packed[count++] = evaluateHand(hand) * ID_SPACE + id
    }

    const slice = packed.subarray(0, count)
    slice.sort()

    // Percentile within this run-out, ties sharing the midpoint of the block
    // they span so a board that plays gives every hand the same number.
    let i = 0
    while (i < count) {
      const score = Math.floor(slice[i] / ID_SPACE)
      let j = i
      while (j + 1 < count && Math.floor(slice[j + 1] / ID_SPACE) === score) j++
      const percentile = count === 1 ? 0.5 : (i + j) / 2 / (count - 1)
      for (let k = i; k <= j; k++) {
        const id = slice[k] % ID_SPACE
        mean[id] += percentile
        potential[id] += percentile * percentile
      }
      i = j + 1
    }
  }

  for (const id of live) {
    mean[id] /= samples
    potential[id] /= samples
  }

  // Equal-frequency buckets: sort the live hands and cut into equal parts, so
  // no bucket is empty and none holds half the field.
  const ranked = [...live].sort((x, y) => potential[x] - potential[y])
  for (let position = 0; position < ranked.length; position++) {
    const bucket = Math.min(buckets - 1, Math.floor((position * buckets) / ranked.length))
    bucketOfCombo[ranked[position]] = bucket
  }

  return { buckets: bucketOfCombo, mean, potential }
}

function hash(key: string): number {
  let value = 2166136261
  for (let i = 0; i < key.length; i++) {
    value ^= key.charCodeAt(i)
    value = Math.imul(value, 16777619)
  }
  return value >>> 0
}
