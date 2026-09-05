import { describe, expect, it } from 'vitest'
import type { Card, Rank, Suit } from '../../src/poker/card'
import { Deck } from '../../src/poker/deck'
import { HoldemEngine } from '../../src/poker/game-engine'
import type { PlayerSetup } from '../../src/poker/game-engine'

const SUIT_LETTER: Record<string, Suit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }

function cards(spec: string): Card[] {
  return spec.split(' ').map((token) => {
    const rank = token.slice(0, -1) as Rank
    const suit = SUIT_LETTER[token.slice(-1)]
    return { rank, suit }
  })
}

function totalChips(engine: HoldemEngine): number {
  return engine.state.players.reduce((sum, p) => sum + p.stack + p.betThisStreet, 0)
}

const config = { smallBlind: 5, bigBlind: 10, ante: 0 }

function makePlayers(count: number, stack = 1000): PlayerSetup[] {
  return Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, stack }))
}

describe('HoldemEngine hand setup', () => {
  it('posts blinds and deals two hole cards to each player', () => {
    const engine = new HoldemEngine(makePlayers(4), config)
    engine.startHand()
    const [dealer, sb, bb, utg] = engine.state.players

    expect(sb.betThisStreet).toBe(5)
    expect(bb.betThisStreet).toBe(10)
    expect(engine.state.currentBet).toBe(10)
    for (const p of engine.state.players) expect(p.holeCards).toHaveLength(2)
    // UTG (first to act preflop in a 4-handed game) is next after BB
    expect(engine.state.players[engine.state.currentPlayerIndex].id).toBe(utg.id)
    expect(dealer.betThisStreet).toBe(0)
  })

  it('rotates the dealer button each hand', () => {
    const engine = new HoldemEngine(makePlayers(3), config)
    engine.startHand()
    const firstDealer = engine.state.dealerIndex
    // fold everyone out quickly to end the hand
    while (engine.state.handInProgress) {
      const idx = engine.state.currentPlayerIndex
      const actions = engine.getLegalActions(engine.state.players[idx].id)
      const type = actions.includes('check') ? 'check' : 'fold'
      engine.act({ playerId: engine.state.players[idx].id, type })
    }
    engine.startHand()
    expect(engine.state.dealerIndex).not.toBe(firstDealer)
  })

  it('in heads-up play, the dealer posts the small blind and acts first preflop', () => {
    const engine = new HoldemEngine(makePlayers(2), config)
    engine.startHand()
    const dealer = engine.state.players[engine.state.dealerIndex]
    expect(dealer.betThisStreet).toBe(5)
    expect(engine.state.players[engine.state.currentPlayerIndex].id).toBe(dealer.id)
  })
})

describe('HoldemEngine betting flow', () => {
  it('advances through streets when everyone checks/calls', () => {
    const engine = new HoldemEngine(makePlayers(2), config)
    engine.startHand()

    // preflop: dealer/SB calls, BB checks
    let idx = engine.state.currentPlayerIndex
    engine.act({ playerId: engine.state.players[idx].id, type: 'call' })
    idx = engine.state.currentPlayerIndex
    engine.act({ playerId: engine.state.players[idx].id, type: 'check' })

    expect(engine.state.street).toBe('flop')
    expect(engine.state.communityCards).toHaveLength(3)

    // check around on flop, turn, and river in turn
    for (let i = 0; i < 3; i++) {
      idx = engine.state.currentPlayerIndex
      engine.act({ playerId: engine.state.players[idx].id, type: 'check' })
      idx = engine.state.currentPlayerIndex
      engine.act({ playerId: engine.state.players[idx].id, type: 'check' })
    }

    expect(engine.state.handInProgress).toBe(false)
    expect(engine.state.street).toBe('showdown')
    expect(totalChips(engine)).toBe(2000)
  })

  it('ends the hand immediately when only one player remains after a fold', () => {
    const engine = new HoldemEngine(makePlayers(3), config)
    engine.startHand()
    const before = totalChips(engine)

    let idx = engine.state.currentPlayerIndex
    engine.act({ playerId: engine.state.players[idx].id, type: 'fold' })
    idx = engine.state.currentPlayerIndex
    engine.act({ playerId: engine.state.players[idx].id, type: 'fold' })

    expect(engine.state.handInProgress).toBe(false)
    expect(engine.state.lastResults).toHaveLength(1)
    expect(totalChips(engine)).toBe(before)
  })

  it('rejects a raise below the minimum raise size', () => {
    const engine = new HoldemEngine(makePlayers(3), config)
    engine.startHand()
    const idx = engine.state.currentPlayerIndex
    const player = engine.state.players[idx]
    // currentBet is 10 (BB), min raise is 10, so raising to 15 is illegal
    expect(() => engine.act({ playerId: player.id, type: 'raise', amount: 15 })).toThrow()
  })

  it('rejects acting out of turn', () => {
    const engine = new HoldemEngine(makePlayers(3), config)
    engine.startHand()
    const idx = engine.state.currentPlayerIndex
    const outOfTurnPlayer = engine.state.players[(idx + 1) % 3]
    expect(() => engine.act({ playerId: outOfTurnPlayer.id, type: 'fold' })).toThrow()
  })
})

