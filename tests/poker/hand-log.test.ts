import { describe, expect, it } from 'vitest'
import { HoldemEngine } from '../../src/poker/game-engine'
import { committedPot, streetBetTotal, totalPot } from '../../src/poker/pot'

function engineWith(count: number): HoldemEngine {
  const players = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `P${i}`, stack: 1000 }))
  return new HoldemEngine(players, { smallBlind: 5, bigBlind: 10, ante: 0 })
}

/** Everyone still to act just calls or checks, closing the current round. */
function closeRound(engine: HoldemEngine): void {
  let guard = 0
  const street = engine.state.street
  while (engine.state.handInProgress && engine.state.street === street && guard++ < 40) {
    const player = engine.state.players[engine.state.currentPlayerIndex]
    const legal = engine.getLegalActions(player.id)
    engine.act({ playerId: player.id, type: legal.includes('check') ? 'check' : 'call' })
  }
}

describe('pot accounting', () => {
  it('keeps this street’s bets out of the middle, so no chip is shown twice', () => {
    const engine = engineWith(4)
    engine.startHand()

    // Only the blinds are out; nothing has been swept in yet.
    expect(streetBetTotal(engine.state.players)).toBe(15)
    expect(committedPot(engine.state.players)).toBe(0)
    expect(totalPot(engine.state.players)).toBe(15)

    closeRound(engine)

    // Preflop is settled: everything is now in the middle, nothing in front.
    expect(engine.state.street).toBe('flop')
    expect(streetBetTotal(engine.state.players)).toBe(0)
    expect(committedPot(engine.state.players)).toBe(40)
    expect(committedPot(engine.state.players) + streetBetTotal(engine.state.players)).toBe(
      totalPot(engine.state.players),
    )
  })

  it('the middle plus the bets in front always equals the whole pot', () => {
    const engine = engineWith(4)
    engine.startHand()
    const better = engine.state.players[engine.state.currentPlayerIndex]
    engine.act({ playerId: better.id, type: 'raise', amount: 40 })

    expect(committedPot(engine.state.players) + streetBetTotal(engine.state.players)).toBe(
      totalPot(engine.state.players),
    )
  })
})

describe('hand log', () => {
  it('records the blinds before any action', () => {
    const engine = engineWith(4)
    engine.startHand()

    const blinds = engine.state.handLog.filter((e) => e.kind === 'blind')
    expect(blinds.map((b) => b.message)).toEqual(['small blind', 'big blind'])
    expect(blinds.map((b) => b.amount)).toEqual([5, 10])
    expect(blinds[1].potAfter).toBe(15)
  })

  it('records antes for every live player', () => {
    const players = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, stack: 1000 }))
    const engine = new HoldemEngine(players, { smallBlind: 5, bigBlind: 10, ante: 2 })
    engine.startHand()

    expect(engine.state.handLog.filter((e) => e.kind === 'ante')).toHaveLength(3)
  })

  it('stamps each action with the street it happened on', () => {
    const engine = engineWith(4)
    engine.startHand()
    closeRound(engine)

    const streets = new Set(engine.state.handLog.filter((e) => e.kind === 'action').map((e) => e.street))
    expect(streets).toEqual(new Set(['preflop']))

    const flopActor = engine.state.players[engine.state.currentPlayerIndex]
    engine.act({ playerId: flopActor.id, type: 'bet', amount: 30 })
    expect(engine.state.handLog.at(-1)).toMatchObject({ street: 'flop', actionType: 'bet', toAmount: 30 })
  })

  it('records each board card as it is dealt', () => {
    const engine = engineWith(4)
    engine.startHand()
    closeRound(engine)

    const deals = engine.state.handLog.filter((e) => e.kind === 'deal')
    expect(deals).toHaveLength(1)
    expect(deals[0].street).toBe('flop')
    expect(deals[0].cards).toHaveLength(3)
  })

  it('logs a raise by the total it was raised TO, and a call by chips paid', () => {
    const engine = engineWith(4)
    engine.startHand()

    const raiser = engine.state.players[engine.state.currentPlayerIndex]
    engine.act({ playerId: raiser.id, type: 'raise', amount: 30 })
    expect(engine.state.handLog.at(-1)).toMatchObject({ actionType: 'raise', toAmount: 30, amount: 30 })

    const caller = engine.state.players[engine.state.currentPlayerIndex]
    engine.act({ playerId: caller.id, type: 'call' })
    expect(engine.state.handLog.at(-1)).toMatchObject({ actionType: 'call', amount: 30 })
  })

  it('ends with a result line naming the winner', () => {
    const engine = engineWith(3)
    engine.startHand()

    let guard = 0
    while (engine.state.handInProgress && guard++ < 20) {
      const player = engine.state.players[engine.state.currentPlayerIndex]
      const legal = engine.getLegalActions(player.id)
      engine.act({ playerId: player.id, type: legal.includes('fold') ? 'fold' : 'check' })
    }

    const result = engine.state.handLog.at(-1)
    expect(result?.kind).toBe('result')
    expect(result?.message).toMatch(/wins/)
  })

  it('reveals every showdown contender’s hole cards before announcing the result', () => {
    const engine = engineWith(3)
    engine.startHand()
    let guard = 0
    while (engine.state.handInProgress && guard++ < 40) {
      const player = engine.state.players[engine.state.currentPlayerIndex]
      const legal = engine.getLegalActions(player.id)
      engine.act({ playerId: player.id, type: legal.includes('check') ? 'check' : 'call' })
    }

    const reveals = engine.state.handLog.filter((e) => e.kind === 'reveal')
    expect(reveals.length).toBeGreaterThan(0)
    for (const reveal of reveals) {
      expect(reveal.street).toBe('showdown')
      expect(reveal.cards).toHaveLength(2)
      expect(reveal.playerName).toBeTruthy()
    }

    const lastRevealIndex = engine.state.handLog.findLastIndex((e) => e.kind === 'reveal')
    const firstResultIndex = engine.state.handLog.findIndex((e) => e.kind === 'result')
    expect(lastRevealIndex).toBeLessThan(firstResultIndex)
  })

  it('starts a fresh log each hand', () => {
    const engine = engineWith(4)
    engine.startHand()
    const first = engine.state.handLog.length
    expect(first).toBeGreaterThan(0)

    closeRound(engine)
    engine.startHand()

    expect(engine.state.handLog.filter((e) => e.kind === 'blind')).toHaveLength(2)
    expect(engine.state.handLog.map((e) => e.seq)).toEqual([0, 1])
  })
})
