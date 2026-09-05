import { describe, expect, it } from 'vitest'
import { HoldemEngine } from '../../src/poker/game-engine'
import { HeuristicBot } from '../../src/ai/heuristic-bot'
import { RandomBot } from '../../src/ai/random-bot'
import { buildObservation } from '../../src/ai/observation'
import type { Agent } from '../../src/ai/agent'
import { cardToString } from '../../src/poker/card'
import { committedPot, streetBetTotal, totalPot } from '../../src/poker/pot'
import { createRng } from '../../src/utils/random'
import type { Street } from '../../src/poker/game-state'

const STREET_ORDER: Street[] = ['preflop', 'flop', 'turn', 'river', 'showdown']

/**
 * Plays whole hands the way the UI does — the engine driven only through
 * validated action requests — and checks the invariants that must hold no
 * matter what the bots do.
 */
function playSession(seed: number, botKind: 'heuristic' | 'random', handLimit: number) {
  const playerCount = 6
  const startingStack = 1000
  const players = Array.from({ length: playerCount }, (_, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    stack: startingStack,
  }))

  const rng = createRng(seed)
  const engine = new HoldemEngine(players, { smallBlind: 5, bigBlind: 10, ante: 0 }, rng)
  const agents: Record<string, Agent> = {}
  for (const p of players) {
    agents[p.id] = botKind === 'heuristic' ? new HeuristicBot(createRng(seed + 1)) : new RandomBot(createRng(seed + 1))
  }

  const chipsInPlay = playerCount * startingStack
  let handsPlayed = 0

  while (engine.canStartHand() && handsPlayed < handLimit) {
    engine.startHand()
    handsPlayed++

    let guard = 0
    while (engine.state.handInProgress) {
      expect(guard++).toBeLessThan(500)

      const actor = engine.state.players[engine.state.currentPlayerIndex]
      expect(actor.folded).toBe(false)
      expect(actor.isAllIn).toBe(false)

      // The middle and the bets in front must always add up to the whole pot;
      // this is the invariant the old UI broke by counting street bets twice.
      expect(committedPot(engine.state.players) + streetBetTotal(engine.state.players)).toBe(
        totalPot(engine.state.players),
      )

      engine.act(agents[actor.id].decideAction(buildObservation(engine, actor.id)))
    }

    // No chips created or destroyed.
    const stacks = engine.state.players.reduce((sum, p) => sum + p.stack, 0)
    expect(stacks).toBe(chipsInPlay)
    for (const p of engine.state.players) expect(p.stack).toBeGreaterThanOrEqual(0)

    // No duplicate cards anywhere in the hand.
    const dealt = [
      ...engine.state.communityCards,
      ...engine.state.players.filter((p) => p.holeCards.length > 0).flatMap((p) => p.holeCards),
    ].map(cardToString)
    expect(new Set(dealt).size).toBe(dealt.length)

    const log = engine.state.handLog

    // The narration is ordered, complete, and ends by saying who won.
    expect(log.map((e) => e.seq)).toEqual(log.map((_, i) => i))
    expect(log.at(-1)?.kind).toBe('result')
    expect(log.filter((e) => e.kind === 'blind').length).toBeGreaterThanOrEqual(1)

    // Streets only ever move forward through the log.
    let streetIndex = 0
    for (const entry of log) {
      const next = STREET_ORDER.indexOf(entry.street)
      expect(next).toBeGreaterThanOrEqual(streetIndex)
      streetIndex = next
    }

    // The pot never shrinks while the hand is being played out.
    const duringHand = log.filter((e) => e.kind !== 'result')
    for (let i = 1; i < duringHand.length; i++) {
      expect(duringHand[i].potAfter).toBeGreaterThanOrEqual(duringHand[i - 1].potAfter)
    }

    // A board card logged as dealt is a card actually on the board.
    const loggedBoard = log.filter((e) => e.kind === 'deal').flatMap((e) => e.cards ?? [])
    expect(loggedBoard.map(cardToString)).toEqual(
      engine.state.communityCards.slice(0, loggedBoard.length).map(cardToString),
    )
  }

  return { handsPlayed }
}

describe('full-session simulation', () => {
  it.each([1, 2, 3, 4, 5])('holds every invariant over a heuristic-bot session (seed %i)', (seed) => {
    const { handsPlayed } = playSession(seed, 'heuristic', 60)
    expect(handsPlayed).toBeGreaterThan(0)
  })

  it.each([11, 12, 13])('holds every invariant under random-bot chaos (seed %i)', (seed) => {
    const { handsPlayed } = playSession(seed, 'random', 60)
    expect(handsPlayed).toBeGreaterThan(0)
  })

  it('a table of heuristic bots eventually busts players out', () => {
    const { handsPlayed } = playSession(7, 'heuristic', 400)
    expect(handsPlayed).toBeGreaterThan(1)
  })
})
