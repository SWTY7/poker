import { HUMAN_PROSPECT } from '../ai/psychology/prospect'
import type { PsychProfile } from '../ai/psychology/profile'
import type { Rng } from '../utils/random'

/**
 * Phase 3a's ground truth: a character drawn from wide ranges, not one of the
 * eight archetypes in `CAST`. Every number in `PARAMS` is something the model
 * could in principle be recovered from, so the lab draws each of them
 * independently and records the draw as the answer key.
 *
 * Not varied: the prospect curvatures (alpha, beta stay at the population
 * value) and the accounting mode (always 'partial', the one with knobs). They
 * are held fixed, so the lab makes no claim about them.
 */

export interface ParamSpec {
  key: ParamKey
  label: string
  min: number
  max: number
  /** Drawn as a whole number (level-k depth). */
  integer?: boolean
}

export type ParamKey =
  | 'lambda'
  | 'gamma'
  | 'persistenceOfGains'
  | 'persistenceOfLosses'
  | 'kappa'
  | 'tiltRetention'
  | 'level'
  | 'confidence'
  | 'discipline'

export const PARAMS: ParamSpec[] = [
  { key: 'lambda', label: 'loss aversion', min: 1, max: 4 },
  { key: 'gamma', label: 'probability weighting', min: 0.4, max: 1 },
  { key: 'persistenceOfGains', label: 'gains kept in the reference point', min: 0, max: 1 },
  { key: 'persistenceOfLosses', label: 'losses kept in the reference point', min: 0, max: 1 },
  { key: 'kappa', label: 'tilt sensitivity', min: 0, max: 2.5 },
  { key: 'tiltRetention', label: 'tilt retained per hand', min: 0.6, max: 0.97 },
  { key: 'level', label: 'level-k depth', min: 0, max: 3, integer: true },
  { key: 'confidence', label: 'commitment to the read', min: 0.3, max: 1 },
  { key: 'discipline', label: 'discipline (study)', min: 0, max: 1 },
]

export type Truth = Record<ParamKey, number>

export function drawTruth(rng: Rng): Truth {
  const truth = {} as Truth
  for (const spec of PARAMS) {
    const raw = spec.min + rng() * (spec.max - spec.min)
    truth[spec.key] = spec.integer ? Math.min(spec.max, Math.floor(spec.min + rng() * (spec.max - spec.min + 1))) : raw
  }
  return truth
}

/** The profile a truth describes. `equitySamples` is the same as every cast member's. */
export function profileOf(truth: Truth, name = 'Lab'): PsychProfile {
  return {
    name,
    prospect: { ...HUMAN_PROSPECT, lambda: truth.lambda, gamma: truth.gamma },
    accounting: {
      mode: 'partial',
      persistenceOfGains: truth.persistenceOfGains,
      persistenceOfLosses: truth.persistenceOfLosses,
    },
    tilt: { gamma: truth.tiltRetention, kappa: truth.kappa, scale: 1000 },
    level: truth.level,
    confidence: truth.confidence,
    equitySamples: 250,
    discipline: truth.discipline,
  }
}
