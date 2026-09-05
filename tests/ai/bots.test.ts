import { describe, expect, it } from 'vitest'
import { HoldemEngine } from '../../src/poker/game-engine'
import type { PlayerSetup } from '../../src/poker/game-engine'
import { RandomBot } from '../../src/ai/random-bot'
import { HeuristicBot } from '../../src/ai/heuristic-bot'
import { buildObservation } from '../../src/ai/observation'
import { createRng } from '../../src/utils/random'
import type { Agent } from '../../src/ai/agent'

const config = { smallBlind: 5, bigBlind: 10, ante: 0 }

function makePlayers(count: number, stack = 500): PlayerSetup[] {
  return Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `Player ${i}`, stack }))
}

function playHandsToCompletion(engine: HoldemEngine, agents: Record<string, Agent>, hands: number) {
  for (let hand = 0; hand < hands && engine.canStartHand(); hand++) {
    engine.startHand()
    let guard = 0
    while (engine.state.handInProgress && guard < 500) {
      guard++
      const player = engine.state.players[engine.state.currentPlayerIndex]
      const obs = buildObservation(engine, player.id)
      const action = agents[player.id].decideAction(obs)
      expect(obs.legalActions).toContain(action.type)
      if (action.type === 'bet' || action.type === 'raise') {
        expect(action.amount).toBeGreaterThanOrEqual(obs.minRaiseTo)
        expect(action.amount).toBeLessThanOrEqual(obs.maxRaiseTo)
      }
      engine.act(action)
    }
    expect(guard).toBeLessThan(500)
  }
}

describe('RandomBot', () => {
  it('only ever picks legal actions and keeps chips conserved over many hands', () => {
    const engine = new HoldemEngine(makePlayers(5), config)
    const startingTotal = engine.state.players.reduce((s, p) => s + p.stack, 0)
    const agents = Object.fromEntries(
      engine.state.players.map((p, i) => [p.id, new RandomBot(createRng(100 + i))]),
    )
    playHandsToCompletion(engine, agents, 50)
    const total = engine.state.players.reduce((s, p) => s + p.stack, 0)
    expect(total).toBe(startingTotal)
  })
})

describe('HeuristicBot', () => {
  it('only ever picks legal actions and keeps chips conserved over many hands', () => {
    const engine = new HoldemEngine(makePlayers(4), config)
    const startingTotal = engine.state.players.reduce((s, p) => s + p.stack, 0)
    const agents = Object.fromEntries(
      engine.state.players.map((p, i) => [p.id, new HeuristicBot(createRng(200 + i))]),
    )
    playHandsToCompletion(engine, agents, 50)
    const total = engine.state.players.reduce((s, p) => s + p.stack, 0)
    expect(total).toBe(startingTotal)
  })

  it('folds weak hands facing a big bet more often than it calls with strong hands facing none', () => {
    const bot = new HeuristicBot(createRng(1))
    const weakFacingBet = {
      playerId: 'p0',
      ownCards: [
        { rank: '2', suit: 'clubs' },
        { rank: '7', suit: 'diamonds' },
      ],
      communityCards: [],
      potSize: 100,
      players: [],
      legalActions: ['fold', 'call', 'raise'] as const,
      street: 'preflop' as const,
      currentBet: 900,
      toCall: 900,
      minRaiseTo: 1800,
      maxRaiseTo: 900,
      actionHistory: [],
    }
    const action = bot.decideAction(weakFacingBet as never)
    expect(action.type).toBe('fold')
  })
})
