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
  /**
   * How the hand this agent just played ended. Optional, because most agents
   * have no memory and do not want one — only a bot with emotional state
   * needs to know whether the pot it lost was one it was supposed to lose.
   */
  observeResult?(outcome: HandOutcome): void
}

/** What an agent is told about a finished hand, from its own seat's view. */
export interface HandOutcome {
  /** Chips in front of this player once the pot was pushed. */
  stack: number
  /** The share of the pot they got: 0 lost, 0.5 chopped with one other, 1 won. */
  shareWon: number
  /** Chips that were in the pot. */
  potSize: number
}
