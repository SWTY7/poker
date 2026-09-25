import { describe, expect, it } from 'vitest'
import { BASELINES, OpponentModel, settingOf, type ActionContext } from '../../../src/ai/psychology/opponent-model'
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
