import type { Card } from './card'
import { RANKS, SUITS } from './card'
import type { Rng } from '../utils/random'
import { createRng, shuffle } from '../utils/random'

export class Deck {
  private cards: Card[]

  constructor(rng: Rng = createRng()) {
    this.cards = []
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        this.cards.push({ rank, suit })
      }
    }
    shuffle(this.cards, rng)
  }

  draw(): Card {
    const card = this.cards.pop()
    if (!card) throw new Error('Cannot draw from an empty deck')
    return card
  }

  get remaining(): number {
    return this.cards.length
  }

  /** Test/debug helper: builds a deck that draws exactly the given cards, in order. */
  static fromCards(cards: Card[]): Deck {
    const deck = new Deck(() => 0)
    deck.cards = [...cards].reverse()
    return deck
  }
}