describe('HoldemEngine side pots and showdown', () => {
  it('splits an uneven all-in into a main pot and side pot with correct winners', () => {
    // 3 players, p0 short-stacked. Force everyone all-in preflop.
    const players: PlayerSetup[] = [
      { id: 'p0', name: 'Short', stack: 30 },
      { id: 'p1', name: 'Mid', stack: 200 },
      { id: 'p2', name: 'Big', stack: 200 },
    ]
    const engine = new HoldemEngine(players, config)

    // Hole cards are dealt starting from the small blind (p1), then p2, then
    // the dealer (p0), two rounds: so draw order is p1, p2, p0, p1, p2, p0.
    // Board is trip 9s + 2h + 7s, so every hand is "trips nines + best two
    // kickers": p0 (A,K) beats p1/p2 (7,5), and p1 ties p2 exactly.
    const deck = Deck.fromCards([
      ...cards('4h'), // p1 card 1
      ...cards('4s'), // p2 card 1
      ...cards('As'), // p0 card 1
      ...cards('5h'), // p1 card 2
      ...cards('5s'), // p2 card 2
      ...cards('Ks'), // p0 card 2
      ...cards('9c 9d 9h'), // flop
      ...cards('2h'), // turn
      ...cards('7s'), // river
    ])

    engine.startHand(deck)

    const before = totalChips(engine)

    // everyone shoves preflop
    for (let i = 0; i < 3; i++) {
      const idx = engine.state.currentPlayerIndex
      const player = engine.state.players[idx]
      engine.act({ playerId: player.id, type: 'all-in' })
    }

    expect(engine.state.handInProgress).toBe(false)
    expect(totalChips(engine)).toBe(before)

    // p0 (30 chips) can only win the main pot (30 * 3 = 90); side pot (170 * 2) is p1 vs p2 only
    const p0 = engine.state.players.find((p) => p.id === 'p0')!
    const p1 = engine.state.players.find((p) => p.id === 'p1')!
    const p2 = engine.state.players.find((p) => p.id === 'p2')!

    expect(p0.stack).toBe(90) // won only the main pot
    // p1 and p2 tie on the side pot (two pair 9s-and-5s/4s with board 9-9-9-2-7 -> actually board has trips 9s, kicker plays)
    expect(p1.stack + p2.stack).toBe(340) // 170 * 2 side pot split between them
  })

  it('conserves total chips across many random hands', () => {
    const engine = new HoldemEngine(makePlayers(4, 500), config)
    const startingTotal = engine.state.players.reduce((s, p) => s + p.stack, 0)

    for (let hand = 0; hand < 25 && engine.canStartHand(); hand++) {
      engine.startHand()
      let guard = 0
      while (engine.state.handInProgress && guard < 200) {
        guard++
        const idx = engine.state.currentPlayerIndex
        const player = engine.state.players[idx]
        const legal = engine.getLegalActions(player.id)
        if (legal.includes('check')) {
          engine.act({ playerId: player.id, type: 'check' })
        } else if (legal.includes('call')) {
          engine.act({ playerId: player.id, type: 'call' })
        } else {
          engine.act({ playerId: player.id, type: 'fold' })
        }
      }
      const total = engine.state.players.reduce((s, p) => s + p.stack, 0)
      expect(total).toBe(startingTotal)
    }
  })
})
