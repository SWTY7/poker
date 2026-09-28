import { describe, expect, it } from 'vitest'
import { HoldemEngine } from '../../src/poker/game-engine'
import type { GameState, PokerAction } from '../../src/poker/game-state'
import { HeuristicBot } from '../../src/ai/heuristic-bot'
import { buildObservation } from '../../src/ai/observation'
import { PsychBot } from '../../src/ai/psychology/psych-bot'
import { HOTHEAD } from '../../src/ai/psychology/profile'
import { OpponentModel, actionContext, type OpponentModelData } from '../../src/ai/psychology/opponent-model'
import { createRng } from '../../src/utils/random'
import {
  ROSTER,
  RivalSession,
  SCOUTING_MIN_HANDS,
  WALK_IN_NAMES,
  emptyRecord,
  emptyRivals,
  handNet,
  handStats,
  migrateRivals,
  netBetween,
  planTable,
  rivalProfile,
  scoutingNote,
  walkInCount,
  type RivalsData,
  type SeatPlan,
} from '../../src/game/rivals'

describe('the roster', () => {
  it('gives every rival the same character every time', () => {
    for (const rival of ROSTER) expect(rivalProfile(rival)).toEqual(rivalProfile(rival))
  })

  it('has unique ids and names, none shared with a walk-in', () => {
    expect(new Set(ROSTER.map((r) => r.id)).size).toBe(ROSTER.length)
    const names = ROSTER.map((r) => r.name)
    expect(new Set(names).size).toBe(names.length)
    for (const name of names) expect(WALK_IN_NAMES).not.toContain(name)
  })
})

describe('seating a table', () => {
  it('mixes rivals with about a third walk-ins, at least one when there is more than one opponent', () => {
    const rng = createRng(1)
    expect(walkInCount(5, rng)).toBe(1)
    expect(walkInCount(9, rng)).toBe(3)
    expect(walkInCount(2, rng)).toBe(1)
    for (let seed = 0; seed < 20; seed++) {
      const plan = planTable(5, createRng(seed))
      expect(plan).toHaveLength(5)
      expect(plan.filter((s) => s.kind === 'walk-in')).toHaveLength(1)
      expect(new Set(plan.map((s) => s.name)).size).toBe(5)
    }
  })

  it('seats a rival with that rival’s own fixed character', () => {
    const plan = planTable(5, createRng(3))
    for (const seat of plan) {
      if (seat.kind === 'rival') expect(seat.profile).toEqual(rivalProfile(seat.rival))
    }
  })
})

describe('saved data', () => {
  it('starts fresh from anything unrecognisable', () => {
    expect(migrateRivals(null)).toEqual(emptyRivals())
    expect(migrateRivals({ version: 7 })).toEqual(emptyRivals())
    expect(migrateRivals('junk')).toEqual(emptyRivals())
  })

  it('keeps known rivals and drops unknown ids and bad fields', () => {
    const data = migrateRivals({
      version: 1,
      rivals: {
        nadia: { ...emptyRecord(), netVsYou: 250, carryTilt: 5, stats: { hands: 'x', vpip: 3 } },
        stranger: emptyRecord(),
      },
    })
    expect(Object.keys(data.rivals)).toEqual(['nadia'])
    expect(data.rivals.nadia.netVsYou).toBe(250)
    expect(data.rivals.nadia.carryTilt).toBe(1)
    expect(data.rivals.nadia.stats.hands).toBe(0)
    expect(data.rivals.nadia.stats.vpip).toBe(3)
  })
})

describe('who took chips from whom', () => {
  it('is exact heads-up', () => {
    const net = new Map([
      ['you', 300],
      ['nadia', -300],
    ])
    expect(netBetween(net, 'you', 'nadia')).toBe(300)
    expect(netBetween(net, 'nadia', 'you')).toBe(-300)
  })

  it('multiway, splits a winner’s gain across the losers by what each lost', () => {
    const net = new Map([
      ['you', 400],
      ['a', -100],
      ['b', -300],
      ['c', 0],
    ])
    expect(netBetween(net, 'you', 'a')).toBe(100)
    expect(netBetween(net, 'you', 'b')).toBe(300)
    expect(netBetween(net, 'you', 'c')).toBe(0)
  })

  it('splits a loss across the winners the same way', () => {
    const net = new Map([
      ['you', -200],
      ['a', 150],
      ['b', 50],
    ])
    expect(netBetween(net, 'you', 'a')).toBe(-150)
    expect(netBetween(net, 'you', 'b')).toBe(-50)
  })
})

