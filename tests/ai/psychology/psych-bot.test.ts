import { describe, expect, it } from 'vitest'
import { HoldemEngine } from '../../../src/poker/game-engine'
import { buildObservation } from '../../../src/ai/observation'
import type { AIObservation } from '../../../src/ai/observation'
import { PsychBot, type Fundamentals } from '../../../src/ai/psychology/psych-bot'
import { OpponentModel } from '../../../src/ai/psychology/opponent-model'
import { AVERAGE_HUMAN, CAST, LOSS_AVERSE, RATIONAL, type PsychProfile } from '../../../src/ai/psychology/profile'
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
 * the bot. The hero holds 99 on A-K-7-4-2 — a pure bluff-catcher, beating
 * only bluffs — facing a bet into 100. At the default 75 a calm bot folds
 * every time, which leaves room for a real reason to believe in bluffs (a
 * read on an aggressive villain, tilt) to tip it into calling. At 40 a calm
 * bot calls most of the time, which leaves room for a reason to believe in
 * *fewer* bluffs (a read on a passive villain) to tip it the other way.
 */
function riverSpot(stack: number, bet = 75): AIObservation {
  return {
    playerId: 'hero',
    ownCards: [card('9d'), card('9c')],
    communityCards: [card('Ah'), card('Kd'), card('7s'), card('4c'), card('2h')],
    potSize: 100 + bet,
    players: [
      { id: 'hero', stack, betThisStreet: 0, folded: false, isAllIn: false },
      { id: 'villain', stack: 1000, betThisStreet: bet, folded: false, isAllIn: false },
    ],
    legalActions: ['fold', 'call', 'raise'],
    street: 'river',
    currentBet: bet,
    toCall: bet,
    minRaiseTo: bet * 2,
    maxRaiseTo: stack,
    actionHistory: [{ playerId: 'villain', type: 'bet', amount: bet }],
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
    for (let i = 0; i < 40; i++) knowsVillain.observe({ playerId: 'villain', type: 'raise' }, { playersInHand: 2, facingBet: false })
    const readsVillain = new PsychBot(AVERAGE_HUMAN, 1000, createRng(13), knowsVillain)

    expect(continueRate(readsVillain, spot)).toBeGreaterThan(continueRate(noRead, spot))
  })

  it('barely moves on one action, and moves more the more it has seen', () => {
    // Confidence grows with evidence (opponent-model.ts) — one raise is a
    // nudge, forty are a read.
    const spot = riverSpot(1000)
    const once = new OpponentModel()
    once.observe({ playerId: 'villain', type: 'raise' }, { playersInHand: 2, facingBet: false })
    const often = new OpponentModel()
    for (let i = 0; i < 40; i++) often.observe({ playerId: 'villain', type: 'raise' }, { playersInHand: 2, facingBet: false })
    const noRead = continueRate(new PsychBot(AVERAGE_HUMAN, 1000, createRng(13)), spot, 200)
    const onceRate = continueRate(new PsychBot(AVERAGE_HUMAN, 1000, createRng(13), once), spot, 200)
    const oftenRate = continueRate(new PsychBot(AVERAGE_HUMAN, 1000, createRng(13), often), spot, 200)
    expect(onceRate - noRead).toBeLessThan(oftenRate - noRead)
  })

  it('folds more to a known-passive villain, whose bets are value', () => {
    const spot = riverSpot(1000, 40)
    const noRead = new PsychBot(AVERAGE_HUMAN, 1000, createRng(13))

    const passiveVillain = new OpponentModel()
    for (let i = 0; i < 40; i++) passiveVillain.observe({ playerId: 'villain', type: 'call' }, { playersInHand: 2, facingBet: true })
    const readsVillain = new PsychBot(AVERAGE_HUMAN, 1000, createRng(13), passiveVillain)

    expect(continueRate(readsVillain, spot, 200)).toBeLessThan(continueRate(noRead, spot, 200))
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

describe('the believed range bends around the actual board', () => {
  /** A set of 7s, facing a lone caller — the exact case continuingRange() feeds. */
  function setOfSevensSpot(board: AIObservation['communityCards']): AIObservation {
    return {
      playerId: 'hero',
      ownCards: [card('7c'), card('7d')],
      communityCards: board,
      potSize: 60,
      players: [
        { id: 'hero', stack: 1000, betThisStreet: 0, folded: false, isAllIn: false, position: null },
        { id: 'villain', stack: 1000, betThisStreet: 0, folded: false, isAllIn: false, position: null },
      ],
      legalActions: ['check', 'bet'],
      street: 'flop',
      currentBet: 0,
      toCall: 0,
      minRaiseTo: 20,
      maxRaiseTo: 1000,
      actionHistory: [{ playerId: 'villain', type: 'call', amount: 10 }],
      bigBlind: 10,
    }
  }

  it('reads a wet, coordinated board differently from a dry, disconnected one — same hand, same price', { timeout: 30_000 }, () => {
    // Both give hero a made set; only how connected the other two cards are
    // changes. topSlice(CONTINUING_WIDTH) alone cannot tell these apart —
    // "the top 45% of all starting hands" is the identical 1326-combo set
    // either way. Pooled across several seeds and enough trials each to
    // move past single-seed noise, this bets the wet board measurably more
    // than the dry one, holding the hand and the price fixed.
    const dryBoard = [card('7s'), card('2d'), card('9c')]
    const wetBoard = [card('7s'), card('9h'), card('8h')]
    const betCount = (board: AIObservation['communityCards'], seed: number, trials: number) => {
      const bot = new PsychBot(AVERAGE_HUMAN, 1000, createRng(seed))
      const spot = setOfSevensSpot(board)
      let count = 0
      for (let i = 0; i < trials; i++) if (bot.decideAction(spot).type === 'bet') count++
      return count
    }
    const trialsPerSeed = 600
    const seeds = [1, 7, 42, 99, 123]
    const wetTotal = seeds.reduce((sum, seed) => sum + betCount(wetBoard, seed, trialsPerSeed), 0)
    const dryTotal = seeds.reduce((sum, seed) => sum + betCount(dryBoard, seed, trialsPerSeed), 0)
    expect(wetTotal / (seeds.length * trialsPerSeed)).toBeGreaterThan(dryTotal / (seeds.length * trialsPerSeed))
  })

  it('is exactly the flat range preflop, where there is no board to condition on', () => {
    const flopSpot = setOfSevensSpot([card('7s'), card('9h'), card('8h')])
    const preflopSpot: AIObservation = { ...flopSpot, communityCards: [], street: 'preflop' }
    const bot = new PsychBot(AVERAGE_HUMAN, 1000, createRng(3))
    // Doesn't throw or behave strangely with an empty board — boardRange()
    // falls back to topSlice() exactly, same as before this existed.
    expect(() => bot.decideAction(preflopSpot)).not.toThrow()
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

describe('a studied player leans on the solved strategy', () => {
  /** A stand-in solve that always says the same thing, so what's measured is the blending, not a blueprint. */
  const alwaysSays = (type: 'fold' | 'call'): Fundamentals => ({
    strategyFor: (obs) => [{ action: { playerId: obs.playerId, type }, probability: 1 }],
  })
  const neverAnswers: Fundamentals = { strategyFor: () => null }
  const studied = (profile: PsychProfile, discipline: number) => ({ ...profile, discipline })

  it('plays exactly as before with no discipline, whatever the solve says', () => {
    const spot = riverSpot(1000)
    const plain = new PsychBot(studied(LOSS_AVERSE, 0), 1000, createRng(21))
    const handed = new PsychBot(studied(LOSS_AVERSE, 0), 1000, createRng(21))
    handed.useFundamentals(alwaysSays('call'))
    expect(continueRate(handed, spot)).toBe(continueRate(plain, spot))
  })

  it('plays exactly as before wherever the solve has no answer', () => {
    // Multiway pots, untrained depths: the book is silent and instinct is all there is.
    const spot = riverSpot(1000)
    const plain = new PsychBot(studied(LOSS_AVERSE, 0.9), 1000, createRng(22))
    const handed = new PsychBot(studied(LOSS_AVERSE, 0.9), 1000, createRng(22))
    handed.useFundamentals(neverAnswers)
    expect(continueRate(handed, spot)).toBe(continueRate(plain, spot))
  })

  it('follows the book over its own instinct when disciplined, and less so when not', () => {
    // The loss-averse bot's instinct is to fold this river every time (see
    // the tilt tests). The solve says call. How often it calls is how much
    // it trusts what it studied over how the spot feels.
    const spot = riverSpot(1000)
    const instinct = continueRate(new PsychBot(studied(LOSS_AVERSE, 0), 1000, createRng(23)), spot)
    const rates = [0.3, 0.6, 0.95].map((discipline) => {
      const bot = new PsychBot(studied(LOSS_AVERSE, discipline), 1000, createRng(23))
      bot.useFundamentals(alwaysSays('call'))
      return continueRate(bot, spot, 200)
    })
    expect(instinct).toBe(0)
    expect(rates[0]).toBeGreaterThan(instinct)
    expect(rates[1]).toBeGreaterThan(rates[0])
    expect(rates[2]).toBeGreaterThan(rates[1])
    expect(rates[2]).toBeGreaterThan(0.85)
  })

  it('abandons the book on tilt, which is where fundamentals go first', () => {
    // The solve says fold. Calm, this player folds. Steaming, their instinct
    // says call and their discipline has worn thin enough to let it. The
    // beats come first, from earlier hands, and the book only for this
    // decision — handed the fold-only book during those hands, a
    // disciplined player would have folded them and never been beaten.
    const spot = riverSpot(1000)
    const calm = new PsychBot(studied(AVERAGE_HUMAN, 0.8), 1000, createRng(24))
    const steaming = new PsychBot(studied(AVERAGE_HUMAN, 0.8), 1000, createRng(24))
    for (let i = 0; i < 6; i++) {
      steaming.decideAction(riverSpot(400))
      steaming.observeResult({ stack: 400, shareWon: 0, potSize: 900 })
    }
    expect(steaming.tiltLevel).toBeGreaterThan(1)
    for (const bot of [calm, steaming]) bot.useFundamentals(alwaysSays('fold'))
    expect(continueRate(calm, spot, 200)).toBe(0)
    expect(continueRate(steaming, spot, 200)).toBeGreaterThan(0)
  })

  it('still hears a read on the opponent, through the instinct the book is blended with', () => {
    // The solve says fold. Without a read, this player's instinct agrees and
    // they fold every time. A read on a known-aggressive villain changes the
    // instinct to call — and the share of the decision that is still
    // instinct (1 - discipline) lets some of that through.
    const spot = riverSpot(1000)
    const knowsVillain = new OpponentModel()
    for (let i = 0; i < 40; i++) knowsVillain.observe({ playerId: 'villain', type: 'raise' }, { playersInHand: 2, facingBet: false })
    const noRead = new PsychBot(studied(AVERAGE_HUMAN, 0.8), 1000, createRng(25))
    const read = new PsychBot(studied(AVERAGE_HUMAN, 0.8), 1000, createRng(25), knowsVillain)
    for (const bot of [noRead, read]) bot.useFundamentals(alwaysSays('fold'))
    expect(continueRate(read, spot, 200)).toBeGreaterThan(continueRate(noRead, spot, 200))
  })
})
