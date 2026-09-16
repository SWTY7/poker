/**
 * Tilt as a state variable.
 *
 * "Tilt" is emotionally driven strategic degradation, and it is worth being
 * precise about what triggers it, because the trigger is not losing money.
 * Losing the same chips gradually barely registers; losing them as a large
 * favourite registers a great deal. What tilts a player is a violated
 * expectation, not a smaller stack — which is why the input here is equity
 * lost rather than chips lost.
 *
 *   T' = gamma * T + kappa * max(0, equityLost * potSize / scale)
 *
 * Decay handles the rest: gamma near 0.9 means the sting of one hand is
 * mostly gone in about seven, and a run of them compounds faster than it
 * decays, which is what a downswing feels like.
 *
 * The pot is divided by a scale (the buy-in) so kappa means the same thing at
 * every blind level. Without that, moving the game from 1/2 to 5/10 would
 * silently make every bot five times more tiltable.
 *
 * What tilt does to play is the empirically observed signature, not invented:
 * VPIP up, aggression up, fold-to-3bet down, and a river calling station.
 * All three fall out of two knobs — a tilted player stops feeling losses
 * (loss aversion collapses) and starts seeing bluffs everywhere.
 */

export interface TiltParams {
  /** Per-hand retention. 0.9 leaves about a third of a jolt after ten hands. */
  gamma: number
  /** How hard a jolt lands. 1 means losing a full buy-in as a certain favourite is one unit of tilt. */
  kappa: number
  /** Chips that count as a whole buy-in, so kappa is blind-level independent. */
  scale: number
}

export const HUMAN_TILT: TiltParams = { gamma: 0.9, kappa: 1, scale: 1000 }

/** A bot that never tilts, for controls and for the calm end of the cast. */
export const STOIC_TILT: TiltParams = { gamma: 0.9, kappa: 0, scale: 1000 }

export interface TiltEvent {
  /** The player's equity at the moment the last chips went in, 0..1. */
  equityWhenCommitted: number
  /** The share of the pot they actually got: 0 lost, 0.5 chopped, 1 won. */
  shareWon: number
  /** Chips in the pot when it was decided. */
  potSize: number
}

/**
 * How much of an expectation the hand violated, 0..1.
 *
 * A 90% favourite who loses scores 0.9; a 30% underdog who loses scores 0.3;
 * anyone who wins scores nothing, however lucky they were. The asymmetry is
 * the model's main claim, and it is the reason a bad beat and a slow bleed of
 * the same size are not the same event.
 */
export function expectationViolated(event: TiltEvent): number {
  return Math.max(0, event.equityWhenCommitted - event.shareWon)
}

/** One hand's worth of the recurrence: decay what was there, add what just happened. */
export function updateTilt(tilt: number, event: TiltEvent, params: TiltParams = HUMAN_TILT): number {
  const jolt = (expectationViolated(event) * event.potSize) / params.scale
  return params.gamma * tilt + params.kappa * jolt
}

/** A hand that went by without a showdown still lets the last one fade. */
export function decayTilt(tilt: number, params: TiltParams = HUMAN_TILT): number {
  return params.gamma * tilt
}

/**
 * Tilt is unbounded but its effects are not — a player twice as tilted does
 * not play twice as badly, they just play badly. T/(1+T) maps any amount of
 * tilt onto 0..1 with no cliff and no clamp.
 */
export function tiltIntensity(tilt: number): number {
  return tilt <= 0 ? 0 : tilt / (1 + tilt)
}

export interface TiltEffects {
  /**
   * Multiplier on loss aversion. Falls toward 0.4 as tilt rises: a tilted
   * player has stopped caring what the chips are worth, which is most of what
   * "spewing" means mechanically.
   */
  lambdaScale: number
  /**
   * Added to how often the bot believes an opponent is bluffing. This is the
   * river calling station: nothing about the hand changed, only the story the
   * player is telling themselves about the bet.
   */
  bluffBeliefBoost: number
  /** Added to how often the bot bets or raises rather than checking or calling. */
  aggressionBoost: number
}

export function tiltEffects(tilt: number): TiltEffects {
  const intensity = tiltIntensity(tilt)
  return {
    lambdaScale: 1 - 0.6 * intensity,
    bluffBeliefBoost: 0.25 * intensity,
    aggressionBoost: 0.3 * intensity,
  }
}
