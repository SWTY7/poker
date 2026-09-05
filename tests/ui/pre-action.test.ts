import { describe, expect, it } from 'vitest'
import { resolvePreAction } from '../../src/ui/useHoldemGame'

/**
 * A pre-action is armed before the player knows what the table will do, so
 * what matters is how it lands against a price that has moved since.
 */
describe('resolvePreAction', () => {
  it('check/fold checks when the action is free', () => {
    expect(resolvePreAction('check-fold', 0)).toBe('check')
  })

  it('check/fold folds rather than paying a bet that arrived after it was armed', () => {
    expect(resolvePreAction('check-fold', 40)).toBe('fold')
  })

  it('call-any pays whatever it is asked for', () => {
    expect(resolvePreAction('call-any', 40)).toBe('call')
    expect(resolvePreAction('call-any', 4000)).toBe('call')
  })

  it('call-any checks rather than trying to call nothing', () => {
    // 'call' with nothing to call is rejected by the betting rules, so this
    // must degrade to a check or the hand would throw.
    expect(resolvePreAction('call-any', 0)).toBe('check')
  })

  it('never resolves to an action that needs an amount', () => {
    for (const pre of ['check-fold', 'call-any'] as const) {
      for (const toCall of [0, 1, 40, 999]) {
        expect(['check', 'call', 'fold']).toContain(resolvePreAction(pre, toCall))
      }
    }
  })
})
