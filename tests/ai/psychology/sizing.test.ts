import { describe, expect, it } from 'vitest'
import { blindsFrom, sizeActions, sizeBucket } from '../../../src/ai/psychology/sizing'
import type { PokerAction } from '../../../src/poker/game-state'

const blinds = new Map([
  ['sb', 5],
  ['bb', 10],
])

describe('sizing each bet against the pot it went into', () => {
  it('rebuilds the pot across streets and measures a bet by it', () => {
    const history: PokerAction[] = [
      { playerId: 'sb', type: 'raise', amount: 30, street: 'preflop' },
      { playerId: 'bb', type: 'call', street: 'preflop' },
      { playerId: 'bb', type: 'bet', amount: 20, street: 'flop' },
      { playerId: 'sb', type: 'raise', amount: 80, street: 'flop' },
    ]
    const sized = sizeActions(history, blinds, 10)
    // Preflop: a raise to 30 over the 10 blind, with the small blind's 5 in
    // already — calling would have made the pot 20, and it added 20 more.
    expect(sized[0].fraction).toBeCloseTo(20 / 20, 6)
    expect(sized[1].fraction).toBeNull()
    // The flop starts with 60 in the middle: a 20 bet is a third of it.
    expect(sized[2].potBefore).toBe(60)
    expect(sized[2].fraction).toBeCloseTo(1 / 3, 6)
    // Raising to 80: calling the 20 makes 100, and the raise adds 60 more.
    expect(sized[3].fraction).toBeCloseTo(0.6, 6)
  })

  it('treats an all-in for less than the bet as the call it is', () => {
    const history: PokerAction[] = [
      { playerId: 'bb', type: 'bet', amount: 50, street: 'river' },
      { playerId: 'sb', type: 'all-in', amount: 40, street: 'river' },
    ]
    expect(sizeActions(history, new Map(), 10)[1].fraction).toBeNull()
  })

  it('puts an unstamped action on the street in progress', () => {
    const sized = sizeActions([{ playerId: 'bb', type: 'bet', amount: 20 }], new Map([['bb', 40]]), 10, 'flop')
    expect(sized[0].street).toBe('flop')
    expect(sized[0].fraction).toBeCloseTo(0.5, 6)
  })

  it('splits sizes into small and large at 60% of the pot', () => {
    expect(sizeBucket(1 / 3)).toBe('small')
    expect(sizeBucket(0.5)).toBe('small')
    expect(sizeBucket(0.75)).toBe('large')
    expect(sizeBucket(1.5)).toBe('large')
  })

  it('reads the blinds off the seat names', () => {
    const map = blindsFrom(
      [
        { id: 'a', position: 'BTN' },
        { id: 'b', position: 'SB' },
        { id: 'c', position: 'BB' },
      ],
      10,
    )
    expect([...map]).toEqual([
      ['b', 5],
      ['c', 10],
    ])
  })
})
