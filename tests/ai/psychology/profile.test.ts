import { describe, expect, it } from 'vitest'
import { CAST, ROCK, OVERTHINKER, randomizeProfile } from '../../../src/ai/psychology/profile'
import { createRng } from '../../../src/utils/random'

describe('randomizeProfile', () => {
  it('is deterministic for a given rng seed', () => {
    const a = randomizeProfile(CAST[0], createRng(1))
    const b = randomizeProfile(CAST[0], createRng(1))
    expect(a).toEqual(b)
  })

  it('keeps confidence within a small jitter of the archetype, clamped to 0..1', () => {
    for (let seed = 0; seed < 50; seed++) {
      const randomized = randomizeProfile(ROCK, createRng(seed))
      expect(randomized.confidence).toBeGreaterThanOrEqual(0)
      expect(randomized.confidence).toBeLessThanOrEqual(1)
      expect(Math.abs(randomized.confidence - ROCK.confidence)).toBeLessThanOrEqual(0.1)
    }
  })

  it('does not always reproduce the archetype level exactly, across draws', () => {
    // OVERTHINKER anchors level 3 — the Poisson spread at that mean should
    // produce more than one distinct outcome across enough independent seeds.
    const levels = new Set<number>()
    for (let seed = 0; seed < 40; seed++) {
      levels.add(randomizeProfile(OVERTHINKER, createRng(seed)).level)
    }
    expect(levels.size).toBeGreaterThan(1)
  })

  it('leaves every other trait untouched', () => {
    const randomized = randomizeProfile(CAST[1], createRng(7))
    expect(randomized.name).toBe(CAST[1].name)
    expect(randomized.prospect).toBe(CAST[1].prospect)
    expect(randomized.accounting).toBe(CAST[1].accounting)
    expect(randomized.tilt).toBe(CAST[1].tilt)
    expect(randomized.equitySamples).toBe(CAST[1].equitySamples)
  })
})
