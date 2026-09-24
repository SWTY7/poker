import type { Card } from '../poker/card'
import type { ActionType, PokerAction, Street } from '../poker/game-state'
import type { HoldemEngine } from '../poker/game-engine'
import { minRaiseTargetAmount, maxRaiseTargetAmount } from '../poker/betting'
import { positionLabels, type PositionLabel } from '../poker/position'

export interface ObservedPlayer {
  id: string
  stack: number
  betThisStreet: number
  folded: boolean
  isAllIn: boolean
  /**
   * This seat's position, by the same labels the table's own seat tags use
   * (see poker/position.ts) — null only in a state positionLabels() itself
   * declines to label (fewer than two live players, no dealer assigned yet).
   * Position doesn't change what a hand is worth on the cards; it changes how
   * much of that a seat gets to keep, which is what math/realization.ts is
   * for — this is what lets an agent reach it, for itself or an opponent.
   */
  position: PositionLabel | null
}

/**
 * What an AI agent is allowed to see. No opponent hole cards, no deck state
 * — only what a player sitting at the table could actually know.
 */
export interface AIObservation {
  playerId: string
  ownCards: Card[]
  communityCards: Card[]
  potSize: number
  players: ObservedPlayer[]
  legalActions: ActionType[]
  street: Street
  currentBet: number
  toCall: number
  minRaiseTo: number
  maxRaiseTo: number
  actionHistory: PokerAction[]
  /**
   * The big blind, in chips. Every bet an agent reasons about is really a
   * multiple of it — a 300 chip raise means nothing without knowing whether
   * that is three big blinds or thirty — and a solved strategy is stated in
   * big blinds, so it needs the conversion.
   */
  bigBlind: number
}

export function buildObservation(engine: HoldemEngine, playerId: string): AIObservation {
  const state = engine.state
  const player = state.players.find((p) => p.id === playerId)
  if (!player) throw new Error(`Unknown player: ${playerId}`)

  const potSize = state.players.reduce((sum, p) => sum + p.totalContributed, 0)
  const positions = positionLabels(state)

  return {
    playerId,
    ownCards: player.holeCards,
    communityCards: state.communityCards,
    potSize,
    players: state.players.map((p) => ({
      id: p.id,
      stack: p.stack,
      betThisStreet: p.betThisStreet,
      folded: p.folded,
      isAllIn: p.isAllIn,
      position: positions.get(p.id) ?? null,
    })),
    legalActions: engine.getLegalActions(playerId),
    street: state.street,
    currentBet: state.currentBet,
    toCall: state.currentBet - player.betThisStreet,
    minRaiseTo: minRaiseTargetAmount(state),
    maxRaiseTo: maxRaiseTargetAmount(state, playerId),
    actionHistory: state.actionHistory,
    bigBlind: state.config.bigBlind,
  }
}
