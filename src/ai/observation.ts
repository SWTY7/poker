import type { Card } from '../poker/card'
import type { ActionType, PokerAction, Street } from '../poker/game-state'
import type { HoldemEngine } from '../poker/game-engine'
import { minRaiseTargetAmount, maxRaiseTargetAmount } from '../poker/betting'

export interface ObservedPlayer {
  id: string
  stack: number
  betThisStreet: number
  folded: boolean
  isAllIn: boolean
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
