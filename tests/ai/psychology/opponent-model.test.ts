import { describe, expect, it } from 'vitest'
import { OpponentModel } from '../../../src/ai/psychology/opponent-model'
import type { PokerAction } from '../../../src/poker/game-state'

function action(playerId: string, type: PokerAction['type']): PokerAction {
  return { playerId, type }
}

describe('OpponentModel', () => {
  it('has no read on anyone before it has seen them', () => {
    const model = new OpponentModel()
    expect(model.aggressionBias('villain')).toBe(0)
  })

  it('stays at 0 below minSamples, however lopsided the actions seen so far are', () => {
    const model = new OpponentModel()
    for (let i = 0; i < 11; i++) model.observe(action('villain', 'raise'))
    expect(model.aggressionBias('villain')).toBe(0)
  })

  it('reads a player who bets and raises far more than baseline as positively biased', () => {
    const model = new OpponentModel()
    for (let i = 0; i < 20; i++) model.observe(action('villain', 'raise'))
    expect(model.aggressionBias('villain')).toBeGreaterThan(0)
  })

  it('reads a player who only ever calls or checks as negatively biased', () => {
    const model = new OpponentModel()
    for (let i = 0; i < 20; i++) model.observe(action('villain', i % 2 === 0 ? 'call' : 'check'))
    expect(model.aggressionBias('villain')).toBeLessThan(0)
  })

  it('keeps separate reads per player', () => {
    const model = new OpponentModel()
    for (let i = 0; i < 20; i++) model.observe(action('maniac', 'raise'))
    for (let i = 0; i < 20; i++) model.observe(action('nit', 'fold'))
    expect(model.aggressionBias('maniac')).toBeGreaterThan(model.aggressionBias('nit'))
  })

  it('treats all-in as aggressive, same as bet and raise', () => {
    const model = new OpponentModel()
    for (let i = 0; i < 20; i++) model.observe(action('villain', 'all-in'))
    expect(model.aggressionBias('villain')).toBeGreaterThan(0)
  })
})
