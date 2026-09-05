import { describe, expect, it } from 'vitest'
import { HoldemEngine } from '../../../src/poker/game-engine'
import type { PlayerSetup } from '../../../src/poker/game-engine'
import { PersonalityBot } from '../../../src/ai/psychology/personality-bot'
import { NEUTRAL_PERSONALITY, applyPersonalityShift, traitOffset } from '../../../src/ai/psychology/personality'
import { buildObservation } from '../../../src/ai/observation'
import { createRng } from '../../../src/utils/random'
import type { Agent } from '../../../src/ai/agent'

describe('traitOffset', () => {
  it('is zero at the neutral trait value (0.5)', () => {
    expect(traitOffset(0.5)).toBe(0)
  })

  it('is positive above neutral and negative below it, symmetric around 0.5', () => {
    expect(traitOffset(1)).toBeGreaterThan(0)
    expect(traitOffset(0)).toBeLessThan(0)
    expect(traitOffset(1)).toBeCloseTo(-traitOffset(0))
  })
})

describe('applyPersonalityShift', () => {
  it('leaves every threshold unchanged for a neutral personality', () => {
    const shifted = applyPersonalityShift(0.5, NEUTRAL_PERSONALITY)
    expect(shifted.effectiveForBet).toBeCloseTo(0.5)
    expect(shifted.effectiveForCall).toBeCloseTo(0.5)
    expect(shifted.effectiveForRaiseFacingBet).toBeCloseTo(0.5)
  })

  it('a tighter personality lowers the effective strength used for betting and calling', () => {
    const loose = applyPersonalityShift(0.5, { aggression: 0.5, tightness: 0, bluffFrequency: 0 })
    const tight = applyPersonalityShift(0.5, { aggression: 0.5, tightness: 1, bluffFrequency: 0 })
    expect(tight.effectiveForBet).toBeLessThan(loose.effectiveForBet)
    expect(tight.effectiveForCall).toBeLessThan(loose.effectiveForCall)
  })

  it('a more aggressive personality raises the effective strength used for betting and raising', () => {
    const passive = applyPersonalityShift(0.5, { aggression: 0, tightness: 0.5, bluffFrequency: 0 })
    const aggressive = applyPersonalityShift(0.5, { aggression: 1, tightness: 0.5, bluffFrequency: 0 })
    expect(aggressive.effectiveForBet).toBeGreaterThan(passive.effectiveForBet)
    expect(aggressive.effectiveForRaiseFacingBet).toBeGreaterThan(passive.effectiveForRaiseFacingBet)
  })
})

describe('PersonalityBot', () => {
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
        engine.act(action)
      }
      expect(guard).toBeLessThan(500)
    }
  }

  it('with NEUTRAL_PERSONALITY behaves like a normal HeuristicBot and conserves chips over many hands', () => {
    const engine = new HoldemEngine(makePlayers(4), config)
    const startingTotal = engine.state.players.reduce((s, p) => s + p.stack, 0)
    const agents = Object.fromEntries(
      engine.state.players.map((p, i) => [p.id, new PersonalityBot(NEUTRAL_PERSONALITY, createRng(300 + i))]),
    )
    playHandsToCompletion(engine, agents, 50)
    const total = engine.state.players.reduce((s, p) => s + p.stack, 0)
    expect(total).toBe(startingTotal)
  })

  it('a mix of extreme personalities still only ever takes legal actions and conserves chips', () => {
    const engine = new HoldemEngine(makePlayers(4), config)
    const startingTotal = engine.state.players.reduce((s, p) => s + p.stack, 0)
    const profiles = [
      { aggression: 1, tightness: 0, bluffFrequency: 0 },
      { aggression: 0, tightness: 1, bluffFrequency: 0 },
      { aggression: 1, tightness: 1, bluffFrequency: 0 },
      { aggression: 0, tightness: 0, bluffFrequency: 0 },
    ]
    const agents = Object.fromEntries(
      engine.state.players.map((p, i) => [p.id, new PersonalityBot(profiles[i], createRng(400 + i))]),
    )
    playHandsToCompletion(engine, agents, 50)
    const total = engine.state.players.reduce((s, p) => s + p.stack, 0)
    expect(total).toBe(startingTotal)
  })
})
