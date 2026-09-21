import type { ProspectParams } from './prospect'
import { HUMAN_PROSPECT, RATIONAL_PROSPECT } from './prospect'
import type { AccountingParams } from './accounting'
import { HUMAN_ACCOUNTING, RATIONAL_ACCOUNTING } from './accounting'
import type { TiltParams } from './tilt'
import { HUMAN_TILT, STOIC_TILT } from './tilt'
import { samplePoissonLevel } from './level-k'
import type { Rng } from '../../utils/random'

/**
 * A character is a parameter set, not a special case.
 *
 * Everything that distinguishes one opponent from another lives in these
 * numbers: how much they hate losing, where they think zero is, how hard a
 * bad beat lands, and how many steps of "he thinks that I think" they take.
 * There is no per-character code, and there should never be any — the moment
 * a character needs its own branch, the model has stopped explaining it.
 */
export interface PsychProfile {
  name: string
  prospect: ProspectParams
  accounting: AccountingParams
  tilt: TiltParams
  /** Depth of reasoning about the opponent. See level-k.ts. */
  level: number
  /** How completely this player commits to their read, 0..1. */
  confidence: number
  /** Board completions sampled per decision. More is steadier and slower. */
  equitySamples: number
}

const BASE = { confidence: 0.6, equitySamples: 250 }

/**
 * The control. Linear value function, no loss aversion, true probabilities,
 * reference point at the current stack, never tilts, level 1. Every claim
 * about a bias is a comparison against this bot, which is the only way to
 * tell a bias from a bug.
 */
export const RATIONAL: PsychProfile = {
  ...BASE,
  name: 'Even',
  prospect: RATIONAL_PROSPECT,
  accounting: RATIONAL_ACCOUNTING,
  tilt: STOIC_TILT,
  level: 1,
}

/** The measured human. Every parameter is the population estimate. */
export const AVERAGE_HUMAN: PsychProfile = {
  ...BASE,
  name: 'Marlowe',
  prospect: HUMAN_PROSPECT,
  accounting: HUMAN_ACCOUNTING,
  tilt: HUMAN_TILT,
  level: 1,
}

/**
 * Extreme loss aversion and a reference point welded to the buy-in. Folds
 * anything marginal while even, and cannot let go of a pot once behind.
 */
export const LOSS_AVERSE: PsychProfile = {
  ...BASE,
  name: 'Dorothy',
  prospect: { ...HUMAN_PROSPECT, lambda: 3.2 },
  accounting: { mode: 'session', persistenceOfGains: 1, persistenceOfLosses: 1 },
  tilt: { ...HUMAN_TILT, kappa: 0.6 },
  level: 0,
}

/** Tilts easily and holds it. A bad beat rearranges the next ten hands. */
export const HOTHEAD: PsychProfile = {
  ...BASE,
  name: 'Rex',
  prospect: { ...HUMAN_PROSPECT, lambda: 1.8 },
  accounting: { mode: 'partial', persistenceOfGains: 0.3, persistenceOfLosses: 1 },
  tilt: { gamma: 0.94, kappa: 2.2, scale: 1000 },
  level: 1,
}

/**
 * Absorbs wins instantly and never chases, so their reference point barely
 * moves. Reads one level deeper than the table and believes it.
 */
export const GRINDER: PsychProfile = {
  ...BASE,
  name: 'Vera',
  prospect: { ...HUMAN_PROSPECT, lambda: 1.4, gamma: 0.85 },
  accounting: { mode: 'partial', persistenceOfGains: 0.1, persistenceOfLosses: 0.3 },
  tilt: { gamma: 0.8, kappa: 0.3, scale: 1000 },
  level: 2,
  confidence: 0.75,
}

/**
 * Thinks one level too many. Included deliberately: level-k predicts this
 * costs money against the level-1 players who make up most of a table, and
 * a cast that only contains good ideas cannot demonstrate that.
 */
export const OVERTHINKER: PsychProfile = {
  ...BASE,
  name: 'Ambrose',
  prospect: { ...HUMAN_PROSPECT, lambda: 2 },
  accounting: HUMAN_ACCOUNTING,
  tilt: { ...HUMAN_TILT, kappa: 0.8 },
  level: 3,
  confidence: 0.85,
}

/** Does not think about you at all. Plays their own cards and nothing else. */
export const ROCK: PsychProfile = {
  ...BASE,
  name: 'Bunny',
  prospect: { ...HUMAN_PROSPECT, lambda: 2.6, gamma: 0.55 },
  accounting: { mode: 'session', persistenceOfGains: 0.8, persistenceOfLosses: 0.8 },
  tilt: { ...HUMAN_TILT, kappa: 0.4 },
  level: 0,
  confidence: 0.9,
}

/** The cast, in the order a table fills up. */
export const CAST: PsychProfile[] = [AVERAGE_HUMAN, GRINDER, HOTHEAD, LOSS_AVERSE, ROCK, OVERTHINKER]

function clamp01(x: number): number {
  return Math.min(Math.max(x, 0), 1)
}

/**
 * One archetype, instantiated fresh rather than photocopied.
 *
 * `CAST`'s numbers are a center of gravity, not a value every bot wearing
 * that name is bound to exactly: level is redrawn from the Poisson the
 * character's own level anchors (see level-k.ts's `samplePoissonLevel`),
 * and confidence gets a small independent jitter. Without this, a table is
 * the same six fixed reasoning depths in the same six seats every single
 * game — learn how Rex plays once and you have learned how Rex plays
 * forever. A table you've played before should not be a table you've
 * already solved.
 */
export function randomizeProfile(profile: PsychProfile, rng: Rng): PsychProfile {
  const level = samplePoissonLevel(rng, Math.max(profile.level, 0.05))
  const confidence = clamp01(profile.confidence + (rng() - 0.5) * 0.2)
  return { ...profile, level, confidence }
}
