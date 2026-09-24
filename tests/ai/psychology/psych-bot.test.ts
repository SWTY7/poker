import { describe, expect, it } from 'vitest'
import { HoldemEngine } from '../../../src/poker/game-engine'
import { buildObservation } from '../../../src/ai/observation'
import type { AIObservation } from '../../../src/ai/observation'
import { PsychBot } from '../../../src/ai/psychology/psych-bot'
import { OpponentModel } from '../../../src/ai/psychology/opponent-model'
import { AVERAGE_HUMAN, CAST, LOSS_AVERSE, RATIONAL } from '../../../src/ai/psychology/profile'
import { HUMAN_TILT } from '../../../src/ai/psychology/tilt'
import { committedPot, streetBetTotal, totalPot } from '../../../src/poker/pot'
import { createRng } from '../../../src/utils/random'
import type { Card } from '../../../src/poker/card'

const card = (spec: string): Card => ({
  rank: spec.slice(0, -1) as Card['rank'],
  suit: { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }[spec.slice(-1)] as Card['suit'],
})

/**
 * One river spot, built by hand so the only thing that varies between bots is
 * the bot. The hero holds a bluff-catcher facing 75 into 100 — a fold at
 * 30% pot odds for anybody actually counting.
 */
function riverSpot(stack: number): AIObservation {
  return {
    playerId: 'hero',
    ownCards: [card('9d'), card('9c')],
    communityCards: [card('Ah'), card('Kd'), card('7s'), card('4c'), card('2h')],
    potSize: 175,
    players: [
      { id: 'hero', stack, betThisStreet: 0, folded: false, isAllIn: false },
      { id: 'villain', stack: 1000, betThisStreet: 75, folded: false, isAllIn: false },
    ],
    legalActions: ['fold', 'call', 'raise'],
    street: 'river',
    currentBet: 75,
    toCall: 75,
    minRaiseTo: 150,
    maxRaiseTo: stack,
    actionHistory: [{ playerId: 'villain', type: 'bet', amount: 75 }],
  }
}

/** How often this bot puts money in rather than folding, over many deals. */
function continueRate(bot: PsychBot, observation: AIObservation, trials = 60): number {
  let continued = 0
  for (let i = 0; i < trials; i++) {
    if (bot.decideAction(observation).type !== 'fold') continued++
  }
  return continued / trials
}

/**
 * Plays whole sessions through the engine, exactly as the UI drives it. The
 * point is not that the bots play well — several of them are supposed not to
 * — but that nothing they do violates the rules or loses a chip.
 */
function playSession(seed: number, hands: number) {
  const count = 6
  const startingStack = 1000
  const players = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, name: `P${i}`, stack: startingStack }))
  const engine = new HoldemEngine(players, { smallBlind: 5, bigBlind: 10, ante: 0 }, createRng(seed))
  const bots = players.map((_, i) => new PsychBot(CAST[i % CAST.length], startingStack, createRng(seed * 31 + i)))
  const byId = new Map(players.map((p, i) => [p.id, bots[i]]))

  let played = 0
  const actions: Record<string, number> = {}

  while (engine.canStartHand() && played < hands) {
    engine.startHand()
    played++

    let guard = 0
    while (engine.state.handInProgress) {
      expect(guard++).toBeLessThan(500)
      const actor = engine.state.players[engine.state.currentPlayerIndex]
      expect(actor.folded).toBe(false)
      expect(actor.isAllIn).toBe(false)
      expect(committedPot(engine.state.players) + streetBetTotal(engine.state.players)).toBe(
        totalPot(engine.state.players),
      )

      const observation = buildObservation(engine, actor.id)
      const action = byId.get(actor.id)!.decideAction(observation)
      expect(observation.legalActions).toContain(action.type)
      actions[action.type] = (actions[action.type] ?? 0) + 1
      engine.act(action)
    }

    expect(engine.state.players.reduce((sum, p) => sum + p.stack, 0)).toBe(count * startingStack)

    const results = engine.state.lastResults
    const potSize = results.reduce((sum, r) => sum + r.potAmount, 0)
    for (const player of engine.state.players) {
      const won = results.reduce(
        (sum, r) => sum + (r.winnerIds.includes(player.id) ? r.potAmount / r.winnerIds.length : 0),
        0,
      )
      byId.get(player.id)!.observeResult({ stack: player.stack, shareWon: potSize ? won / potSize : 0, potSize })
    }
  }

  return { played, actions, bots }
}

