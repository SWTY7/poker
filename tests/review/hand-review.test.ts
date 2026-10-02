import { describe, expect, it } from 'vitest'
import { HoldemEngine } from '../../src/poker/game-engine'
import { buildObservation } from '../../src/ai/observation'
import { HeuristicBot } from '../../src/ai/heuristic-bot'
import { PsychBot } from '../../src/ai/psychology/psych-bot'
import { OpponentModel, actionContext } from '../../src/ai/psychology/opponent-model'
import { PRO } from '../../src/ai/psychology/profile'
import { createRng } from '../../src/utils/random'
import { HandLogger, type HandRecord } from '../../src/review/log'
import {
  describeMix,
  describeMove,
  kindWord,
  parseCardCode,
  reviewHand,
  verdictOf,
} from '../../src/review/hand-review'

/**
 * Three-handed, blinds 1/2. p1 opens to 6, p2 calls, the hero (p0, big
 * blind, aces) re-raises to 20, p1 folds, p2 calls. Flop K72: hero bets 30,
 * p2 calls. Turn: hero checks, p2 checks. River: p2 bets 50, hero calls.
 */
function handOfAces(): HandRecord {
  return {
    id: 't-1',
    session: 't',
    at: 0,
    player: 'p0',
    position: 'BB',
    players: 3,
    bigBlind: 2,
    startStack: 200,
    cards: ['As', 'Ah'],
    board: ['Kd', '7c', '2h', '9s', '3d'],
    actions: [
      { player: 'p1', type: 'raise', amount: 6, street: 'preflop' },
      { player: 'p2', type: 'call', street: 'preflop' },
      { player: 'p0', type: 'raise', amount: 20, street: 'preflop' },
      { player: 'p1', type: 'fold', street: 'preflop' },
      { player: 'p2', type: 'call', street: 'preflop' },
      { player: 'p0', type: 'bet', amount: 30, street: 'flop' },
      { player: 'p2', type: 'call', street: 'flop' },
      { player: 'p0', type: 'check', street: 'turn' },
      { player: 'p2', type: 'check', street: 'turn' },
      { player: 'p2', type: 'bet', amount: 50, street: 'river' },
      { player: 'p0', type: 'call', street: 'river' },
    ],
    decisions: [
      {
        index: 2,
        street: 'preflop',
        pot: 15,
        toCall: 4,
        stack: 198,
        book: { fold: 0, passive: 0.15, aggressive: 0.85 },
        pro: { type: 'raise', amount: 24 },
      },
      {
        index: 5,
        street: 'flop',
        pot: 46,
        toCall: 0,
        stack: 180,
        pro: { type: 'check' },
      },
      { index: 7, street: 'turn', pot: 106, toCall: 0, stack: 150 },
      {
        index: 10,
        street: 'river',
        pot: 156,
        toCall: 50,
        stack: 150,
        book: { fold: 0.95, passive: 0.04, aggressive: 0.01 },
        pro: { type: 'call' },
      },
    ],
    net: 103,
    showdown: true,
    won: true,
  }
}

describe('reviewing a hand', () => {
  const review = reviewHand(handOfAces(), { rng: createRng(7), samples: 4000 })
  const [preflop, flop, turn, river] = review.decisions

  it('goes over every decision, with the board as it was then', () => {
    expect(review.decisions).toHaveLength(4)
    expect(preflop.board).toEqual([])
    expect(flop.board).toEqual(['Kd', '7c', '2h'])
    expect(turn.board).toHaveLength(4)
    expect(river.board).toHaveLength(5)
  })

  it('counts only the opponents still in', () => {
    expect(preflop.opponents).toBe(2)
    expect(flop.opponents).toBe(1)
    expect(river.opponents).toBe(1)
  })

  it('says what you did and what the solve does, in a player’s words', () => {
    expect(preflop.youSaid).toBe('raised to $20')
    expect(preflop.bookSaid).toBe('raise 85%, call 15%')
    expect(flop.youSaid).toBe('bet $30')
    expect(turn.youSaid).toBe('checked')
    expect(river.youSaid).toBe('called $50')
    expect(river.bookSaid).toBe('fold 95%, call 4%, raise 1%')
  })

  it('judges each decision against the solve, and only where one applies', () => {
    expect(preflop.verdict).toBe('book')
    expect(flop.verdict).toBe('none')
    expect(turn.verdict).toBe('none')
    expect(river.verdict).toBe('off')
    expect(review.covered).toBe(2)
    expect(review.offBook).toBe(1)
  })

  it('puts the pro next to you, and says when you agree', () => {
    expect(preflop.proSaid).toBe('would raise to $24')
    expect(preflop.proAgrees).toBe(true)
    expect(flop.proSaid).toBe('would check')
    expect(flop.proAgrees).toBe(false)
    expect(turn.proSaid).toBeUndefined()
    expect(river.proSaid).toBe('would call $50')
  })

  it('gives aces their equity against random hands', () => {
    // Aces against two random hands win about 73%; on K-7-2 against one, about 90%.
    expect(preflop.equity).toBeGreaterThan(0.68)
    expect(preflop.equity).toBeLessThan(0.78)
    expect(flop.equity).toBeGreaterThan(0.85)
  })

  it('skips the equity when it isn’t wanted', () => {
    expect(reviewHand(handOfAces(), { equity: false }).decisions.every((d) => d.equity === null)).toBe(true)
  })
})

