import { describe, expect, it } from 'vitest'
import {
  HUMAN_ACCOUNTING,
  RATIONAL_ACCOUNTING,
  referencePoint,
  sessionPnl,
  standing,
  type SessionState,
} from '../../../src/ai/psychology/accounting'
import { subjectiveValue, valueOf } from '../../../src/ai/psychology/prospect'

const session = (stack: number, buyIn = 1000): SessionState => ({ buyIn, stack })

describe('where zero is', () => {
  it('never moves off the buy-in in session mode', () => {
    const params = { ...HUMAN_ACCOUNTING, mode: 'session' as const }
    expect(referencePoint(session(1400), params)).toBe(1000)
    expect(referencePoint(session(600), params)).toBe(1000)
  })

  it('tracks the stack exactly for a player with no memory of the session', () => {
    expect(referencePoint(session(1400), RATIONAL_ACCOUNTING)).toBe(1400)
    expect(standing(session(600), RATIONAL_ACCOUNTING)).toBe(0)
  })

  it('lags behind partially, and lags further behind a loss than a win', () => {
    // Winnings get absorbed into "normal" faster than losses do, which is why
    // the house-money feeling fades over an evening and the urge to get back
    // to even does not.
    const up = standing(session(1400))
    const down = standing(session(600))
    expect(up).toBeCloseTo(0.5 * 400, 10)
    expect(down).toBeCloseTo(-0.9 * 400, 10)
    expect(Math.abs(down)).toBeGreaterThan(Math.abs(up))
  })

  it('puts a player who is exactly even at zero however they got there', () => {
    expect(standing(session(1000))).toBe(0)
    expect(sessionPnl(session(1000))).toBe(0)
  })
})

/**
 * House money and break-even are not implemented anywhere. They are what
 * happens when the same gamble is evaluated from three different reference
 * points, so these tests reach for `subjectiveValue` and nothing else.
 */
describe('the two mental-accounting effects, emerging rather than coded', () => {
  /** How much better the gamble feels than sitting still, from where this player stands. */
  const appetite = (stack: number) => {
    const from = standing(session(stack))
    const gamble = [
      { payoff: from + 200, probability: 0.5 },
      { payoff: from - 200, probability: 0.5 },
    ]
    return subjectiveValue(gamble) - valueOf(from)
  }

  it('is least willing to gamble at exactly even, where the kink is', () => {
    expect(appetite(1000)).toBeLessThan(appetite(1400))
    expect(appetite(1000)).toBeLessThan(appetite(600))
  })

  it('takes bigger risks with winnings — the house-money effect', () => {
    expect(appetite(1400)).toBeGreaterThan(appetite(1000))
    // Still not a gamble they want, only one that costs less to consider.
    expect(appetite(1400)).toBeLessThan(0)
  })

  it('actively wants the gamble when behind — the break-even effect', () => {
    expect(appetite(600)).toBeGreaterThan(0)
    expect(appetite(600)).toBeGreaterThan(appetite(1400))
  })

  it('does none of this for a player whose reference point is their stack', () => {
    const flat = (stack: number) => {
      const from = standing(session(stack), RATIONAL_ACCOUNTING)
      return subjectiveValue([
        { payoff: from + 200, probability: 0.5 },
        { payoff: from - 200, probability: 0.5 },
      ])
    }
    // Same number from every stack: with no history there is nothing to chase
    // and no winnings to play with.
    expect(flat(600)).toBeCloseTo(flat(1000), 10)
    expect(flat(1400)).toBeCloseTo(flat(1000), 10)
  })
})

/**
 * The headline prediction: facing a river bet, folding realises a certain
 * loss while calling is a gamble, so a losing player calls too wide.
 */
describe('the river call that pot odds say is a fold', () => {
  /** True when calling 75 into 100 with 25% equity beats folding, from this stack. */
  const calls = (stack: number) => {
    const from = standing(session(stack))
    const call = [
      { payoff: from + 100, probability: 0.25 },
      { payoff: from - 75, probability: 0.75 },
    ]
    const fold = [{ payoff: from, probability: 1 }]
    return subjectiveValue(call) > subjectiveValue(fold)
  }

  it('is a fold while even and a call while stuck', () => {
    // 25% against the 30% pot odds demand: a fold for anyone counting. The
    // player who is down 400 calls anyway, and nothing about their cards or
    // the price changed — only where they are measuring from.
    expect(calls(1000)).toBe(false)
    expect(calls(600)).toBe(true)
  })

  it('is still a fold for the same player playing on winnings', () => {
    expect(calls(1400)).toBe(false)
  })
})
