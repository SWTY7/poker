import { DECK_SIZE, type CardInt } from '../poker/fast/cards'
import { evaluateHand } from '../poker/fast/eval7'
import { COMBO_A, COMBO_B, COMBO_COUNT } from './combos'
import type { Range } from './range'
import { createRng, type Rng } from '../utils/random'

export interface EquityResult {
  /** Share of the pot this hand or range wins on average, 0..1. Ties split. */
  equity: number
  win: number
  tie: number
  lose: number
  /** Board completions actually evaluated. */
  samples: number
  /** True when every possible board was enumerated rather than sampled. */
  exact: boolean
}

export interface EquityOptions {
  /**
   * Maximum board completions to enumerate exactly before falling back to
   * sampling. Exact is always preferred where it is affordable: it removes a
   * source of noise from everything built on top, and on the flop it costs
   * about a millisecond.
   */
  exactLimit?: number
  /** Samples to draw when enumeration is too expensive. */
  samples?: number
  rng?: Rng
}

const DEFAULTS = { exactLimit: 2000, samples: 20000 }

/**
 * Equity of one specific hand against another, on a given board.
 *
 * With the flop out there are at most 1,081 ways the rest can come, so this
 * enumerates them and the answer is exact. Preflop there are 1,712,304, which
 * is enumerable in about a second — affordable for an anchor you want to be
 * certain of, not for a decision — so it samples unless told otherwise.
 */
export function handVsHand(
  hero: readonly [CardInt, CardInt],
  villain: readonly [CardInt, CardInt],
  board: CardInt[] = [],
  options: EquityOptions = {},
): EquityResult {
  const dead = [...hero, ...villain, ...board]
  const deck = remainingDeck(dead)
  const need = 5 - board.length

  const heroHand = [hero[0], hero[1], ...board, 0, 0, 0, 0, 0].slice(0, 2 + 5)
  const villainHand = [villain[0], villain[1], ...board, 0, 0, 0, 0, 0].slice(0, 2 + 5)
  const slot = 2 + board.length

  let win = 0
  let tie = 0
  let lose = 0
  let samples = 0

  const tally = (draw: CardInt[]) => {
    for (let i = 0; i < need; i++) {
      heroHand[slot + i] = draw[i]
      villainHand[slot + i] = draw[i]
    }
    const h = evaluateHand(heroHand)
    const v = evaluateHand(villainHand)
    if (h > v) win++
    else if (h < v) lose++
    else tie++
    samples++
  }

  const total = countCombinations(deck.length, need)
  const { exactLimit, samples: sampleCount, rng } = { ...DEFAULTS, ...options }

  if (total <= exactLimit) {
    forEachCombination(deck, need, tally)
    return finish(win, tie, lose, samples, true)
  }

  const draw = new Array<CardInt>(need)
  const random = rng ?? createRng()
  for (let s = 0; s < sampleCount; s++) {
    drawWithoutReplacement(deck, need, draw, random)
    tally(draw)
  }
  return finish(win, tie, lose, samples, false)
}

/**
 * Equity of one hand against a whole range. Combos the hero blocks are
 * excluded automatically — a range is only ever the hands the opponent can
 * still actually hold.
 */
export function handVsRange(
  hero: readonly [CardInt, CardInt],
  villainRange: Range,
  board: CardInt[] = [],
  options: EquityOptions = {},
): EquityResult {
  const blocked = new Uint8Array(DECK_SIZE)
  for (const card of [...hero, ...board]) blocked[card] = 1

  let weightedEquity = 0
  let weightedWin = 0
  let weightedTie = 0
  let weightedLose = 0
  let totalWeight = 0
  let samples = 0
  let exact = true

  for (let id = 0; id < COMBO_COUNT; id++) {
    const weight = villainRange[id]
    if (weight <= 0) continue
    const a = COMBO_A[id]
    const b = COMBO_B[id]
    if (blocked[a] || blocked[b]) continue

    const result = handVsHand(hero, [a, b], board, options)
    weightedEquity += weight * result.equity
    weightedWin += weight * (result.win / result.samples)
    weightedTie += weight * (result.tie / result.samples)
    weightedLose += weight * (result.lose / result.samples)
    totalWeight += weight
    samples += result.samples
    exact = exact && result.exact
  }

  if (totalWeight === 0) {
    return { equity: 0, win: 0, tie: 0, lose: 0, samples: 0, exact: true }
  }

  return {
    equity: weightedEquity / totalWeight,
    win: weightedWin / totalWeight,
    tie: weightedTie / totalWeight,
    lose: weightedLose / totalWeight,
    samples,
    exact,
  }
}