/** Deals one hand among three players, each acting from a fixed script until it runs out, then checking or folding. */
function scriptedHand(scripts: Record<string, PokerAction['type'][]>): GameState {
  const players = ['p0', 'p1', 'p2'].map((id) => ({ id, name: id, stack: 1000 }))
  const engine = new HoldemEngine(players, { smallBlind: 5, bigBlind: 10, ante: 0 }, createRng(4))
  engine.startHand()
  let guard = 0
  while (engine.state.handInProgress && guard++ < 50) {
    const actor = engine.state.players[engine.state.currentPlayerIndex]
    const next = scripts[actor.id]?.shift()
    const toCall = engine.state.currentBet - actor.betThisStreet
    const type = next ?? (toCall > 0 ? 'fold' : 'check')
    const amount = type === 'raise' || type === 'bet' ? engine.state.currentBet + engine.state.minRaise : undefined
    engine.act({ playerId: actor.id, type, amount })
  }
  return engine.state
}

describe('reading one hand', () => {
  it('counts a preflop raise as a hand played and raised, and a fold to it as a fold to a bet', () => {
    const state = scriptedHand({ p0: ['raise'], p1: ['fold'], p2: ['fold'] })
    const raiser = handStats(state, 'p0')
    expect(raiser).toMatchObject({ hands: 1, vpip: 1, pfr: 1, aggressive: 1 })
    // Whoever didn't raise first faced a bet and folded to it.
    const folds = ['p1', 'p2'].map((id) => handStats(state, id))
    for (const s of folds) {
      expect(s.vpip).toBe(0)
      expect(s.facedBet).toBe(1)
      expect(s.foldedToBet).toBe(1)
    }
  })

  it('balances: what every player won and lost adds up to nothing', () => {
    const state = scriptedHand({ p0: ['raise'], p1: ['call'], p2: ['fold'] })
    const net = handNet(state)
    expect([...net.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(0)
  })
})

/**
 * Plays a solo Career session the way the table does: seat p0 is "you", the
 * rest follow `plan`. HeuristicBot drives the decisions for speed; the
 * PsychBots are only there to be read (tilt) and seated (pre-tilt).
 */
function playSession(data: RivalsData, plan: SeatPlan[], hands: number, seed: number) {
  const saved: RivalsData[] = []
  const session = new RivalSession(data, plan, 1000, (d) => saved.push(d))
  const players = [{ id: 'p0', name: 'You', stack: 1000 }, ...session.seats.map((s, i) => ({ id: `p${i + 1}`, name: s.name, stack: 1000 }))]
  const engine = new HoldemEngine(players, { smallBlind: 5, bigBlind: 10, ante: 0 }, createRng(seed))
  const opponentModel = new OpponentModel()
  const botSeats = session.seats.map((s, i) => ({ id: `p${i + 1}`, bot: new PsychBot(s.profile, 1000, createRng(seed + i), opponentModel) }))
  const hooks = { opponentModel, humanIds: ['p0'], botSeats }
  session.seated(hooks)
  const drivers = Object.fromEntries(players.map((p, i) => [p.id, new HeuristicBot(createRng(seed * 7 + i))]))

  let played = 0
  while (played < hands && engine.canStartHand()) {
    engine.startHand()
    while (engine.state.handInProgress) {
      const actor = engine.state.players[engine.state.currentPlayerIndex]
      const action = drivers[actor.id].decideAction(buildObservation(engine, actor.id))
      opponentModel.observe(action, actionContext(engine.state, actor.id))
      engine.act(action)
    }
    played++
    session.handEnded(engine.state, hooks)
    // A repeated call for the same finished hand changes nothing.
    session.handEnded(engine.state, hooks)
  }
  return { session, saved, opponentModel, botSeats, played, engine }
}

const TWO_RIVALS: SeatPlan[] = [ROSTER[0], ROSTER[4]].map((rival) => ({
  kind: 'rival' as const,
  rival,
  profile: rivalProfile(rival),
  name: rival.name,
}))

describe('a session with rivals', () => {
  it('remembers every hand each rival played, the chips between you, and their read on you', () => {
    const { session, saved, played } = playSession(emptyRivals(), TWO_RIVALS, 40, 11)
    const data = session.snapshot
    expect(saved.length).toBe(played)
    for (const seat of TWO_RIVALS) {
      if (seat.kind !== 'rival') continue
      const record = data.rivals[seat.rival.id]
      expect(record.sessions).toBe(1)
      expect(record.stats.hands).toBeGreaterThan(0)
      expect(record.stats.hands).toBeLessThanOrEqual(played)
      expect(record.readOnYou?.players.hero).toBeDefined()
    }
  })

  it('books your net against rivals from the same chips that moved at the table', () => {
    const { session, engine } = playSession(emptyRivals(), TWO_RIVALS, 30, 5)
    // With only rivals seated, what you won from them is exactly what you won.
    const total = TWO_RIVALS.reduce((sum, seat) => sum + (seat.kind === 'rival' ? session.snapshot.rivals[seat.rival.id].netVsYou : 0), 0)
    const you = engine.state.players.find((p) => p.id === 'p0')!
    expect(you.stack).not.toBe(1000)
    expect(total).toBeCloseTo(you.stack - 1000, 0)
  })

  it('brings a saved read back faded, averaged across the rivals who saved it', () => {
    const read: OpponentModelData = {
      version: 1,
      players: {
        hero: {
          tallies: {
            headsUp: { aggressive: 10, total: 20, facingBet: 10, foldedToBet: 5, checkedTo: 0, betWhenCheckedTo: 0, facedPostflop: 0, postflop: { fold: 0, call: 0, raise: 0 }, sizedBets: 0, largeBets: 0 },
            multiway: { aggressive: 0, total: 0, facingBet: 0, foldedToBet: 0, checkedTo: 0, betWhenCheckedTo: 0, facedPostflop: 0, postflop: { fold: 0, call: 0, raise: 0 }, sizedBets: 0, largeBets: 0 },
          },
        },
      },
    }
    const data: RivalsData = { version: 1, rivals: {} }
    for (const seat of TWO_RIVALS) if (seat.kind === 'rival') data.rivals[seat.rival.id] = { ...emptyRecord(), readOnYou: read }
    const session = new RivalSession(data, TWO_RIVALS, 1000)
    const opponentModel = new OpponentModel()
    const botSeats = TWO_RIVALS.map((s, i) => ({ id: `p${i + 1}`, bot: new PsychBot(s.profile, 1000, createRng(i), opponentModel) }))
    session.seated({ opponentModel, humanIds: ['p0'], botSeats })
    const restored = opponentModel.toJSON(['p0']).players.p0.tallies.headsUp
    // Two rivals, each carrying the same 20 actions: averaged, then faded by 0.7.
    expect(restored.total).toBeCloseTo(14)
    expect(restored.aggressive).toBeCloseTo(7)
  })

  it('seats a rival who left steaming already tilted, and a calm one calm', () => {
    const [hot] = TWO_RIVALS
    if (hot.kind !== 'rival') throw new Error('expected a rival')
    const data: RivalsData = { version: 1, rivals: { [hot.rival.id]: { ...emptyRecord(), carryTilt: 1 } } }
    const session = new RivalSession(data, TWO_RIVALS, 1000)
    const opponentModel = new OpponentModel()
    const botSeats = TWO_RIVALS.map((s, i) => ({ id: `p${i + 1}`, bot: new PsychBot(s.profile, 1000, createRng(i), opponentModel) }))
    session.seated({ opponentModel, humanIds: ['p0'], botSeats })
    expect(botSeats[0].bot.tiltLevel).toBeGreaterThan(0)
    expect(botSeats[1].bot.tiltLevel).toBe(0)
  })

  it('keeps no memory of you at a pass-and-play table, only public stats', () => {
    const session = new RivalSession(emptyRivals(), TWO_RIVALS, 1000)
    const opponentModel = new OpponentModel()
    const botSeats = TWO_RIVALS.map((s, i) => ({ id: `p${i + 2}`, bot: new PsychBot(s.profile, 1000, createRng(i), opponentModel) }))
    const state = scriptedHand({ p0: ['raise'], p1: ['call'], p2: ['call'] })
    const hooks = { opponentModel, humanIds: ['p0', 'p1'], botSeats: botSeats.slice(0, 1).map((s) => ({ ...s, id: 'p2' })) }
    session.seated(hooks)
    const data = session.handEnded(state, hooks)
    const record = Object.values(data.rivals)[0]
    expect(record.stats.hands).toBe(1)
    expect(record.readOnYou).toBeNull()
    expect(record.netVsYou).toBe(0)
  })

  it('leaves a walk-in out of the saved data', () => {
    const plan: SeatPlan[] = [
      TWO_RIVALS[0],
      { kind: 'walk-in', name: 'Sam', profile: HOTHEAD },
    ]
    const { session } = playSession(emptyRivals(), plan, 10, 2)
    expect(Object.keys(session.snapshot.rivals)).toEqual([ROSTER[0].id])
  })
})

describe('scouting notes', () => {
  const rival = ROSTER[0]

  it('say nothing until enough has been seen', () => {
    expect(scoutingNote(rival, undefined)).toBeNull()
    const record = emptyRecord()
    record.stats.hands = SCOUTING_MIN_HANDS - 1
    expect(scoutingNote(rival, record)).toBeNull()
  })

  it('read like notes once there is something to say', () => {
    const record = emptyRecord()
    record.stats = { ...record.stats, hands: 100, vpip: 41, pfr: 18, facedBet: 40, foldedToBet: 20, riverBetsShown: 5, riverBluffsShown: 3 }
    record.netVsYou = -420
    expect(scoutingNote(rival, record)).toBe(
      `${rival.name}: plays 41% of hands, raises 18% before the flop, folds to 50% of bets, 3 of 5 river bets you've seen were bluffs, you're −$420 against ${rival.name}.`,
    )
  })
})
