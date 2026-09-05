import type { Card } from './card'

export interface PlayerState {
  id: string
  name: string
  stack: number
  holeCards: Card[]
  folded: boolean
  isAllIn: boolean
  /** Chips put in during the current street. */
  betThisStreet: number
  /** Chips put in across the whole hand (used for side-pot math). */
  totalContributed: number
  /** Has this player acted since the last bet/raise on this street? */
  hasActed: boolean
  /** Out of the game (busted). Skipped when dealing/rotating the button. */
  isEliminated: boolean
}

export function createPlayer(id: string, name: string, stack: number): PlayerState {
  return {
    id,
    name,
    stack,
    holeCards: [],
    folded: false,
    isAllIn: false,
    betThisStreet: 0,
    totalContributed: 0,
    hasActed: false,
    isEliminated: false,
  }
}
