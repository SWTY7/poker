import { describe, expect, it } from 'vitest'
import { Deck } from '../../src/poker/deck'
import { cardsEqual } from '../../src/poker/card'
import { createRng } from '../../src/utils/random'

function drawAll(deck: Deck) {
  const cards = []
  while (deck.remaining > 0) cards.push(deck.draw())
  return cards
}

describe('Deck', () => {
  it('contains exactly 52 cards', () => {
    const deck = new Deck(createRng(1))
    expect(deck.remaining).toBe(52)
  })

  it('never contains duplicate cards', () => {
    const cards = drawAll(new Deck(createRng(1)))
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        expect(cardsEqual(cards[i], cards[j])).toBe(false)
      }
    }
  })

  it('throws when drawing from an empty deck', () => {
    const deck = new Deck(createRng(1))
    drawAll(deck)
    expect(() => deck.draw()).toThrow()
  })

  it('is deterministic for a given seed', () => {
    const a = drawAll(new Deck(createRng(42)))
    const b = drawAll(new Deck(createRng(42)))
    expect(a).toEqual(b)
  })

  it('produces different orders for different seeds', () => {
    const a = drawAll(new Deck(createRng(1)))
    const b = drawAll(new Deck(createRng(2)))
    expect(a).not.toEqual(b)
  })
})
