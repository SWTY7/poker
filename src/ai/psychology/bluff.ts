import type { Rng } from '../../utils/random'
import type { PersonalityProfile } from './personality'

export interface BluffContext {
  /** Hand-strength estimate (including the same +/-0.05 noise the rest of the bot's decisions use), 0..1. */
  strength: number
  /** How much this bot would need to put in to continue. */
  toCall: number
}

/**
 * YOUR TASK — implement this function. Make tests/ai/psychology/bluff.test.ts pass.
 *
 * A bluff is choosing to bet with a hand that isn't actually strong, to
 * represent one that is. Unlike aggression/tightness (threshold shifts on
 * an honest strength estimate), this is a decision to act *against* the
 * estimate — which is why it's a separate randomized check rather than
 * another entry in applyPersonalityShift.
 *
 * Spec:
 *   1. Only ever bluff when `context.strength < 0.35` (a genuinely weak
 *      hand). Betting a strong hand isn't a bluff, it's a value bet — don't
 *      let this function fire for those.
 *   2. Only ever bluff when `context.toCall === 0` (v1 scope: betting into
 *      action that's been checked to you). Representing strength by raising
 *      *into* someone else's bet (a semi-bluff / float) is a deliberately
 *      deferred extension — note that in a comment rather than handling it.
 *   3. When both hold, draw exactly one number from `rng()` and bluff if
 *      it is less than `profile.bluffFrequency`. Check conditions 1 and 2
 *      BEFORE calling rng() — don't consume a draw when a bluff was never
 *      in consideration, or you'll desync the rng sequence against any
 *      caller assuming a deterministic number of draws per decision (the
 *      same reason the rest of this codebase always seeds its Rng).
 *
 * Why bluffFrequency is used directly as the probability, with no hidden
 * damping multiplier: the trait's whole meaning is "probability of bluffing
 * in a spot that allows it" — an author who wants rarer bluffs just sets a
 * lower number. A hidden multiplier would make the trait lie about its own
 * units.
 */
export function maybeBluff(_rng: Rng, _profile: PersonalityProfile, _context: BluffContext): boolean {
  throw new Error('maybeBluff is not implemented yet — see the spec comment above')
}