describe('a table of them plays real poker', () => {
  it('never breaks a rule or loses a chip, across several seeds', { timeout: 60_000 }, () => {
    for (const seed of [1, 7, 42, 1234]) {
      const { played } = playSession(seed, 25)
      expect(played).toBeGreaterThan(0)
    }
  })

  it('does all five things a poker player does, not two of them', { timeout: 60_000 }, () => {
    // A bot that only ever folds or shoves is the usual failure here, and it
    // is invisible unless something counts. Every action has to show up, and
    // hands have to reach a flop often enough for postflop to exist at all.
    const { actions } = playSession(7, 40)
    for (const type of ['fold', 'call', 'raise', 'check', 'bet']) {
      expect(actions[type] ?? 0).toBeGreaterThan(0)
    }
    const aggressive = (actions.bet ?? 0) + (actions.raise ?? 0)
    const passive = (actions.call ?? 0) + (actions.check ?? 0)
    // Neither a maniac nor a calling station: aggression somewhere in the
    // region real players live in.
    expect(aggressive / passive).toBeGreaterThan(0.25)
    expect(aggressive / passive).toBeLessThan(2.5)
  })

  it('plays the same session twice from the same seed', () => {
    const first = playSession(99, 12)
    const second = playSession(99, 12)
    expect(second.actions).toEqual(first.actions)
  })
})

describe('the biases show up at the table, not just in the formulas', () => {
  it('has the loss-averse bot fold what the rational one calls', () => {
    const spot = riverSpot(1000)
    const rational = new PsychBot(RATIONAL, 1000, createRng(5))
    const scared = new PsychBot(LOSS_AVERSE, 1000, createRng(5))
    expect(continueRate(scared, spot)).toBeLessThan(continueRate(rational, spot))
  })

  it('calls wider when stuck than when even — the same hand, the same price', () => {
    // Nothing about the cards or the odds differs between these two. Only
    // where the player is measuring from.
    const even = new PsychBot(AVERAGE_HUMAN, 1000, createRng(11))
    const stuck = new PsychBot(AVERAGE_HUMAN, 1000, createRng(11))
    // Put the second one 600 chips down, which is what the observation's own
    // stack tells the bot.
    expect(continueRate(stuck, riverSpot(400))).toBeGreaterThan(continueRate(even, riverSpot(1000)))
  })

  it('is unmoved by any of it when every distortion is switched off', () => {
    const control = new PsychBot(RATIONAL, 1000, createRng(3))
    const stuckControl = new PsychBot(RATIONAL, 1000, createRng(3))
    expect(continueRate(stuckControl, riverSpot(400))).toBeCloseTo(continueRate(control, riverSpot(1000)), 10)
  })
})

describe('a learned read on a specific opponent', () => {
  it('calls a known-aggressive villain wider than an unknown one, same hand and price', () => {
    const spot = riverSpot(1000)
    const noRead = new PsychBot(AVERAGE_HUMAN, 1000, createRng(13))

    const knowsVillain = new OpponentModel()
    for (let i = 0; i < 40; i++) knowsVillain.observe({ playerId: 'villain', type: 'raise' })
    const readsVillain = new PsychBot(AVERAGE_HUMAN, 1000, createRng(13), knowsVillain)

    expect(continueRate(readsVillain, spot)).toBeGreaterThan(continueRate(noRead, spot))
  })

  it('does nothing until the opponent model has enough of a sample to say anything', () => {
    const spot = riverSpot(1000)
    const noRead = new PsychBot(AVERAGE_HUMAN, 1000, createRng(13))

    const barelySeen = new OpponentModel()
    barelySeen.observe({ playerId: 'villain', type: 'raise' })
    const readsVillain = new PsychBot(AVERAGE_HUMAN, 1000, createRng(13), barelySeen)

    expect(continueRate(readsVillain, spot)).toBe(continueRate(noRead, spot))
  })

  it('gives a known-passive villain no extra credit for bluffing', () => {
    const spot = riverSpot(1000)
    const noRead = new PsychBot(AVERAGE_HUMAN, 1000, createRng(13))

    const passiveVillain = new OpponentModel()
    for (let i = 0; i < 40; i++) passiveVillain.observe({ playerId: 'villain', type: 'call' })
    const readsVillain = new PsychBot(AVERAGE_HUMAN, 1000, createRng(13), passiveVillain)

    expect(continueRate(readsVillain, spot)).toBeLessThanOrEqual(continueRate(noRead, spot))
  })
})

