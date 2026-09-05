import type { PokerAction } from '../../poker/game-state'
import type { Rng } from '../../utils/random'
import { createRng } from '../../utils/random'
import type { Agent } from '../agent'
import type { AIObservation } from '../observation'
import { clamp, estimateHandStrength } from '../heuristic-bot'
import type { PersonalityProfile } from './personality'
import { NEUTRAL_PERSONALITY, applyPersonalityShift } from './personality'
import { maybeBluff } from './bluff'

/**
 * Same strength/pot-odds skeleton as HeuristicBot, but every decision
 * threshold is shifted by the bot's personality first (see personality.ts).
 * With NEUTRAL_PERSONALITY this behaves identically to HeuristicBot.
 */
export class PersonalityBot implements Agent {
  private rng: Rng
  private profile: PersonalityProfile

  constructor(profile: PersonalityProfile = NEUTRAL_PERSONALITY, rng: Rng = createRng()) {
    this.profile = profile
    this.rng = rng
  }

  decideAction(obs: AIObservation): PokerAction {
    const strength = estimateHandStrength(obs)
    const potOdds = obs.toCall > 0 ? obs.toCall / (obs.potSize + obs.toCall) : 0
    const noise = (this.rng() - 0.5) * 0.1
    const adjusted = strength + noise
    const { effectiveForBet, effectiveForCall, effectiveForRaiseFacingBet } = applyPersonalityShift(
      adjusted,
      this.profile,
    )

    const raiseTarget = () => clamp(obs.minRaiseTo + Math.round(obs.potSize * 0.5), obs.minRaiseTo, obs.maxRaiseTo)
    const bluffBetAmount = () => clamp(Math.round(obs.potSize * 0.6), obs.minRaiseTo, obs.maxRaiseTo)

    if (obs.toCall === 0) {
      if (effectiveForBet > 0.55 && obs.legalActions.includes('bet')) {
        return { playerId: obs.playerId, type: 'bet', amount: bluffBetAmount() }
      }
      if (effectiveForBet > 0.6 && obs.legalActions.includes('raise')) {
        return { playerId: obs.playerId, type: 'raise', amount: raiseTarget() }
      }
      if (
        this.profile.bluffFrequency > 0 &&
        obs.legalActions.includes('bet') &&
        maybeBluff(this.rng, this.profile, { strength: adjusted, toCall: obs.toCall })
      ) {
        return { playerId: obs.playerId, type: 'bet', amount: bluffBetAmount() }
      }
      return { playerId: obs.playerId, type: 'check' }
    }

    if (effectiveForRaiseFacingBet > 0.75 && obs.legalActions.includes('raise')) {
      return { playerId: obs.playerId, type: 'raise', amount: raiseTarget() }
    }
    if (effectiveForCall >= potOdds && obs.legalActions.includes('call')) {
      return { playerId: obs.playerId, type: 'call' }
    }
    return { playerId: obs.playerId, type: 'fold' }
  }
}
