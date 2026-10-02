import { describe, expect, it } from 'vitest'
import {
  BASELINES,
  OpponentModel,
  settingOf,
  type ActionContext,
  type ShowdownRecord,
} from '../../../src/ai/psychology/opponent-model'
import type { Card } from '../../../src/poker/card'
import type { PokerAction } from '../../../src/poker/game-state'

function action(playerId: string, type: PokerAction['type']): PokerAction {
  return { playerId, type }
}

const headsUp = (facingBet = false): ActionContext => ({ playersInHand: 2, facingBet })
const sixWay = (facingBet = false): ActionContext => ({ playersInHand: 6, facingBet })

describe('OpponentModel', () => {
  it('has no read on anyone before it has seen them', () => {
    const model = new OpponentModel()
    expect(model.aggressionBias('villain', 'headsUp')).toBe(0)
    expect(model.foldBias('villain', 'multiway')).toBe(0)
  })

  it('grows a read with evidence instead of switching one on at a cutoff', () => {
    const three = new OpponentModel()
    const forty = new OpponentModel()
    for (let i = 0; i < 3; i++) three.observe(action('villain', 'raise'), headsUp())
    for (let i = 0; i < 40; i++) forty.observe(action('villain', 'raise'), headsUp())
    const raw = 1 - BASELINES.headsUp.aggression
    expect(three.aggressionBias('villain', 'headsUp')).toBeGreaterThan(0)
    expect(three.aggressionBias('villain', 'headsUp')).toBeLessThan(raw * 0.2)
    expect(forty.aggressionBias('villain', 'headsUp')).toBeGreaterThan(raw * 0.6)
  })

  it('reads a player who only ever calls or checks as passive', () => {
    const model = new OpponentModel()
    for (let i = 0; i < 20; i++) model.observe(action('villain', i % 2 === 0 ? 'call' : 'check'), headsUp())
    expect(model.aggressionBias('villain', 'headsUp')).toBeLessThan(0)
  })

  it('judges a player against what is normal in the setting, not one number for every table', () => {
    // The same betting rate is aggressive at a full table, where people bet
    // little, and ordinary heads-up, where everyone bets a lot. A single
    // fixed baseline is exactly what once read a whole full table as
    // passive — see opponent-model.ts.
    const rate = (BASELINES.multiway.aggression + BASELINES.headsUp.aggression) / 2
    const model = new OpponentModel()
    for (let i = 0; i < 100; i++) {
      const type = i < rate * 100 ? 'bet' : 'check'
      model.observe(action('villain', type), sixWay())
      model.observe(action('villain', type), headsUp())
    }
    expect(model.aggressionBias('villain', 'multiway')).toBeGreaterThan(0)
    expect(model.aggressionBias('villain', 'headsUp')).toBeLessThan(0)
  })

  it('reads folding to bets separately, and only from spots where there was a bet to fold to', () => {
    const model = new OpponentModel()
    for (let i = 0; i < 30; i++) model.observe(action('nit', 'fold'), headsUp(true))
    for (let i = 0; i < 30; i++) model.observe(action('station', 'call'), headsUp(true))
    // Checking with nothing to call says nothing about folding.
    for (let i = 0; i < 30; i++) model.observe(action('station', 'check'), headsUp(false))
    expect(model.foldBias('nit', 'headsUp')).toBeGreaterThan(0)
    expect(model.foldBias('station', 'headsUp')).toBeLessThan(0)
  })

  it('keeps separate reads per player and per setting', () => {
    const model = new OpponentModel()
    for (let i = 0; i < 20; i++) model.observe(action('maniac', 'raise'), sixWay())
    for (let i = 0; i < 20; i++) model.observe(action('nit', 'fold'), sixWay(true))
    expect(model.aggressionBias('maniac', 'multiway')).toBeGreaterThan(model.aggressionBias('nit', 'multiway'))
    expect(model.aggressionBias('maniac', 'headsUp')).toBe(0)
  })

  it('treats all-in as aggressive, same as bet and raise', () => {
    const model = new OpponentModel()
    for (let i = 0; i < 20; i++) model.observe(action('villain', 'all-in'), headsUp())
    expect(model.aggressionBias('villain', 'headsUp')).toBeGreaterThan(0)
  })

  it('calls two players heads-up and three or more multiway', () => {
    expect(settingOf(2)).toBe('headsUp')
    expect(settingOf(3)).toBe('multiway')
  })
})