describe('position shapes what an unacted opponent is believed to hold', () => {
  /**
   * Hero opens facing only the big blind — nobody has voluntarily acted, so
   * the blind itself is `read.unknown`, the exact case OPEN_PERCENT exists
   * for (see readOpponents's own comment: a blind isn't information, only
   * voluntary action is). Nothing about the hand or the price changes
   * between calls; only the still-to-act blind's seat does.
   */
  function unactedSpot(position: AIObservation['players'][number]['position']): AIObservation {
    return {
      playerId: 'hero',
      ownCards: [card('Kd'), card('Th')],
      communityCards: [],
      potSize: 15,
      players: [
        { id: 'hero', stack: 1000, betThisStreet: 0, folded: false, isAllIn: false, position: 'MP' },
        { id: 'villain', stack: 1000, betThisStreet: 10, folded: false, isAllIn: false, position },
      ],
      legalActions: ['fold', 'call', 'raise'],
      street: 'preflop',
      currentBet: 10,
      toCall: 10,
      minRaiseTo: 20,
      maxRaiseTo: 1000,
      actionHistory: [],
      bigBlind: 10,
    }
  }

  it('reads a still-to-act UTG seat as a tighter range than a still-to-act button', () => {
    const vsUtg = new PsychBot(AVERAGE_HUMAN, 1000, createRng(21))
    const vsButton = new PsychBot(AVERAGE_HUMAN, 1000, createRng(21))
    const raises = (bot: PsychBot, spot: AIObservation, trials = 300) => {
      let count = 0
      for (let i = 0; i < trials; i++) if (bot.decideAction(spot).type === 'raise') count++
      return count / trials
    }
    expect(raises(vsButton, unactedSpot('BTN'))).toBeGreaterThan(raises(vsUtg, unactedSpot('UTG')))
  })

  it('does not apply the preflop opening chart postflop', () => {
    // Same mechanism (an unacted opponent), wrong street: OPEN_PERCENT
    // describes opening a pot preflop, not "hasn't bet this street yet" on a
    // later one — a tight UTG range on the flop would just be wrong, so this
    // stays a no-op there regardless of which position is on the seat.
    const flopSpot = (position: AIObservation['players'][number]['position']): AIObservation => ({
      playerId: 'hero',
      ownCards: [card('Kd'), card('Th')],
      communityCards: [card('9c'), card('4h'), card('2s')],
      potSize: 30,
      players: [
        { id: 'hero', stack: 1000, betThisStreet: 0, folded: false, isAllIn: false, position: 'BB' },
        { id: 'villain', stack: 1000, betThisStreet: 0, folded: false, isAllIn: false, position },
      ],
      legalActions: ['check', 'bet'],
      street: 'flop',
      currentBet: 0,
      toCall: 0,
      minRaiseTo: 20,
      maxRaiseTo: 1000,
      actionHistory: [],
      bigBlind: 10,
    })
    const vsUtg = new PsychBot(AVERAGE_HUMAN, 1000, createRng(5))
    const vsButton = new PsychBot(AVERAGE_HUMAN, 1000, createRng(5))
    const betRate = (bot: PsychBot, spot: AIObservation, trials = 60) => {
      let count = 0
      for (let i = 0; i < trials; i++) if (bot.decideAction(spot).type === 'bet') count++
      return count / trials
    }
    expect(betRate(vsUtg, flopSpot('UTG'))).toBe(betRate(vsButton, flopSpot('BTN')))
  })
})

describe('tilt at the table', () => {
  const badBeat = { stack: 600, shareWon: 0, potSize: 800 }

  it('rises after a beat and fades while nothing happens', () => {
    const bot = new PsychBot({ ...AVERAGE_HUMAN, tilt: HUMAN_TILT }, 1000, createRng(2))
    // Be in the hand first. A pot this bot called for is a pot it can be
    // beaten out of.
    expect(bot.decideAction(riverSpot(400)).type).not.toBe('fold')
    expect(bot.tiltLevel).toBe(0)
    bot.observeResult(badBeat)
    const jolted = bot.tiltLevel
    expect(jolted).toBeGreaterThan(0)

    for (let i = 0; i < 10; i++) bot.observeResult({ stack: 600, shareWon: 0, potSize: 0 })
    expect(bot.tiltLevel).toBeLessThan(jolted)
  })

  it('does not tilt over a hand it folded', () => {
    // Losing a pot you were never in is not a bad beat, and a model that
    // tilts on it is measuring the scoreboard rather than the expectation.
    const bot = new PsychBot(LOSS_AVERSE, 1000, createRng(6))
    expect(bot.decideAction(riverSpot(1000)).type).toBe('fold')
    bot.observeResult(badBeat)
    expect(bot.tiltLevel).toBe(0)
  })

  it('loosens the bot up, which is what tilt looks like from across the table', () => {
    const spot = riverSpot(1000)
    const calm = new PsychBot(AVERAGE_HUMAN, 1000, createRng(8))
    const steaming = new PsychBot(AVERAGE_HUMAN, 1000, createRng(8))
    for (let i = 0; i < 6; i++) {
      steaming.decideAction(riverSpot(400))
      steaming.observeResult({ stack: 400, shareWon: 0, potSize: 900 })
    }
    expect(steaming.tiltLevel).toBeGreaterThan(1)
    // Same seat, same stack, same bet, same cards. The one that has been run
    // over calls and the one that has not folds.
    expect(continueRate(calm, spot)).toBe(0)
    expect(continueRate(steaming, spot)).toBeGreaterThan(0)
  })

  it('leaves a stoic profile at zero however the hands go', () => {
    const bot = new PsychBot(RATIONAL, 1000, createRng(4))
    for (let i = 0; i < 20; i++) {
      bot.decideAction(riverSpot(1000))
      bot.observeResult({ stack: 200, shareWon: 0, potSize: 1500 })
    }
    expect(bot.tiltLevel).toBe(0)
  })
})
