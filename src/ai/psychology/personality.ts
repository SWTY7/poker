/**
 * Personality — a small set of *stable* traits that bend the existing
 * HeuristicBot's decision thresholds. This is deliberately separate from
 * emotion/tilt (a *volatile* state layered on top later) and from cognitive
 * bias (which will distort the strength *estimate* itself, upstream of this
 * file). Keeping those three seams apart now is what lets them compose
 * later instead of fighting over the same numbers.
 *
 * The trait set mirrors real poker tracking stats, on purpose — this isn't
 * invented psychology:
 *   - tightness  ~ VPIP (how often a player voluntarily puts money in the pot)
 *   - aggression ~ PFR / AF (raise-vs-call ratio)
 *   - bluffFrequency ~ how often a player bets/raises without the goods
 */
export interface PersonalityProfile {
  /** 0 = purely passive (checks/calls), 1 = purely aggressive (bets/raises). 0.5 = neutral, matches plain HeuristicBot. */
  aggression: number
  /** 0 = plays almost any two cards (loose), 1 = only commits chips with real strength (tight). 0.5 = neutral. */
  tightness: number
  /** 0 = never bets without a real hand, 1 = bluffs in every spot that allows it. See bluff.ts. */
  bluffFrequency: number
}

/** Exactly reproduces plain HeuristicBot's behavior — the zero point every other profile is compared against. */
export const NEUTRAL_PERSONALITY: PersonalityProfile = {
  aggression: 0.5,
  tightness: 0.5,
  bluffFrequency: 0,
}

/**
 * Maps a trait's 0..1 value to an additive offset centered on 0 at trait=0.5.
 * `magnitude` is how much the most extreme personality (0 or 1) can move a
 * threshold — 0.25 means a maximally tight/aggressive bot shifts a decision
 * boundary by a quarter of the whole 0..1 strength scale.
 */
export function traitOffset(trait: number, magnitude = 0.25): number {
  return (trait - 0.5) * 2 * magnitude
}

/**
 * The three threshold comparisons HeuristicBot/PersonalityBot make, each
 * shifted by personality. All three start from the same `adjustedStrength`
 * (hand strength + the existing small random noise) — only the bar it has
 * to clear moves.
 *
 *   effectiveForBet             — deciding to bet when checked to (toCall === 0)
 *   effectiveForCall            — deciding to call/enter a pot facing a bet
 *   effectiveForRaiseFacingBet  — deciding to raise instead of call/fold
 *
 * tightness makes entering a pot (bet or call) require more strength.
 * aggression makes choosing bet/raise over check/call require less.
 */
export interface ShiftedThresholds {
  effectiveForBet: number
  effectiveForCall: number
  effectiveForRaiseFacingBet: number
}

export function applyPersonalityShift(adjustedStrength: number, profile: PersonalityProfile): ShiftedThresholds {
  const aggressionShift = traitOffset(profile.aggression)
  const tightnessShift = traitOffset(profile.tightness)
  return {
    effectiveForBet: adjustedStrength + aggressionShift - tightnessShift,
    effectiveForCall: adjustedStrength - tightnessShift,
    effectiveForRaiseFacingBet: adjustedStrength + aggressionShift,
  }
}
