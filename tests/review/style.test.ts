import { describe, expect, it } from 'vitest'
import type { HandRecord, LoggedAction, LoggedDecision } from '../../src/review/log'
import { BIG_LOSS_BB, TILT_WINDOW, handFacts, styleProfile } from '../../src/review/style'
import { findLeaks, spotOf } from '../../src/review/leaks'

/**
 * A hand written out the way a player would tell it: "I raise, she calls,
 * flop, I bet, she folds." `me` is the logged player; the other is `her`.
 */
function hand(actions: [string, LoggedAction['type'], number?][][], extra: Partial<HandRecord> = {}): HandRecord {
  const streets = ['preflop', 'flop', 'turn', 'river'] as const
  const logged: LoggedAction[] = actions.flatMap((street, i) =>
    street.map(([player, type, amount]) => ({ player, type, street: streets[i], ...(amount !== undefined ? { amount } : {}) })),
  )
  return {
    id: 'h',
    session: 's',
    at: 0,
    player: 'me',
    position: 'BTN',
    players: 2,
    bigBlind: 10,
    startStack: 1000,
    cards: ['As', 'Kd'],
    board: actions.length > 1 ? ['2c', '7d', 'Jh', '4s', '9c'].slice(0, actions.length + 1) : [],
    actions: logged,
    decisions: logged.flatMap((a, index) => (a.player === 'me' ? [{ index, street: a.street, pot: 30, toCall: 0, stack: 900 }] : [])),
    net: 0,
    showdown: false,
    won: false,
    ...extra,
  }
}

describe('what one hand says about a player', () => {
  it('reads a raise, a c-bet and a fold behind it', () => {
    const facts = handFacts(hand([[['me', 'raise', 25], ['her', 'call']], [['her', 'check'], ['me', 'bet', 30], ['her', 'fold']]]))
    expect(facts).toMatchObject({ vpip: true, pfr: true, cbetChance: true, cbet: true, sawFlop: true, postflopAggressive: 1 })
    expect(facts.threeBetChance).toBe(false)
    expect(facts.foldToCbetChance).toBe(false)
  })

  it('doesn’t count a big blind’s free check as putting money in', () => {
    const facts = handFacts(hand([[['her', 'call'], ['me', 'check']], [['me', 'check'], ['her', 'check']]]))
    expect(facts.vpip).toBe(false)
    expect(facts.pfr).toBe(false)
    // Nobody raised preflop, so there is no c-bet to make or face.
    expect(facts.cbetChance).toBe(false)
    expect(facts.foldToCbetChance).toBe(false)
  })

  it('sees a 3-bet chance when facing one raise, and a folded c-bet', () => {
    const threeBet = handFacts(hand([[['her', 'raise', 25], ['me', 'raise', 75], ['her', 'fold']]]))
    expect(threeBet).toMatchObject({ threeBetChance: true, threeBet: true, vpip: true, pfr: true, sawFlop: false })

    const flat = handFacts(hand([[['her', 'raise', 25], ['me', 'call']], [['her', 'bet', 30], ['me', 'fold']]]))
    expect(flat).toMatchObject({ threeBetChance: true, threeBet: false, foldToCbetChance: true, foldToCbet: true })
  })

  it('counts an all in for less than the bet as a call, not a raise', () => {
    const facts = handFacts(hand([[['her', 'raise', 25], ['me', 'call']], [['her', 'bet', 500], ['me', 'all-in', 300]]]))
    expect(facts.postflopCalls).toBe(1)
    expect(facts.postflopAggressive).toBe(0)
  })
})

