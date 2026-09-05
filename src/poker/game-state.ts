import type { Card } from './card'
import type { Deck } from './deck'
import type { PlayerState } from './player'

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown'

export interface Pot {
  amount: number
  eligiblePlayerIds: string[]
}

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in'

export interface PokerAction {
  playerId: string
  type: ActionType
  /** For bet/raise/all-in: the TOTAL amount the player's bet is raised TO this street. */
  amount?: number
}

export interface HandResult {
  potAmount: number
  winnerIds: string[]
  /** Best-hand category name for winners, when the hand went to showdown. */
  category?: string
}

/**
 * One line of the running narration of a hand: who did what, when the board
 * changed, and how the pot stood afterwards. The engine appends these as it
 * goes so the UI never has to reconstruct the story from raw state — that
 * reconstruction is what made the table feel like it moved on its own.
 */
export interface HandLogEntry {
  /** Monotonic within a hand; a stable React key and an ordering guarantee. */
  seq: number
  street: Street
  kind: 'blind' | 'ante' | 'action' | 'deal' | 'result'
  playerId?: string
  playerName?: string
  actionType?: ActionType
  /** Chips this event moved into the pot. */
  amount?: number
  /** For bet/raise: the total this player's bet now stands at, this street. */
  toAmount?: number
  /** Cards turned over on a 'deal' entry. */
  cards?: Card[]
  /** Human-readable summary, used for 'result' entries. */
  message?: string
  /** Total chips in the middle once this event resolved. */
  potAfter: number
}

export interface GameConfig {
  smallBlind: number
  bigBlind: number
  ante: number
}

export interface GameState {
  players: PlayerState[]
  communityCards: Card[]
  pots: Pot[]
  dealerIndex: number
  smallBlindIndex: number
  bigBlindIndex: number
  currentPlayerIndex: number
  currentBet: number
  minRaise: number
  street: Street
  actionHistory: PokerAction[]
  /** Narration of the hand in progress, in order. Reset each hand. */
  handLog: HandLogEntry[]
  config: GameConfig
  handNumber: number
  handInProgress: boolean
  lastResults: HandResult[]
  deck: Deck
}
