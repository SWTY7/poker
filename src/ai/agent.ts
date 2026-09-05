import type { PokerAction } from '../poker/game-state'
import type { AIObservation } from './observation'

/**
 * An AI player only ever sees an AIObservation and only ever proposes a
 * PokerAction — it never touches GameState directly. This boundary is what
 * lets a future psychology/personality layer replace these bots without
 * the engine or UI changing.
 */
export interface Agent {
  decideAction(observation: AIObservation): PokerAction
}
