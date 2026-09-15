import type { Card } from './card'
import type { HandCategory } from './hand-evaluator'
import { evaluateHand, categoryOfScore } from './fast/eval7'
import { toCardInts, DECK_SIZE, type CardInt } from './fast/cards'

export interface HandOdds {
  /**
   * Probability (0..1) the hero's final best hand lands in each category,
   * given only their own hole cards and the board so far. Opponents' hands
   * are not considered at all — this is "what could my hand become",
   * not "how likely am I to win the pot".
   */
  byCategory: Partial<Record<HandCategory, number>>
  /** How many board completions this was computed over. */
  sampleSize: number
}

/**
 * Exhaustively enumerates every way the remaining board cards could come out
 * and tallies which hand category the hero ends up with. Exact, not a
 * simulation — at most 47 choose 2 = 1,081 completions once the flop is out.
 * Preflop's 50 choose 5 ≈ 2.1M is deliberately left uncomputed.
 *
 * This runs on the integer evaluator in ./fast, which matters here more than
 * anywhere else in the app: on the object evaluator those 1,081 completions
 * cost about 65ms, which is a visible hitch on the thread that also draws the
 * table. The same enumeration is now well under a millisecond.
 */
export function estimateHandOdds(holeCards: Card[], communityCards: Card[]): HandOdds | null {
  const need = 5 - communityCards.length
  if (need > 2) return null

  const known = toCardInts([...holeCards, ...communityCards])

  if (need <= 0) {
    return { byCategory: { [categoryOfScore(evaluateHand(known))]: 1 }, sampleSize: 1 }
  }

  const unseen = unseenInts(known)
  const counts: Partial<Record<HandCategory, number>> = {}
  let total = 0

  // The hand under construction is reused across every completion: only the
  // last one or two slots change, so there is no reason to rebuild it.
  const hand: CardInt[] = [...known, 0, 0].slice(0, known.length + need)
  const slot = known.length

  if (need === 1) {
    for (let i = 0; i < unseen.length; i++) {
      hand[slot] = unseen[i]
      const category = categoryOfScore(evaluateHand(hand))
      counts[category] = (counts[category] ?? 0) + 1
      total++
    }
  } else {
    for (let i = 0; i < unseen.length - 1; i++) {
      hand[slot] = unseen[i]
      for (let j = i + 1; j < unseen.length; j++) {
        hand[slot + 1] = unseen[j]
        const category = categoryOfScore(evaluateHand(hand))
        counts[category] = (counts[category] ?? 0) + 1
        total++
      }
    }
  }

  const byCategory: Partial<Record<HandCategory, number>> = {}
  for (const category of Object.keys(counts) as HandCategory[]) {
    byCategory[category] = counts[category]! / total
  }
  return { byCategory, sampleSize: total }
}

/** Every card not among the known ones, as integers. */
function unseenInts(known: CardInt[]): CardInt[] {
  const seen = new Uint8Array(DECK_SIZE)
  for (const card of known) seen[card] = 1
  const out: CardInt[] = []
  for (let card = 0; card < DECK_SIZE; card++) if (!seen[card]) out.push(card)
  return out
}