describe('words for actions', () => {
  it('names a kind by what is owed', () => {
    expect(kindWord('passive', 0, 'flop')).toBe('check')
    expect(kindWord('passive', 10, 'flop')).toBe('call')
    expect(kindWord('aggressive', 0, 'flop')).toBe('bet')
    expect(kindWord('aggressive', 0, 'preflop')).toBe('raise')
  })

  it('leaves out what the solve never does', () => {
    expect(describeMix({ fold: 0, passive: 0.3, aggressive: 0.7 }, 0, 'turn')).toBe('bet 70%, check 30%')
  })

  it('tells an all in that only calls from one that raises', () => {
    expect(describeMove({ type: 'all-in', amount: 40 }, 60, 'river', 100, 'past')).toBe('called all in')
    expect(describeMove({ type: 'all-in', amount: 400 }, 60, 'river', 100, 'would')).toBe('would go all in')
  })

  it('reads its own card codes back', () => {
    expect(parseCardCode('Td')).toEqual({ rank: 'T', suit: 'diamonds' })
  })

  it('calls the most frequent kind the book play, and a rare one off it', () => {
    const mix = { fold: 0.05, passive: 0.6, aggressive: 0.35 }
    expect(verdictOf(mix, 'passive')).toBe('book')
    expect(verdictOf(mix, 'aggressive')).toBe('mixed')
    expect(verdictOf(mix, 'fold')).toBe('off')
  })
})

describe('the professional at your shoulder', () => {
  it('is logged at each decision and reviewed end to end', { timeout: 30_000 }, () => {
    const setup = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, stack: 400 }))
    const engine = new HoldemEngine(setup, { smallBlind: 1, bigBlind: 2, ante: 0 }, createRng(3))
    const bots = setup.map((_, i) => new HeuristicBot(createRng(30 + i)))
    const model = new OpponentModel()
    const logger = new HandLogger('p0', 'pro')
    let reviewed = 0
    for (let h = 0; h < 25 && engine.canStartHand(); h++) {
      engine.startHand()
      logger.startHand(engine.state)
      while (engine.state.handInProgress) {
        const actor = engine.state.players[engine.state.currentPlayerIndex]
        const observation = buildObservation(engine, actor.id)
        const action = bots[Number(actor.id.slice(1))].decideAction(observation)
        if (actor.id === 'p0') {
          const pro = new PsychBot(PRO, 400, createRng(h), model).decideAction(observation)
          logger.decision(engine.state, action, null, pro)
        }
        model.observe(action, actionContext(engine.state, actor.id))
        engine.act(action)
      }
      const record = logger.endHand(engine.state)
      if (!record) continue
      expect(record.decisions.every((d) => d.pro !== undefined)).toBe(true)
      const review = reviewHand(record, { samples: 300, rng: createRng(h) })
      expect(review.decisions).toHaveLength(record.decisions.length)
      for (const d of review.decisions) {
        expect(d.proSaid).toMatch(/^would /)
        expect(d.equity).toBeGreaterThanOrEqual(0)
        expect(d.equity).toBeLessThanOrEqual(1)
        reviewed++
      }
    }
    expect(reviewed).toBeGreaterThan(10)
  })

  it('teaches the table nothing by being asked', () => {
    const setup = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, stack: 200 }))
    const engine = new HoldemEngine(setup, { smallBlind: 1, bigBlind: 2, ante: 0 }, createRng(11))
    const model = new OpponentModel()
    engine.startHand()
    const opener = new HeuristicBot(createRng(1))
    for (let i = 0; i < 2 && engine.state.handInProgress; i++) {
      const actor = engine.state.players[engine.state.currentPlayerIndex]
      const action = opener.decideAction(buildObservation(engine, actor.id))
      model.observe(action, actionContext(engine.state, actor.id))
      engine.act(action)
    }
    const before = JSON.stringify(model.toJSON())
    const actor = engine.state.players[engine.state.currentPlayerIndex]
    new PsychBot(PRO, 200, createRng(2), model).decideAction(buildObservation(engine, actor.id))
    expect(JSON.stringify(model.toJSON())).toBe(before)
  })
})