describe('how big they bet', () => {
  const checkedTo = (pot: number): ActionContext => ({ playersInHand: 2, facingBet: false, postflop: true, pot, currentBet: 0, committed: 0 })

  it('learns the share of bets that are big, from bets made when checked to', () => {
    const model = new OpponentModel()
    for (let i = 0; i < 40; i++) model.observe({ playerId: 'villain', type: 'bet', amount: 100 }, checkedTo(100))
    const rates = model.postflopRates('villain', 'headsUp')
    expect(rates.large).toBeGreaterThan(BASELINES.headsUp.postflop.large + 0.3)
  })

  it('starts from normal for anyone not yet seen betting', () => {
    expect(new OpponentModel().postflopRates('villain', 'headsUp').large).toBe(BASELINES.headsUp.postflop.large)
  })
})

describe('what they showed down', () => {
  const card = (spec: string): Card => ({
    rank: spec.slice(0, -1) as Card['rank'],
    suit: { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }[spec.slice(-1)] as Card['suit'],
  })
  const board = ['Ah', 'Kd', '7s', '4c', '2h'].map(card)
  const blinds = new Map([
    ['villain', 5],
    ['hero', 10],
  ])
  /** One hand: called preflop, checked to the river, where the villain bets `amount` into 20 and shows `cards`. */
  const hand = (cards: [string, string], amount: number): ShowdownRecord => ({
    actions: [
      { playerId: 'villain', type: 'call', street: 'preflop' },
      { playerId: 'hero', type: 'check', street: 'preflop' },
      { playerId: 'hero', type: 'check', street: 'flop' },
      { playerId: 'villain', type: 'check', street: 'flop' },
      { playerId: 'hero', type: 'check', street: 'turn' },
      { playerId: 'villain', type: 'check', street: 'turn' },
      { playerId: 'hero', type: 'check', street: 'river' },
      { playerId: 'villain', type: 'bet', amount, street: 'river' },
      { playerId: 'hero', type: 'call', street: 'river' },
    ],
    board,
    shown: [
      { playerId: 'villain', cards: cards.map(card) },
      { playerId: 'hero', cards: [card('9d'), card('9c')] },
    ],
    blinds,
    bigBlind: 10,
  })

  it('leaves the belief exactly where it was for someone never seen at showdown', () => {
    expect(new OpponentModel().showdownBluffShare('villain', 'large', 0.2)).toBe(0.2)
  })

  it('moves the belief toward bluffing for a player shown bluffing their big river bets', () => {
    const model = new OpponentModel()
    for (let i = 0; i < 6; i++) model.observeShowdown(hand(['6c', '3d'], 20))
    expect(model.shownBets('villain')).toBe(6)
    expect(model.showdownBluffShare('villain', 'large', 0.2)).toBeGreaterThan(0.5)
    // The small-bet belief has seen nothing and stays put.
    expect(model.showdownBluffShare('villain', 'small', 0.2)).toBe(0.2)
  })

  it('moves it toward value for a player who only ever shows the goods', () => {
    const model = new OpponentModel()
    for (let i = 0; i < 6; i++) model.observeShowdown(hand(['Ac', 'Kc'], 8))
    expect(model.showdownBluffShare('villain', 'small', 0.2)).toBeLessThan(0.15)
    expect(model.shownBets('hero')).toBe(0)
  })

  it('ignores bets before the river, which reach a showdown only when the bettor kept going', () => {
    const model = new OpponentModel()
    const record = hand(['6c', '3d'], 20)
    record.actions = record.actions.map((a) => (a.street === 'river' ? { ...a, street: 'turn' as const } : a))
    model.observeShowdown(record)
    expect(model.shownBets('villain')).toBe(0)
  })
})