describe('a style profile', () => {
  it('adds hands up, with the chances each stat was measured over', () => {
    const hands = [
      hand([[['me', 'raise', 25], ['her', 'call']], [['her', 'check'], ['me', 'bet', 30], ['her', 'call']], [['her', 'check'], ['me', 'check']], [['her', 'check'], ['me', 'check']]], {
        showdown: true,
        won: true,
        net: 55,
      }),
      hand([[['me', 'fold']]], { net: -5 }),
      hand([[['her', 'raise', 25], ['me', 'call']], [['her', 'bet', 30], ['me', 'call']], [['her', 'bet', 60], ['me', 'fold']]], { net: -55 }),
    ]
    const profile = styleProfile(hands)
    expect(profile.hands).toBe(3)
    expect(profile.vpip).toEqual({ count: 2, of: 3, rate: 2 / 3 })
    expect(profile.pfr).toEqual({ count: 1, of: 3, rate: 1 / 3 })
    expect(profile.cbet).toEqual({ count: 1, of: 1, rate: 1 })
    expect(profile.foldToCbet).toEqual({ count: 0, of: 1, rate: 0 })
    expect(profile.wtsd).toEqual({ count: 1, of: 2, rate: 0.5 })
    expect(profile.wsd).toEqual({ count: 1, of: 1, rate: 1 })
    expect(profile.aggressionFactor).toEqual({ aggressive: 1, calls: 1, value: 1 })
    expect(profile.bbPer100).toBeCloseTo(((55 - 5 - 55) / 10 / 3) * 100)
  })

  it('has no rates at all with no hands, rather than zeros', () => {
    const profile = styleProfile([])
    expect(profile.vpip.rate).toBeNull()
    expect(profile.bbPer100).toBeNull()
    expect(profile.aggressionFactor.value).toBeNull()
  })

  it('shows a player who loosens up after a big loss', () => {
    const fold = () => hand([[['me', 'fold']]])
    const loose = () => hand([[['me', 'raise', 25], ['her', 'fold']]])
    const beat = hand([[['me', 'raise', 25], ['her', 'call']]], { net: -(BIG_LOSS_BB + 5) * 10 })
    const hands = [...Array.from({ length: 20 }, fold), beat, ...Array.from({ length: TILT_WINDOW }, loose), ...Array.from({ length: 20 }, fold)]
    const { tilt } = styleProfile(hands)
    expect(tilt.bigLosses).toBe(1)
    expect(tilt.after.vpip).toEqual({ count: TILT_WINDOW, of: TILT_WINDOW, rate: 1 })
    expect(tilt.otherwise.vpip.rate).toBeLessThan(0.05)
  })

  it('does not carry "after a big loss" into the next sitting', () => {
    const beat = hand([[['me', 'call']]], { net: -500 })
    const next = hand([[['me', 'fold']]], { session: 'tomorrow' })
    expect(styleProfile([beat, next]).tilt.after.vpip.of).toBe(0)
  })
})

describe('finding leaks against the solve', () => {
  const withBook = (record: HandRecord, book: LoggedDecision['book']): HandRecord => ({
    ...record,
    decisions: record.decisions.map((d) => ({ ...d, book })),
  })
  const raisesAlmostAlways = { fold: 0.03, passive: 0.02, aggressive: 0.95 }

  it('names the spot in plain words', () => {
    const h = hand([[['her', 'raise', 25], ['me', 'raise', 75], ['her', 'raise', 200], ['me', 'fold']], []])
    expect(spotOf(h, 1)).toBe('Preflop, facing a raise')
    expect(spotOf(h, 3)).toBe('Preflop, facing a re-raise')
    expect(spotOf(hand([[['me', 'raise', 25]]]), 0)).toBe('Preflop, first in from BTN')
  })

  it('flags a habit the solve almost never has, and ranks it first', () => {
    const limps = Array.from({ length: 8 }, () => withBook(hand([[['me', 'call'], ['her', 'check']]]), raisesAlmostAlways))
    const fine = Array.from({ length: 8 }, () => withBook(hand([[['me', 'raise', 25], ['her', 'fold']]]), raisesAlmostAlways))
    const report = findLeaks([...limps, ...fine])
    expect(report.covered).toBe(16)
    expect(report.onBook).toBe(8)
    expect(report.leaks[0]).toMatchObject({ spot: 'Preflop, first in from BTN', did: 'passive', bookPrefers: 'aggressive', count: 8, of: 16 })
  })

  it('does not call a mixed strategy’s rarer branch a leak', () => {
    const mixed = { fold: 0, passive: 0.3, aggressive: 0.7 }
    const report = findLeaks(Array.from({ length: 10 }, () => withBook(hand([[['me', 'call'], ['her', 'check']]]), mixed)))
    expect(report.leaks).toEqual([])
    expect(report.onBook).toBe(10)
  })

  it('counts a single off-book play but doesn’t list it as a habit', () => {
    const once = withBook(hand([[['me', 'call'], ['her', 'check']]]), raisesAlmostAlways)
    const report = findLeaks([once])
    expect(report.leaks).toEqual([])
    expect(report.oneOffs).toBe(1)
    expect(report.onBook).toBe(0)
  })

  it('ignores decisions no solve covered', () => {
    expect(findLeaks([hand([[['me', 'call'], ['her', 'check']]])]).covered).toBe(0)
  })
})
