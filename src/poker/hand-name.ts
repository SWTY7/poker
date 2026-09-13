import type { Card } from './card'
import { evaluateBestHand, type HandCategory, type HandValue } from './hand-evaluator'

const PLURAL: Record<number, string> = {
  2: 'twos',
  3: 'threes',
  4: 'fours',
  5: 'fives',
  6: 'sixes',
  7: 'sevens',
  8: 'eights',
  9: 'nines',
  10: 'tens',
  11: 'jacks',
  12: 'queens',
  13: 'kings',
  14: 'aces',
}

const SINGULAR: Record<number, string> = {
  2: 'two',
  3: 'three',
  4: 'four',
  5: 'five',
  6: 'six',
  7: 'seven',
  8: 'eight',
  9: 'nine',
  10: 'ten',
  11: 'jack',
  12: 'queen',
  13: 'king',
  14: 'ace',
}

/** Plain name for a hand category, with no ranks in it. */
export const CATEGORY_LABEL: Record<HandCategory, string> = {
  'high-card': 'High card',
  pair: 'Pair',
  'two-pair': 'Two pair',
  trips: 'Three of a kind',
  straight: 'Straight',
  flush: 'Flush',
  'full-house': 'Full house',
  quads: 'Four of a kind',
  'straight-flush': 'Straight flush',
}

/** Worst to best — the order a hand-rankings chart reads in. */
export const CATEGORY_ORDER: HandCategory[] = [
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
 * What a player would actually say they have: "Pair of nines", "Kings full of
 * fours", "Ace-high". The evaluator already computes the tiebreakers that
 * name the hand; this only puts words to them, so the UI never has to say
 * something as uninformative as "pair" when the table would say which pair.
 */
export function describeHandValue(value: HandValue): string {
  const [a, b] = value.tiebreakers
  switch (value.category) {
    case 'high-card':
      return `${SINGULAR[a] ? SINGULAR[a][0].toUpperCase() + SINGULAR[a].slice(1) : 'High card'} high`
    case 'pair':
      return `Pair of ${PLURAL[a]}`
    case 'two-pair':
      return `Two pair, ${PLURAL[a]} and ${PLURAL[b]}`
    case 'trips':
      return `Three ${PLURAL[a]}`
    case 'straight':
      return `${SINGULAR[a][0].toUpperCase() + SINGULAR[a].slice(1)}-high straight`
    case 'flush':
      return `${SINGULAR[a][0].toUpperCase() + SINGULAR[a].slice(1)}-high flush`
    case 'full-house':
      return `${PLURAL[a][0].toUpperCase() + PLURAL[a].slice(1)} full of ${PLURAL[b]}`
    case 'quads':
      return `Four ${PLURAL[a]}`
    case 'straight-flush':
      return a === 14 ? 'Royal flush' : `${SINGULAR[a][0].toUpperCase() + SINGULAR[a].slice(1)}-high straight flush`
  }
}

/**
 * The hero's current made hand, or null before there are five cards to make
 * one from. Pre-flop there is no hand yet — only two cards and a hope — and
 * saying "ace high" about them would be describing something the player
 * cannot yet play.
 */
export function currentHandName(holeCards: Card[], communityCards: Card[]): string | null {
  const all = [...holeCards, ...communityCards]
  if (all.length < 5) return null
  return describeHandValue(evaluateBestHand(all))
}
