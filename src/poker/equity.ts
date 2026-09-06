import type { Card } from './card'
import { RANKS, SUITS } from './card'
import type { HandCategory } from './hand-evaluator'
import { combinations, evaluateBestHand } from './hand-evaluator'

function unseenCards(known: Card[]): Card[] {
  const isKnown = (card: Card) => known.some((k) => k.rank === card.rank && k.suit === card.suit)
  const deck: Card[] = []
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      if (!isKnown({ rank, suit })) deck.push({ rank, suit })
    }
  }
  return deck
}

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
 * Exhaustively enumerates every way the remaining board cards could come
 * out and tallies which hand category the hero ends up with. Exact, not a
 * simulation — cheap enough once the flop is out (at most 47 choose 2 =
 * 1,081 completions) but preflop's 50 choose 5 = ~2.1M would block the UI
 * thread, so that case is deliberately left uncomputed.
 */
export function estimateHandOdds(holeCards: Card[], communityCards: Card[]): HandOdds | null {
  const need = 5 - communityCards.length
  if (need > 2) return null

  if (need <= 0) {
    const value = evaluateBestHand([...holeCards, ...communityCards])
    return { byCategory: { [value.category]: 1 }, sampleSize: 1 }
  }

  const unseen = unseenCards([...holeCards, ...communityCards])
  const counts: Partial<Record<HandCategory, number>> = {}
  let total = 0
  for (const draw of combinations(unseen, need)) {
    const value = evaluateBestHand([...holeCards, ...communityCards, ...draw])
    counts[value.category] = (counts[value.category] ?? 0) + 1
    total++
  }

  const byCategory: Partial<Record<HandCategory, number>> = {}
  for (const category of Object.keys(counts) as HandCategory[]) {
    byCategory[category] = counts[category]! / total
  }
  return { byCategory, sampleSize: total }
}
