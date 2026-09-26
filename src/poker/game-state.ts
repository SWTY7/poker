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
  /**
   * The street it was taken on. Stamped by the engine when an action is
   * recorded into the hand's history — anyone at the table knows which
   * street a bet came on, and reading a hand back depends on it. Absent on an
   * action an agent is only proposing.
   */
  street?: Street
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
  kind: 'blind' | 'ante' | 'action' | 'deal' | 'reveal' | 'result'
  playerId?: string
  playerName?: string
  actionType?: ActionType
  /** Chips this event moved into the pot. */
  amount?: number
  /** For bet/raise: the total this player's bet now stands at, this street. */
  toAmount?: number
  /** Community cards turned over on a 'deal' entry, or one player's hole cards on a 'reveal' entry. */
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
  /**
   * Player ids in the order they busted, earliest first. Set once and never
   * reset by `startHand` — unlike almost everything else in this file, it is
   * scoped to the whole session (in practice, the whole tournament) rather
   * than to one hand. This is what turns "who's left" into "who finished
   * where": the first name here took last place, and whoever is never added
   * because they never busted took first.
   */
  eliminationOrder: string[]
}
