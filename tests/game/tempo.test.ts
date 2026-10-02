import { describe, expect, it } from 'vitest'
import { fixedThinkTime, tempoFor, thinkTime } from '../../src/game/tempo'

const rec = tempoFor({ discipline: 0, level: 1 }, 'tomas')
const pro = tempoFor({ discipline: 1, level: 2 }, 'nadia')

describe('timing tells', () => {
  it('tanks over a close decision and snaps an obvious one', () => {
    const close = thinkTime('call', 0.01, rec)
    const middling = thinkTime('call', 0.12, rec)
    const obvious = thinkTime('call', 2, rec)
    expect(close).toBeGreaterThan(middling)
    expect(middling).toBeGreaterThan(obvious)
    expect(close / obvious).toBeGreaterThan(4)
    // Only one kind of move on offer is never a hard decision.
    expect(thinkTime('call', null, rec)).toBe(obvious)
  })

  it('is the same every time for the same character, so it can be learned', () => {
    expect(tempoFor({ discipline: 0, level: 1 }, 'tomas')).toEqual(rec)
    expect(thinkTime('raise', 0.05, rec)).toBe(thinkTime('raise', 0.05, rec))
    expect(tempoFor({ discipline: 0, level: 1 }, 'pia').pace).not.toBe(rec.pace)
  })

  it('a studied player gives away less than a recreational one', () => {
    const swing = (t: typeof rec) => thinkTime('call', 0, t) / thinkTime('call', 1, t)
    expect(pro.tell).toBeLessThan(rec.tell)
    expect(swing(pro)).toBeLessThan(swing(rec))
    expect(swing(pro)).toBeGreaterThan(1)
  })

  it('keeps bigger moves a beat longer, as the fixed pacing does', () => {
    expect(thinkTime('raise', 1, rec)).toBeGreaterThan(thinkTime('fold', 1, rec))
    expect(fixedThinkTime('fold')).toBe(340)
  })
})
