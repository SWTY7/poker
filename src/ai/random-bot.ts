import type { PokerAction } from '../poker/game-state'
import type { Rng } from '../utils/random'
import { createRng } from '../utils/random'
import type { Agent } from './agent'
import type { AIObservation } from './observation'

/** Chooses uniformly at random among its legal actions. Useful for exercising the full game loop. */
export class RandomBot implements Agent {
  private rng: Rng

  constructor(rng: Rng = createRng()) {
    this.rng = rng
  }

  decideAction(obs: AIObservation): PokerAction {
    const options = obs.legalActions
    const choice = options[Math.floor(this.rng() * options.length)]

    if (choice === 'bet' || choice === 'raise') {
      const amount = Math.min(obs.minRaiseTo, obs.maxRaiseTo)
      return { playerId: obs.playerId, type: choice, amount }
    }
    return { playerId: obs.playerId, type: choice }
  }
}
