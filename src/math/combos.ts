import { DECK_SIZE, RANK_COUNT, rankOf, suitOf, type CardInt } from '../poker/fast/cards'

/**
 * The 1,326 two-card combinations, and the 169 hand classes they collapse
 * into.
 *
 * Range tracking is combo counting, and combo counting is what makes card
 * removal a real, computable effect rather than a feeling. If an ace is on
 * the board, the opponent holds AK 12 ways instead of 16 and AA 3 ways
 * instead of 6 — that is not a rule of thumb, it is arithmetic, and every
 * blocker argument in poker reduces to it.
 *
 * A combo is identified by an integer 0..1325 rather than a pair of cards, so
 * a range can be a flat array indexed by combo id. Nothing here allocates per
 * lookup.
 */

export const COMBO_COUNT = 1326
export const CLASS_COUNT = 169

/** The two cards of each combo, by combo id. COMBO_A holds the higher card. */
export const COMBO_A = new Int8Array(COMBO_COUNT)
export const COMBO_B = new Int8Array(COMBO_COUNT)

/** combo id for a pair of cards, indexed by `a * 52 + b` (either order). */
const COMBO_ID = new Int16Array(DECK_SIZE * DECK_SIZE).fill(-1)

/** Hand class index (0..168) for each combo. */
export const COMBO_CLASS = new Int16Array(COMBO_COUNT)

const RANK_LETTERS = '23456789TJQKA'

;(function buildCombos() {
  let id = 0
  for (let a = 0; a < DECK_SIZE; a++) {
    for (let b = a + 1; b < DECK_SIZE; b++) {
      COMBO_A[id] = b > a ? b : a
      COMBO_B[id] = b > a ? a : b
      COMBO_ID[a * DECK_SIZE + b] = id
      COMBO_ID[b * DECK_SIZE + a] = id
      COMBO_CLASS[id] = classIndexOf(a, b)
      id++
    }
  }
})()

/**
 * Class index, laid out as the familiar 13x13 grid: pairs on the diagonal,
 * suited above it, offsuit below. Row and column are rank indices with the
 * ace last, so the index is stable and reversible.
 */
function classIndexOf(cardA: CardInt, cardB: CardInt): number {
  const ra = rankOf(cardA)
  const rb = rankOf(cardB)
  const suited = suitOf(cardA) === suitOf(cardB)
  const high = Math.max(ra, rb)
  const low = Math.min(ra, rb)
  if (ra === rb) return high * RANK_COUNT + high
  return suited ? high * RANK_COUNT + low : low * RANK_COUNT + high
}

/** The combo id for two cards. Order does not matter; the two must differ. */
export function comboId(a: CardInt, b: CardInt): number {
  return COMBO_ID[a * DECK_SIZE + b]
}

/** Class index for two cards, without going through a combo id. */
export function classOf(a: CardInt, b: CardInt): number {
  return classIndexOf(a, b)
}

/** "AA", "AKs", "AKo" — the name a player would use for a class index. */
export function classLabel(classIndex: number): string {
  const row = Math.floor(classIndex / RANK_COUNT)
  const col = classIndex % RANK_COUNT
  if (row === col) return RANK_LETTERS[row] + RANK_LETTERS[row]
  const high = Math.max(row, col)
  const low = Math.min(row, col)
  // Above the diagonal (row > col) is suited, below is offsuit.
  return RANK_LETTERS[high] + RANK_LETTERS[low] + (row > col ? 's' : 'o')
}

/** Class index for a label such as "AA", "AKs", "72o". Throws on nonsense. */
export function classFromLabel(label: string): number {
  const text = label.trim()
  const a = RANK_LETTERS.indexOf(text[0]?.toUpperCase() ?? '')
  const b = RANK_LETTERS.indexOf(text[1]?.toUpperCase() ?? '')
  if (a < 0 || b < 0) throw new Error(`Not a hand class: "${label}"`)
  const suffix = text.slice(2).toLowerCase()
  const high = Math.max(a, b)
  const low = Math.min(a, b)
  if (a === b) {
    if (suffix) throw new Error(`A pair cannot be suited or offsuit: "${label}"`)
    return high * RANK_COUNT + high
  }
  if (suffix === 's') return high * RANK_COUNT + low
  if (suffix === 'o') return low * RANK_COUNT + high
  throw new Error(`"${label}" needs an s or o suffix — suited and offsuit are different hands`)
}

/** Every class index, ordered by the grid layout. */
export function allClassIndices(): number[] {
  const seen = new Set<number>()
  for (let id = 0; id < COMBO_COUNT; id++) seen.add(COMBO_CLASS[id])
  return [...seen].sort((x, y) => x - y)
}

/**
 * How many ways a class can be dealt when none of its cards are accounted
 * for: 6 for a pair, 4 suited, 12 offsuit.
 */
export function classComboCount(classIndex: number): number {
  let n = 0
  for (let id = 0; id < COMBO_COUNT; id++) if (COMBO_CLASS[id] === classIndex) n++
  return n
}

/** The combo ids belonging to a class. */
export function classCombos(classIndex: number): number[] {
  const out: number[] = []
  for (let id = 0; id < COMBO_COUNT; id++) if (COMBO_CLASS[id] === classIndex) out.push(id)
  return out
}

/** True when a combo uses none of the given cards — the card-removal test. */
export function comboAvoids(id: number, deadMask: Uint8Array): boolean {
  return deadMask[COMBO_A[id]] === 0 && deadMask[COMBO_B[id]] === 0
}

/** A 52-entry mask marking cards that are already accounted for. */
export function deadCardMask(cards: CardInt[]): Uint8Array {
  const mask = new Uint8Array(DECK_SIZE)
  for (const card of cards) mask[card] = 1
  return mask
}
