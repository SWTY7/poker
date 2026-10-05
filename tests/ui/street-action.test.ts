import { describe, expect, it } from 'vitest'
import type { HandLogEntry } from '../../src/poker/game-state'
import { lastActionThisStreet } from '../../src/ui/street-action'

const entry = (seq: number, playerId: string, actionType: HandLogEntry['actionType'], extra: Partial<HandLogEntry> = {}): HandLogEntry => ({
  seq,
  street: 'flop',
  kind: 'action',
  playerId,
  actionType,
  potAfter: 0,
  ...extra,
})

const hero = { id: 'hero', folded: false, isAllIn: false }

describe('lastActionThisStreet', () => {
  it('shows a check while nobody has bet since', () => {
    const log = [entry(1, 'hero', 'check')]
    expect(lastActionThisStreet(log, { ...hero, betThisStreet: 0 }, 'flop', 0)).toBe('Check')
  })

  it('drops the check once someone bets into the player (the stale Check bug)', () => {
    const log = [entry(1, 'hero', 'check'), entry(2, 'otto', 'bet', { toAmount: 263, amount: 263 })]
    expect(lastActionThisStreet(log, { ...hero, betThisStreet: 0 }, 'flop', 263)).toBeUndefined()
  })

  it('keeps showing a bet that is still the highest', () => {
    const log = [entry(1, 'hero', 'bet', { toAmount: 100, amount: 100 })]
    expect(lastActionThisStreet(log, { ...hero, betThisStreet: 100 }, 'flop', 100)).toBe('Bet $100')
  })

  it('drops a raise that has since been re-raised', () => {
    const log = [entry(1, 'hero', 'raise', { toAmount: 60 }), entry(2, 'otto', 'raise', { toAmount: 200 })]
    expect(lastActionThisStreet(log, { ...hero, betThisStreet: 60 }, 'flop', 200)).toBeUndefined()
  })

  it('still says Folded and All-in whatever the current bet is', () => {
    const log = [entry(1, 'hero', 'fold')]
    expect(lastActionThisStreet(log, { ...hero, folded: true, betThisStreet: 0 }, 'flop', 300)).toBe('Folded')
    const shove = [entry(1, 'hero', 'all-in')]
    expect(lastActionThisStreet(shove, { ...hero, isAllIn: true, betThisStreet: 50 }, 'flop', 300)).toBe('All-in')
  })

  it('ignores earlier streets', () => {
    const log = [entry(1, 'hero', 'raise', { street: 'preflop', toAmount: 30 })]
    expect(lastActionThisStreet(log, { ...hero, betThisStreet: 0 }, 'flop', 0)).toBeUndefined()
  })
})
