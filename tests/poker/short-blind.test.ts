import { describe, expect, it } from 'vitest'
import { HoldemEngine } from '../../src/poker/game-engine'
import type { PlayerSetup } from '../../src/poker/game-engine'
import { buildObservation } from '../../src/ai/observation'
import { HeuristicBot } from '../../src/ai/heuristic-bot'
import { createRng } from '../../src/utils/random'
import type { Agent } from '../../src/ai/agent'

const config = { smallBlind: 5, bigBlind: 10, ante: 0 }

/**
 * A blind can be larger than a short stack, which puts that player all-in
 * before they have had a single decision to make. The engine used to hand the
 * action to exactly that player — who has no legal actions — and the hand
 * stopped there. In the app that is a permanently frozen table, so these are
 * the regression tests for it.
 */
describe('a blind bigger than the stack that posts it', () => {
  it('does not seat the action on a player the blind put all-in, heads-up', () => {
    // 1 chip against a $5 small blind: the exact shape found in the wild.
    const players: PlayerSetup[] = [
      { id: 'short', name: 'Short', stack: 1 },
      { id: 'big', name: 'Big', stack: 1999 },
    ]
    const engine = new HoldemEngine(players, config, createRng(2))
    engine.startHand()

    // Either the hand ran itself out, or whoever is to act can actually act.
    if (engine.state.handInProgress) {
      const toAct = engine.state.players[engine.state.currentPlayerIndex]
      expect(engine.getLegalActions(toAct.id).length).toBeGreaterThan(0)
    }
  })

  it('plays the hand to completion and conserves chips', () => {
    const players: PlayerSetup[] = [
      { id: 'short', name: 'Short', stack: 1 },
      { id: 'big', name: 'Big', stack: 1999 },
    ]
    const engine = new HoldemEngine(players, config, createRng(2))
    const before = engine.state.players.reduce((s, p) => s + p.stack, 0)

    engine.startHand()
    let guard = 0
    while (engine.state.handInProgress && guard++ < 100) {
      const player = engine.state.players[engine.state.currentPlayerIndex]
      const obs = buildObservation(engine, player.id)
      expect(obs.legalActions.length).toBeGreaterThan(0)
      engine.act(new HeuristicBot(createRng(1)).decideAction(obs))
    }

    expect(engine.state.handInProgress).toBe(false)
    expect(engine.state.players.reduce((s, p) => s + p.stack, 0)).toBe(before)
    // The short stack contested only its 1 chip, so the other player can never
    // lose more than that — the uncalled part of the blind comes back.
    expect(engine.state.players.find((p) => p.id === 'big')!.stack).toBeGreaterThanOrEqual(1998)
  })

  it('survives every seat being put all-in by its blind', () => {
    const players: PlayerSetup[] = [
      { id: 'a', name: 'A', stack: 2 },
      { id: 'b', name: 'B', stack: 3 },
    ]
    const engine = new HoldemEngine(players, config, createRng(5))
    const before = engine.state.players.reduce((s, p) => s + p.stack, 0)
    engine.startHand()
    expect(engine.state.handInProgress).toBe(false)
    expect(engine.state.players.reduce((s, p) => s + p.stack, 0)).toBe(before)
  })
})

/**
 * The broader invariant the bug violated, checked across a lot of tables at
 * once: while a hand is in progress the player to act always has something
 * they are allowed to do.
 */
describe('the player to act always has a legal action', () => {
  it('holds across 200 seeded tables played to the felt', () => {
    for (let seed = 0; seed < 200; seed++) {
      const players: PlayerSetup[] = Array.from({ length: 4 }, (_, i) => ({
        id: `p${i}`,
        name: `P${i}`,
        stack: 500,
      }))
      const engine = new HoldemEngine(players, config, createRng(seed))
      const agents: Record<string, Agent> = Object.fromEntries(
        engine.state.players.map((p, i) => [p.id, new HeuristicBot(createRng(200 + i))]),
      )

      for (let hand = 0; hand < 60 && engine.canStartHand(); hand++) {
        engine.startHand()
        let guard = 0
        while (engine.state.handInProgress && guard++ < 500) {
          const player = engine.state.players[engine.state.currentPlayerIndex]
          const obs = buildObservation(engine, player.id)
          if (obs.legalActions.length === 0) {
            throw new Error(
              `seed ${seed}, hand ${hand}: ${player.id} is to act on the ${engine.state.street} ` +
                `but has no legal actions (folded=${player.folded}, allIn=${player.isAllIn})`,
            )
          }
          engine.act(agents[player.id].decideAction(obs))
        }
        expect(guard).toBeLessThan(500)
      }
    }
  })
})
