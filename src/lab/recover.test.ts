import { describe, expect, it } from 'vitest'
import { createRng } from '../utils/random'
import { FEATURES, type FeatureVector } from './features'
import { PARAMS, drawTruth, profileOf, type Truth } from './draw'
import { fitNearestNeighbours, fitRidge, score, splitByTable, type Row } from './recover'
import { runSession } from './session'

/** Synthetic seats whose features really do depend on two parameters, so a recovery that works must find them. */
function synthetic(count: number, seed: number): Row[] {
  const rng = createRng(seed)
  return Array.from({ length: count }, (_, i) => {
    const truth = drawTruth(rng)
    const features = Object.fromEntries(FEATURES.map((k) => [k, rng()])) as FeatureVector
    features.vpip = 0.1 + 0.2 * truth.lambda + (rng() - 0.5) * 0.05
    features.pfr = 0.3 + 0.5 * truth.discipline + (rng() - 0.5) * 0.05
    return { table: Math.floor(i / 6), features, truth }
  })
}

describe('drawTruth and profileOf', () => {
  it('keeps every draw inside its range and level a whole number', () => {
    const rng = createRng(3)
    for (let i = 0; i < 200; i++) {
      const truth = drawTruth(rng)
      for (const p of PARAMS) {
        expect(truth[p.key]).toBeGreaterThanOrEqual(p.min)
        expect(truth[p.key]).toBeLessThanOrEqual(p.max)
      }
      expect(Number.isInteger(truth.level)).toBe(true)
    }
  })

  it('writes each parameter to the place the bot reads it', () => {
    const truth: Truth = {
      lambda: 3,
      gamma: 0.5,
      persistenceOfGains: 0.2,
      persistenceOfLosses: 0.7,
      kappa: 1.5,
      tiltRetention: 0.8,
      level: 2,
      confidence: 0.4,
      discipline: 0.9,
    }
    const profile = profileOf(truth)
    expect(profile.prospect.lambda).toBe(3)
    expect(profile.prospect.gamma).toBe(0.5)
    expect(profile.accounting.persistenceOfLosses).toBe(0.7)
    expect(profile.tilt.kappa).toBe(1.5)
    expect(profile.level).toBe(2)
    expect(profile.discipline).toBe(0.9)
  })
})

describe('recovery', () => {
  const rows = synthetic(600, 11)
  const { train, test } = splitByTable(rows)

  it('splits by table with none on both sides', () => {
    const tables = new Set(train.map((r) => r.table))
    expect(test.some((r) => tables.has(r.table))).toBe(false)
  })

  it('finds the parameters the features depend on, and not the ones they ignore', () => {
    for (const predictor of [fitRidge(train), fitNearestNeighbours(train)]) {
      const scores = Object.fromEntries(score(predictor, test).map((s) => [s.key, s]))
      expect(scores.lambda.r).toBeGreaterThan(0.8)
      expect(scores.discipline.r).toBeGreaterThan(0.8)
      expect(scores.kappa.r2).toBeLessThan(0.2)
    }
  })
})

describe('runSession', () => {
  it('logs exactly the hands asked for at every seat, each with its own truth', () => {
    const runs = runSession({ hands: 6, seed: 5, seats: 3 })
    expect(runs).toHaveLength(3)
    for (const run of runs) {
      expect(run.hands).toHaveLength(6)
      expect(run.truth.lambda).toBeGreaterThanOrEqual(1)
    }
  })
})
