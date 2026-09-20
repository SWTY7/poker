import { RANK_COUNT, SUIT_COUNT, rankOf, suitOf, type CardInt } from '../../poker/fast/cards'

/**
 * Suits have no meaning of their own, only relationships.
 *
 * A flop of two hearts and a spade plays exactly like two clubs and a
 * diamond. Nothing in poker distinguishes them, so a solver that treats them
 * as different boards is solving the same problem over and over — there are
 * 22,100 flops and only 1,755 of them are actually different.
 *
 * Canonicalising is what makes a cache worth having. Every expensive thing
 * about a board — the strength of every hand on it, which bucket each hand
 * falls in — is a property of the canonical form, so computing it once covers
 * the twelve or twenty-four boards that share it.
 *
 * The canonical form is produced by relabelling suits: rank the suits by what
 * they hold on this board, most and highest first, and rename them in that
 * order. Two boards are the same hand of poker exactly when they relabel to
 * the same thing.
 */

/** The permutation that puts a board in canonical form: `map[suit]` is its new name. */
export function canonicalSuitMap(board: CardInt[]): number[] {
  // What each suit holds on this board, as a rank bitmask. Ordering by the
  // mask alone does both jobs at once: a suit with more cards has more bits,
  // and between two suits with the same count the higher ranks win.
  const masks = new Array<number>(SUIT_COUNT).fill(0)
  for (const card of board) masks[suitOf(card)] |= 1 << rankOf(card)

  const order = [0, 1, 2, 3].sort((a, b) => {
    const countA = popcount(masks[a])
    const countB = popcount(masks[b])
    if (countA !== countB) return countB - countA
    if (masks[a] !== masks[b]) return masks[b] - masks[a]
    // Two suits with identical holdings are interchangeable; keeping their
    // original order makes the result deterministic.
    return a - b
  })

  const map = new Array<number>(SUIT_COUNT)
  for (let position = 0; position < SUIT_COUNT; position++) map[order[position]] = position
  return map
}

/** Applies a suit relabelling to one card. */
export function relabel(card: CardInt, map: number[]): CardInt {
  return rankOf(card) * SUIT_COUNT + map[suitOf(card)]
}

/**
 * The board, with suits renamed and cards sorted — the same string for every
 * board that is the same hand of poker.
 */
export function canonicalBoardKey(board: CardInt[]): string {
  const map = canonicalSuitMap(board)
  const relabelled = board.map((card) => relabel(card, map)).sort((a, b) => a - b)
  let key = ''
  for (const card of relabelled) key += String.fromCharCode(65 + card)
  return key
}

/** Every distinct board of `size` cards, one representative per isomorphism class. */
export function canonicalBoards(size: number): CardInt[][] {
  const seen = new Set<string>()
  const boards: CardInt[][] = []
  const deck = RANK_COUNT * SUIT_COUNT
  const current: CardInt[] = []

  const recurse = (start: number) => {
    if (current.length === size) {
      const key = canonicalBoardKey(current)
      if (!seen.has(key)) {
        seen.add(key)
        boards.push([...current])
      }
      return
    }
    for (let card = start; card < deck; card++) {
      current.push(card)
      recurse(card + 1)
      current.pop()
    }
  }

  recurse(0)
  return boards
}

function popcount(mask: number): number {
  let count = 0
  while (mask) {
    mask &= mask - 1
    count++
  }
  return count
}
