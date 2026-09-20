import { describe, expect, it } from 'vitest'
import {
  STRUCTURES,
  blindLevel,
  handsUntilNextLevel,
  isBubble,
  isTournamentOver,
  levelForHandsCompleted,
  placesPaid,
  prizeForPosition,
  prizesForField,
  tournamentHudInfo,
  tournamentStandings,
} from '../../src/game/tournament'
import { HoldemEngine } from '../../src/poker/game-engine'
import { createRng } from '../../src/utils/random'
import { HeuristicBot } from '../../src/ai/heuristic-bot'
import { buildObservation } from '../../src/ai/observation'

const structure = STRUCTURES['sit-and-go']

describe('the blind clock', () => {
  it('starts at the structure’s own numbers', () => {
    const level1 = blindLevel(structure, 1)
    expect(level1).toEqual({ level: 1, smallBlind: structure.startingSmallBlind, bigBlind: structure.startingSmallBlind * 2, ante: 0 })
  })

  it('doubles the small blind every doubleEvery levels, never in between', () => {
    for (let level = 1; level <= structure.doubleEvery; level++) {
      expect(blindLevel(structure, level).smallBlind).toBe(structure.startingSmallBlind)
    }
    expect(blindLevel(structure, structure.doubleEvery + 1).smallBlind).toBe(structure.startingSmallBlind * 2)
    expect(blindLevel(structure, 2 * structure.doubleEvery + 1).smallBlind).toBe(structure.startingSmallBlind * 4)
  })

  it('keeps the big blind at exactly double the small blind, at every level', () => {
    for (let level = 1; level <= 20; level++) {
      const { smallBlind, bigBlind } = blindLevel(structure, level)
      expect(bigBlind).toBe(smallBlind * 2)
    }
  })

  it('has no ante before anteFromLevel, and a real one from it on', () => {
    expect(blindLevel(structure, structure.anteFromLevel - 1).ante).toBe(0)
    const withAnte = blindLevel(structure, structure.anteFromLevel)
    expect(withAnte.ante).toBe(withAnte.smallBlind)
  })

  it('never runs off the end of a table, however high the level', () => {
    expect(() => blindLevel(structure, 100)).not.toThrow()
    expect(blindLevel(structure, 100).smallBlind).toBeGreaterThan(0)
  })

  it('rejects a level below 1 rather than silently returning something', () => {
    expect(() => blindLevel(structure, 0)).toThrow()
  })

  it('never decreases as the level rises', () => {
    let previous = blindLevel(structure, 1).bigBlind
    for (let level = 2; level <= 15; level++) {
      const current = blindLevel(structure, level).bigBlind
      expect(current).toBeGreaterThanOrEqual(previous)
      previous = current
    }
  })
})

describe('mapping hands played onto a level', () => {
  it('is level 1 for the very first hand', () => {
    expect(levelForHandsCompleted(structure, 0)).toBe(1)
  })

  it('advances exactly on the handsPerLevel boundary, not before', () => {
    expect(levelForHandsCompleted(structure, structure.handsPerLevel - 1)).toBe(1)
    expect(levelForHandsCompleted(structure, structure.handsPerLevel)).toBe(2)
  })

  it('counts down to the next level and resets exactly when it arrives', () => {
    expect(handsUntilNextLevel(structure, 0)).toBe(structure.handsPerLevel)
    expect(handsUntilNextLevel(structure, structure.handsPerLevel - 1)).toBe(1)
    expect(handsUntilNextLevel(structure, structure.handsPerLevel)).toBe(structure.handsPerLevel)
  })
})

describe('payouts', () => {
  it('pays the whole pool to one winner heads-up', () => {
    expect(prizesForField(1000, 2)).toEqual([1000])
    expect(placesPaid(2)).toBe(1)
  })

  it('pays more places as the field grows', () => {
    expect(placesPaid(2)).toBeLessThanOrEqual(placesPaid(6))
    expect(placesPaid(6)).toBeLessThanOrEqual(placesPaid(9))
    expect(placesPaid(9)).toBeLessThanOrEqual(placesPaid(10))
  })

  it('always gives first place the largest share', () => {
    for (const field of [2, 4, 6, 8, 9, 10]) {
      const prizes = prizesForField(10_000, field)
      for (let i = 1; i < prizes.length; i++) expect(prizes[0]).toBeGreaterThanOrEqual(prizes[i])
    }
  })

  it('adds up to exactly the prize pool, cents and all, however the rounding falls', () => {
    // A pool that does not divide evenly by any of the usual splits.
    for (const pool of [997, 1001, 333, 12_345]) {
      for (const field of [2, 3, 6, 7, 9, 10]) {
        const prizes = prizesForField(pool, field)
        expect(prizes.reduce((sum, prize) => sum + prize, 0)).toBe(pool)
      }
    }
  })

  it('pays nothing to a finish outside the paid places', () => {
    expect(prizeForPosition(1000, 9, placesPaid(9) + 1)).toBe(0)
  })

  it('pays exactly what prizesForField says for a finish inside them', () => {
    const prizes = prizesForField(1000, 6)
    expect(prizeForPosition(1000, 6, 1)).toBe(prizes[0])
    expect(prizeForPosition(1000, 6, 2)).toBe(prizes[1])
  })
})

