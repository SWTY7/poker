import type { Card } from '../poker/card'
import { rankValue } from '../poker/card'
import { evaluateBestHand } from '../poker/hand-evaluator'
import type { PokerAction } from '../poker/game-state'
import type { Rng } from '../utils/random'
import { createRng } from '../utils/random'
import type { Agent } from './agent'
import type { AIObservation } from './observation'

function preflopStrength(cards: Card[]): number {
  const [a, b] = cards
  const va = rankValue(a.rank)
  const vb = rankValue(b.rank)
  const high = Math.max(va, vb)
  const low = Math.min(va, vb)

  let score = (high + low) / 28
  if (va === vb) score += 0.25
  if (a.suit === b.suit) score += 0.05
  const gap = high - low
  if (gap === 1) score += 0.05
  else if (gap === 2) score += 0.02

  return Math.min(score, 1)
}

/** Rough 0..1 hand strength: no equity simulation, just current best-hand category (or preflop shape). */
export function estimateHandStrength(obs: AIObservation): number {
  const allCards = [...obs.ownCards, ...obs.communityCards]
  if (allCards.length < 5) return preflopStrength(obs.ownCards)
  const value = evaluateBestHand(allCards)
  return (value.categoryRank + 1) / 9
}

export function clamp(amount: number, min: number, max: number): number {
  return Math.min(Math.max(amount, min), max)
}

/**
 * A simple hand-strength / pot-odds bot. No personality, memory, or bias —
 * just enough poker sense to make the game playable. This is the seam the
 * future psychological AI layer replaces or wraps.
 */
export class HeuristicBot implements Agent {
  private rng: Rng

  constructor(rng: Rng = createRng()) {
    this.rng = rng
  }

  decideAction(obs: AIObservation): PokerAction {
    const strength = estimateHandStrength(obs)
    const potOdds = obs.toCall > 0 ? obs.toCall / (obs.potSize + obs.toCall) : 0
    const noise = (this.rng() - 0.5) * 0.1
    const adjusted = strength + noise

    const raiseTarget = () => clamp(obs.minRaiseTo + Math.round(obs.potSize * 0.5), obs.minRaiseTo, obs.maxRaiseTo)

    if (obs.toCall === 0) {
      if (adjusted > 0.55 && obs.legalActions.includes('bet')) {
        const amount = clamp(Math.round(obs.potSize * 0.6), obs.minRaiseTo, obs.maxRaiseTo)
        return { playerId: obs.playerId, type: 'bet', amount }
      }
      if (adjusted > 0.6 && obs.legalActions.includes('raise')) {
        return { playerId: obs.playerId, type: 'raise', amount: raiseTarget() }
      }
      return { playerId: obs.playerId, type: 'check' }
    }

    if (adjusted > 0.75 && obs.legalActions.includes('raise')) {
      return { playerId: obs.playerId, type: 'raise', amount: raiseTarget() }
    }
    if (adjusted >= potOdds && obs.legalActions.includes('call')) {
      return { playerId: obs.playerId, type: 'call' }
    }
    return { playerId: obs.playerId, type: 'fold' }
  }
}