/**
 * Equity of one range against another. Both sides' blockers apply: a hand the
 * hero holds is a hand the villain cannot, and vice versa, which is precisely
 * the effect naive range-vs-range maths gets wrong.
 */
export function rangeVsRange(
  heroRange: Range,
  villainRange: Range,
  board: CardInt[] = [],
  options: EquityOptions = {},
): EquityResult {
  const boardMask = new Uint8Array(DECK_SIZE)
  for (const card of board) boardMask[card] = 1

  let weighted = 0
  let totalWeight = 0
  let samples = 0
  let exact = true

  for (let heroId = 0; heroId < COMBO_COUNT; heroId++) {
    const heroWeight = heroRange[heroId]
    if (heroWeight <= 0) continue
    const ha = COMBO_A[heroId]
    const hb = COMBO_B[heroId]
    if (boardMask[ha] || boardMask[hb]) continue

    const result = handVsRange([ha, hb], villainRange, board, options)
    if (result.samples === 0) continue
    weighted += heroWeight * result.equity
    totalWeight += heroWeight
    samples += result.samples
    exact = exact && result.exact
  }

  if (totalWeight === 0) return { equity: 0, win: 0, tie: 0, lose: 0, samples: 0, exact: true }
  return { equity: weighted / totalWeight, win: 0, tie: 0, lose: 0, samples, exact }
}

// --- internals ---------------------------------------------------------------

function finish(win: number, tie: number, lose: number, samples: number, exact: boolean): EquityResult {
  // A split pot is half a win, which is what makes this "equity" rather than
  // a win rate — the number that belongs in a pot-odds comparison.
  const equity = samples === 0 ? 0 : (win + tie / 2) / samples
  return { equity, win, tie, lose, samples, exact }
}

function remainingDeck(dead: CardInt[]): CardInt[] {
  const seen = new Uint8Array(DECK_SIZE)
  for (const card of dead) seen[card] = 1
  const deck: CardInt[] = []
  for (let card = 0; card < DECK_SIZE; card++) if (!seen[card]) deck.push(card)
  return deck
}

function countCombinations(n: number, k: number): number {
  if (k <= 0) return 1
  let result = 1
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1)
  return Math.round(result)
}

function forEachCombination(deck: CardInt[], k: number, visit: (draw: CardInt[]) => void): void {
  if (k === 0) {
    visit([])
    return
  }
  const draw = new Array<CardInt>(k)
  const recurse = (start: number, depth: number) => {
    if (depth === k) {
      visit(draw)
      return
    }
    for (let i = start; i <= deck.length - (k - depth); i++) {
      draw[depth] = deck[i]
      recurse(i + 1, depth + 1)
    }
  }
  recurse(0, 0)
}

/**
 * Picks k distinct cards by partial Fisher-Yates on a scratch copy — sampling
 * with rejection would bias nothing but wastes draws as the deck shrinks.
 */
const SCRATCH: CardInt[] = []
function drawWithoutReplacement(deck: CardInt[], k: number, out: CardInt[], rng: Rng): void {
  SCRATCH.length = deck.length
  for (let i = 0; i < deck.length; i++) SCRATCH[i] = deck[i]
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(rng() * (SCRATCH.length - i))
    const tmp = SCRATCH[i]
    SCRATCH[i] = SCRATCH[j]
    SCRATCH[j] = tmp
    out[i] = SCRATCH[i]
  }
}
