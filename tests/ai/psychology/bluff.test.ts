import { describe, expect, it } from 'vitest'
import { maybeBluff } from '../../../src/ai/psychology/bluff'
import type { PersonalityProfile } from '../../../src/ai/psychology/personality'

function profile(bluffFrequency: number): PersonalityProfile {
  return { aggression: 0.5, tightness: 0.5, bluffFrequency }
}

function fixedRng(value: number) {
  return () => value
}

describe('maybeBluff', () => {
  it('bluffs when the rng draw is below bluffFrequency, on a weak hand with nothing to call', () => {
    expect(maybeBluff(fixedRng(0.1), profile(0.5), { strength: 0.1, toCall: 0 })).toBe(true)
  })

  it('does not bluff when the rng draw is above bluffFrequency', () => {
    expect(maybeBluff(fixedRng(0.9), profile(0.5), { strength: 0.1, toCall: 0 })).toBe(false)
  })

  it('never bluffs a hand that is not weak (strength >= 0.35), regardless of the rng draw', () => {
    expect(maybeBluff(fixedRng(0), profile(1), { strength: 0.6, toCall: 0 })).toBe(false)
  })

  it('never bluffs when facing a bet (toCall > 0), regardless of the rng draw', () => {
    expect(maybeBluff(fixedRng(0), profile(1), { strength: 0.1, toCall: 20 })).toBe(false)
  })

  it('does not consume an rng draw when the spot does not qualify for a bluff', () => {
    let calls = 0
    const countingRng = () => {
      calls++
      return 0
    }
    maybeBluff(countingRng, profile(1), { strength: 0.6, toCall: 0 })
    maybeBluff(countingRng, profile(1), { strength: 0.1, toCall: 20 })
    expect(calls).toBe(0)
  })

  it('with bluffFrequency 0, never bluffs even on a weak hand with nothing to call', () => {
    expect(maybeBluff(fixedRng(0), profile(0), { strength: 0.1, toCall: 0 })).toBe(false)
  })
})