describe('a read carried between sittings', () => {
  /** A villain seen raising a lot heads-up and bluffing big rivers, and folding a lot multiway. */
  function wellKnown(): OpponentModel {
    const model = new OpponentModel()
    for (let i = 0; i < 30; i++) model.observe(action('villain', i % 3 === 0 ? 'call' : 'raise'), headsUp())
    for (let i = 0; i < 25; i++) model.observe(action('villain', i % 4 === 0 ? 'call' : 'fold'), sixWay(true))
    for (let i = 0; i < 10; i++)
      model.observe({ playerId: 'villain', type: 'bet', amount: 80 }, { playersInHand: 2, facingBet: false, postflop: true, pot: 100, currentBet: 0 })
    model.observe(action('someone-else', 'raise'), headsUp())
    return model
  }

  it('comes back exactly as it was, through JSON, with no fading', () => {
    const before = wellKnown()
    const after = OpponentModel.fromJSON(JSON.parse(JSON.stringify(before.toJSON())))
    for (const setting of ['headsUp', 'multiway'] as const) {
      expect(after.aggressionBias('villain', setting)).toBe(before.aggressionBias('villain', setting))
      expect(after.foldBias('villain', setting)).toBe(before.foldBias('villain', setting))
      expect(after.postflopRates('villain', setting)).toEqual(before.postflopRates('villain', setting))
    }
    expect(after.aggressionBias('someone-else', 'headsUp')).toBe(before.aggressionBias('someone-else', 'headsUp'))
  })

  it('saves only the players asked for', () => {
    const data = wellKnown().toJSON(['villain', 'never-seen'])
    expect(Object.keys(data.players)).toEqual(['villain'])
    expect(OpponentModel.fromJSON(data).aggressionBias('someone-else', 'headsUp')).toBe(0)
  })

  it('fades with decay: the same tendency, held with less confidence', () => {
    const data = wellKnown().toJSON()
    const fresh = OpponentModel.fromJSON(data, 1)
    const faded = OpponentModel.fromJSON(data, 0.5)
    const gone = OpponentModel.fromJSON(data, 0)
    // Still read as aggressive and as a multiway folder, just less surely.
    expect(faded.aggressionBias('villain', 'headsUp')).toBeGreaterThan(0)
    expect(faded.aggressionBias('villain', 'headsUp')).toBeLessThan(fresh.aggressionBias('villain', 'headsUp'))
    expect(faded.foldBias('villain', 'multiway')).toBeGreaterThan(0)
    expect(faded.foldBias('villain', 'multiway')).toBeLessThan(fresh.foldBias('villain', 'multiway'))
    expect(gone.aggressionBias('villain', 'headsUp')).toBe(0)
    const rates = gone.postflopRates('villain', 'headsUp')
    for (const [key, normal] of Object.entries(BASELINES.headsUp.postflop)) {
      expect(rates[key as keyof typeof rates]).toBeCloseTo(normal, 9)
    }
  })

  it('never freezes: restored every sitting, old evidence stays bounded', () => {
    // Twenty sittings of the same saved read, faded by 0.7 each time, weigh
    // at most 1 / (1 - 0.7) — a bit over three sittings' worth.
    let model = wellKnown()
    for (let i = 0; i < 20; i++) model = OpponentModel.fromJSON(model.toJSON(), 0.7)
    const once = wellKnown().aggressionBias('villain', 'headsUp')
    const settled = model.aggressionBias('villain', 'headsUp')
    expect(settled).toBeGreaterThan(0)
    expect(settled).toBeLessThan(once * 1.5)
  })

  it('pools reads from two sources on the same player', () => {
    const data = wellKnown().toJSON(['villain'])
    const pooled = new OpponentModel()
    pooled.restore(data)
    pooled.restore(data)
    // Twice the evidence of the same tendency: a surer read.
    expect(pooled.aggressionBias('villain', 'headsUp')).toBeGreaterThan(OpponentModel.fromJSON(data).aggressionBias('villain', 'headsUp'))
  })

  it('carries showdown memory too', () => {
    const card = (spec: string): Card => ({
      rank: spec.slice(0, -1) as Card['rank'],
      suit: { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }[spec.slice(-1)] as Card['suit'],
    })
    // Checked to the river, where the villain bets the pot with air and is called.
    const record: ShowdownRecord = {
      actions: [
        { playerId: 'villain', type: 'call', street: 'preflop' },
        { playerId: 'hero', type: 'check', street: 'preflop' },
        ...(['flop', 'turn'] as const).flatMap((street) => [
          { playerId: 'hero', type: 'check' as const, street },
          { playerId: 'villain', type: 'check' as const, street },
        ]),
        { playerId: 'hero', type: 'check', street: 'river' },
        { playerId: 'villain', type: 'bet', amount: 20, street: 'river' },
        { playerId: 'hero', type: 'call', street: 'river' },
      ],
      board: ['Ah', 'Kd', '7s', '4c', '2h'].map(card),
      shown: [
        { playerId: 'villain', cards: [card('6c'), card('3d')] },
        { playerId: 'hero', cards: [card('9d'), card('9c')] },
      ],
      blinds: new Map([
        ['villain', 5],
        ['hero', 10],
      ]),
      bigBlind: 10,
    }
    const model = new OpponentModel()
    model.observeShowdown(record)
    expect(model.shownBets('villain')).toBe(1)
    const restored = OpponentModel.fromJSON(JSON.parse(JSON.stringify(model.toJSON())), 0.5)
    expect(restored.shownBets('villain')).toBe(0.5)
    expect(restored.showdownBluffShare('villain', 'large', 0.2)).toBeGreaterThan(0.2)
    expect(restored.showdownBluffShare('villain', 'large', 0.2)).toBeLessThan(model.showdownBluffShare('villain', 'large', 0.2))
  })

  it('ignores anything that is not saved data', () => {
    for (const junk of [null, 42, 'x', {}, { version: 2, players: {} }, { version: 1, players: { v: { tallies: { headsUp: { total: 'lots' } } } } }]) {
      const model = OpponentModel.fromJSON(junk)
      expect(model.aggressionBias('v', 'headsUp')).toBe(0)
    }
  })
})
