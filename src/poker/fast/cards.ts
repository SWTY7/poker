import { RANKS, SUITS, type Card, type Rank, type Suit } from '../card'

/**
 * A card as a single integer, 0..51, laid out as `rank * 4 + suit` where rank
 * 0 is a deuce and rank 12 is an ace.
 *
 * The object form (`{ rank: 'A', suit: 'spades' }`) is the right shape for
 * game state and for reading in the UI. It is the wrong shape for an inner
 * loop: every card is a heap allocation, every comparison is a string
 * comparison, and a seven-card hand is seven pointer chases. The evaluator
 * and everything built on it (equity, CFR, self-play) work in these integers
 * instead, and convert only at the boundary.
 */
export type CardInt = number

export const RANK_COUNT = 13
export const SUIT_COUNT = 4
export const DECK_SIZE = 52

/** Rank index 0..12. Add 2 to get the familiar rank value (deuce = 2, ace = 14). */
export function rankOf(card: CardInt): number {
  return card >> 2
}

/** Suit index 0..3, in the order of `SUITS`. */
export function suitOf(card: CardInt): number {
  return card & 3
}

const SUIT_INDEX: Record<Suit, number> = { clubs: 0, diamonds: 1, hearts: 2, spades: 3 }
const SUIT_BY_INDEX: Suit[] = ['clubs', 'diamonds', 'hearts', 'spades']

export function toCardInt(card: Card): CardInt {
  return (RANKS.indexOf(card.rank) << 2) | SUIT_INDEX[card.suit]
}

export function fromCardInt(card: CardInt): Card {
  return { rank: RANKS[card >> 2] as Rank, suit: SUIT_BY_INDEX[card & 3] }
}

export function toCardInts(cards: Card[]): CardInt[] {
  const out: CardInt[] = new Array(cards.length)
  for (let i = 0; i < cards.length; i++) out[i] = toCardInt(cards[i])
  return out
}

export function fromCardInts(cards: CardInt[]): Card[] {
  const out: Card[] = new Array(cards.length)
  for (let i = 0; i < cards.length; i++) out[i] = fromCardInt(cards[i])
  return out
}

/** Every card in the deck, in a fixed order. */
export function fullDeckInts(): CardInt[] {
  const deck: CardInt[] = new Array(DECK_SIZE)
  for (let i = 0; i < DECK_SIZE; i++) deck[i] = i
  return deck
}

/** Sanity check that the two orderings agree; used by the tests. */
export const SUIT_ORDER = SUITS
