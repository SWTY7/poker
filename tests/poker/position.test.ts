import { describe, expect, it } from 'vitest'
import { HoldemEngine } from '../../src/poker/game-engine'
import { positionLabels } from '../../src/poker/position'

function engineWith(count: number): HoldemEngine {
  const players = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `P${i}`, stack: 1000 }))
  return new HoldemEngine(players, { smallBlind: 5, bigBlind: 10, ante: 0 })
}

describe('positionLabels', () => {
  it('labels every seat at a 6-max table', () => {
    const engine = engineWith(6)
    engine.startHand()
    const labels = positionLabels(engine.state)

    expect(labels.size).toBe(6)
    expect([...labels.values()].sort()).toEqual(['BB', 'BTN', 'CO', 'MP', 'SB', 'UTG'])
  })

  it('names the seats in preflop action order after the big blind', () => {
    const engine = engineWith(6)
    engine.startHand()
    const state = engine.state
    const labels = positionLabels(state)
    const n = state.players.length

    const order = [1, 2, 3].map((step) => labels.get(state.players[(state.bigBlindIndex + step) % n].id))
    expect(order).toEqual(['UTG', 'MP', 'CO'])
  })

  it('drops the middle seats down to UTG/CO at a 4-handed table', () => {
    const engine = engineWith(4)
    engine.startHand()
    expect([...positionLabels(engine.state).values()].sort()).toEqual(['BB', 'BTN', 'CO', 'SB'])
  })

  it('heads-up has only the blinds, with the button posting the small blind', () => {
    const engine = engineWith(2)
    engine.startHand()
    const state = engine.state
    const labels = positionLabels(state)

    expect([...labels.values()].sort()).toEqual(['BB', 'SB'])
    expect(labels.get(state.players[state.dealerIndex].id)).toBe('SB')
  })

  it('skips busted seats', () => {
    const engine = engineWith(6)
    engine.state.players[3].isEliminated = true
    engine.state.players[3].stack = 0
    engine.startHand()

    const labels = positionLabels(engine.state)
    expect(labels.size).toBe(5)
    expect(labels.has('p3')).toBe(false)
  })
})