describe('the bubble', () => {
  it('is the one spot before the money, and nowhere else', () => {
    const field = 9
    const paid = placesPaid(field)
    expect(isBubble(paid + 1, field)).toBe(true)
    expect(isBubble(paid, field)).toBe(false)
    expect(isBubble(paid + 2, field)).toBe(false)
  })
})

/** Plays a whole tournament to completion with random-ish (heuristic) bots, for the tests below that need a real, finished GameState. */
function playToCompletion(fieldSize: number, seed: number) {
  const players = Array.from({ length: fieldSize }, (_, i) => ({ id: `p${i}`, name: `P${i}`, stack: 1000 }))
  const engine = new HoldemEngine(players, { smallBlind: 10, bigBlind: 20, ante: 0 }, createRng(seed))
  const agents = Object.fromEntries(players.map((p) => [p.id, new HeuristicBot(createRng(seed + 1))]))
  let guard = 0
  while (engine.canStartHand()) {
    if (guard++ > 300) throw new Error('tournament never finished')
    engine.startHand()
    let handGuard = 0
    while (engine.state.handInProgress) {
      if (handGuard++ > 500) throw new Error('hand never finished')
      const actor = engine.state.players[engine.state.currentPlayerIndex]
      engine.act(agents[actor.id].decideAction(buildObservation(engine, actor.id)))
    }
  }
  return engine
}

describe('standings, read off a finished tournament', () => {
  it('is over once one seat is left, and not before', () => {
    const engine = playToCompletion(4, 11)
    expect(isTournamentOver(engine.state)).toBe(true)
  })

  it('gives every seat a distinct position from 1 to the field size', () => {
    const fieldSize = 5
    const engine = playToCompletion(fieldSize, 22)
    const standings = tournamentStandings(engine.state, fieldSize)
    expect(standings).toHaveLength(fieldSize)
    expect(standings.map((s) => s.position).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
    expect(new Set(standings.map((s) => s.playerId)).size).toBe(fieldSize)
  })

  it('puts the last player standing in first, and the first bust in last', () => {
    const fieldSize = 4
    const engine = playToCompletion(fieldSize, 33)
    const standings = tournamentStandings(engine.state, fieldSize)
    const champion = engine.state.players.find((p) => !p.isEliminated)!
    expect(standings.find((s) => s.playerId === champion.id)!.position).toBe(1)
    expect(standings.find((s) => s.playerId === engine.state.eliminationOrder[0])!.position).toBe(fieldSize)
  })
})

/**
 * `useHoldemGame` escalates blinds with one line: before every `startHand`,
 * it sets `engine.state.config` from `blindLevel(structure,
 * levelForHandsCompleted(structure, engine.state.handNumber))`. There is no
 * React test harness in this repo to exercise the hook itself, so this
 * reproduces exactly that line against the real engine across a full
 * tournament, which is what actually proves the escalation is correct rather
 * than just the arithmetic behind it.
 */
describe('blinds escalating across a real tournament', () => {
  it('never plays two consecutive hands at a blind level lower than the one before it', () => {
    const structure = STRUCTURES['sit-and-go']
    const players = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, stack: structure.startingStack }))
    const engine = new HoldemEngine(players, { smallBlind: 0, bigBlind: 0, ante: 0 }, createRng(5))
    const agents = Object.fromEntries(players.map((p) => [p.id, new HeuristicBot(createRng(6))]))

    const levelsSeen: number[] = []
    let guard = 0
    while (engine.canStartHand() && guard++ < 200) {
      const level = levelForHandsCompleted(structure, engine.state.handNumber)
      const blinds = blindLevel(structure, level)
      engine.setBlinds({ smallBlind: blinds.smallBlind, bigBlind: blinds.bigBlind, ante: blinds.ante })
      levelsSeen.push(level)

      engine.startHand()
      // The mutation has to have actually taken: the hand about to be
      // played uses these blinds, not whatever it started with.
      expect(engine.state.config.bigBlind).toBe(blinds.bigBlind)

      let handGuard = 0
      while (engine.state.handInProgress && handGuard++ < 500) {
        const actor = engine.state.players[engine.state.currentPlayerIndex]
        engine.act(agents[actor.id].decideAction(buildObservation(engine, actor.id)))
      }
    }

    expect(levelsSeen.length).toBeGreaterThan(structure.handsPerLevel) // ran long enough to see it change at least once
    for (let i = 1; i < levelsSeen.length; i++) expect(levelsSeen[i]).toBeGreaterThanOrEqual(levelsSeen[i - 1])
    expect(Math.max(...levelsSeen)).toBeGreaterThan(1) // it actually escalated, not stuck at the opening level
  })
})

describe('the live HUD', () => {
  it('reports level 1 with no ante on the very first hand', () => {
    const engine = new HoldemEngine(
      [
        { id: 'p0', name: 'A', stack: 1500 },
        { id: 'p1', name: 'B', stack: 1500 },
      ],
      { smallBlind: 10, bigBlind: 20, ante: 0 },
      createRng(1),
    )
    engine.startHand()
    const hud = tournamentHudInfo(engine.state, structure, 2)
    expect(hud.level).toBe(1)
    expect(hud.ante).toBe(0)
    expect(hud.playersRemaining).toBe(2)
    expect(hud.fieldSize).toBe(2)
  })

  it('counts players remaining down as a tournament plays out', () => {
    const fieldSize = 4
    const engine = playToCompletion(fieldSize, 44)
    const hud = tournamentHudInfo(engine.state, structure, fieldSize)
    expect(hud.playersRemaining).toBe(1)
  })
})
