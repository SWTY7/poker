export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades'

export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A'

export interface Card {
  rank: Rank
  suit: Suit
}

export const RANKS: readonly Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A']
export const SUITS: readonly Suit[] = ['clubs', 'diamonds', 'hearts', 'spades']

const SUIT_SYMBOL: Record<Suit, string> = {
  clubs: '♣',
  diamonds: '♦',
  hearts: '♥',
  spades: '♠',
}

/** 2 -> 2 ... T -> 10 ... A -> 14 */
export function rankValue(rank: Rank): number {
  return RANKS.indexOf(rank) + 2
}

export function cardsEqual(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit
}

export function cardToString(card: Card): string {
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`
}

export function suitSymbol(suit: Suit): string {
  return SUIT_SYMBOL[suit]
}

export function isRedSuit(suit: Suit): boolean {
  return suit === 'hearts' || suit === 'diamonds'
}

export function displayRank(rank: Rank): string {
  return rank === 'T' ? '10' : rank
}
