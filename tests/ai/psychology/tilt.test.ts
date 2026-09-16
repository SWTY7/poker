import { describe, expect, it } from 'vitest'
import {
  HUMAN_TILT,
  STOIC_TILT,
  decayTilt,
  expectationViolated,
  tiltEffects,
  tiltIntensity,
  updateTilt,
} from '../../../src/ai/psychology/tilt'

const beat = (equity: number, shareWon: number, potSize: number) => ({
  equityWhenCommitted: equity,
  shareWon,
  potSize,
})

describe('what counts as a beat', () => {
  it('scores by the expectation violated, not the chips lost', () => {
    expect(expectationViolated(beat(0.9, 0, 500))).toBeCloseTo(0.9, 10)
    expect(expectationViolated(beat(0.3, 0, 500))).toBeCloseTo(0.3, 10)
  })

  it('never tilts a winner, however lucky they got', () => {
    expect(expectationViolated(beat(0.05, 1, 5000))).toBe(0)
    expect(updateTilt(0, beat(0.05, 1, 5000))).toBe(0)
  })

  it('treats a chop as half the hand', () => {
    expect(expectationViolated(beat(1, 0.5, 400))).toBeCloseTo(0.5, 10)
  })
})

describe('the asymmetry that makes a bad beat a bad beat', () => {
  it('tilts a crushed favourite three times as hard as a beaten underdog', () => {
    const favourite = updateTilt(0, beat(0.9, 0, 400))
    const underdog = updateTilt(0, beat(0.3, 0, 400))
    // Identical chips. Triple the sting.
    expect(favourite / underdog).toBeCloseTo(3, 6)
  })

  it('tilts far less when the same chips go gradually', () => {
    // One 400-chip pot lost as a 90% favourite, against five 80-chip pots
    // lost as a coinflip — the same 400 chips either way.
    const oneBeat = updateTilt(0, beat(0.9, 0, 400))
    let gradual = 0
    for (let i = 0; i < 5; i++) gradual = updateTilt(gradual, beat(0.5, 0, 80))
    expect(gradual).toBeLessThan(oneBeat / 2)
  })

  it('compounds a run of them faster than it decays', () => {
    let tilt = 0
    for (let i = 0; i < 4; i++) tilt = updateTilt(tilt, beat(0.8, 0, 300))
    expect(tilt).toBeGreaterThan(updateTilt(0, beat(0.8, 0, 300)) * 3)
  })
})

describe('decay', () => {
  it('leaves about a third of a jolt after ten quiet hands', () => {
    let tilt = updateTilt(0, beat(1, 0, 1000))
    expect(tilt).toBeCloseTo(1, 10)
    for (let i = 0; i < 10; i++) tilt = decayTilt(tilt)
    expect(tilt).toBeCloseTo(Math.pow(0.9, 10), 10)
    expect(tilt).toBeGreaterThan(0.3)
    expect(tilt).toBeLessThan(0.4)
  })

  it('goes to nothing eventually, and never below', () => {
    let tilt = 5
    for (let i = 0; i < 300; i++) tilt = decayTilt(tilt)
    expect(tilt).toBeGreaterThanOrEqual(0)
    expect(tilt).toBeLessThan(1e-6)
  })

  it('means the same thing at every blind level', () => {
    // kappa is defined against the buy-in, so a table with ten times the
    // chips tilts its players by the same amount for the same-sized beat.
    const small = updateTilt(0, beat(0.9, 0, 500), { ...HUMAN_TILT, scale: 1000 })
    const big = updateTilt(0, beat(0.9, 0, 5000), { ...HUMAN_TILT, scale: 10000 })
    expect(small).toBeCloseTo(big, 10)
  })

  it('leaves a stoic completely alone', () => {
    expect(updateTilt(0, beat(1, 0, 10000), STOIC_TILT)).toBe(0)
  })
})

describe('what tilt does to the player', () => {
  it('maps any amount of tilt into 0..1 without a clamp', () => {
    expect(tiltIntensity(0)).toBe(0)
    expect(tiltIntensity(-1)).toBe(0)
    expect(tiltIntensity(1)).toBeCloseTo(0.5, 10)
    expect(tiltIntensity(1e6)).toBeLessThan(1)
    let previous = -1
    for (const t of [0, 0.5, 1, 2, 5, 20]) {
      expect(tiltIntensity(t)).toBeGreaterThan(previous)
      previous = tiltIntensity(t)
    }
  })

  it('reproduces the observed signature: loss aversion down, suspicion up, aggression up', () => {
    const calm = tiltEffects(0)
    const steaming = tiltEffects(3)
    expect(calm).toEqual({ lambdaScale: 1, bluffBeliefBoost: 0, aggressionBoost: 0 })
    expect(steaming.lambdaScale).toBeLessThan(calm.lambdaScale)
    expect(steaming.bluffBeliefBoost).toBeGreaterThan(calm.bluffBeliefBoost)
    expect(steaming.aggressionBoost).toBeGreaterThan(calm.aggressionBoost)
  })

  it('degrades but never inverts — a tilted player still prefers winning', () => {
    for (const t of [0, 1, 10, 1000]) {
      const effects = tiltEffects(t)
      expect(effects.lambdaScale).toBeGreaterThan(0.39)
      expect(effects.bluffBeliefBoost).toBeLessThan(0.26)
      expect(effects.aggressionBoost).toBeLessThan(0.31)
    }
  })
})
