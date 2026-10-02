import type { Card } from '../poker/card'
import type { ActionType, GameState, PokerAction, Street } from '../poker/game-state'
import { positionLabels, type PositionLabel } from '../poker/position'
import type { WeightedAction } from '../ai/agent'
import { readJSON, writeJSON } from '../utils/storage'

/**
 * The human's own hand history: every hand they were dealt, every decision
 * they made in it, what the cards were, and how it ended.
 *
 * This is the one place that looks at the human's hole cards on purpose, so
 * it lives outside `src/ai/`, and nothing there may import it. Bots never see
 * it. Everything is read off the engine's state at the table, never off an
 * observation built for a bot.
 *
 * Only solo games are logged. In pass-and-play several people share the
 * device, and one history mixing them would describe nobody.
 */

/** One public action in the hand, whoever took it. */
export interface LoggedAction {
  player: string
  type: ActionType
  /** For bet/raise/all-in: what the bet was raised to, this street. */
  amount?: number
  street: Street
}

/** How often the solved strategy takes each kind of action in a spot, 0..1 each, summing to 1. */
export interface KindMix {
  fold: number
  /** Check or call. */
  passive: number
  /** Bet, raise or all in. */
  aggressive: number
}

export type ActionKind = keyof KindMix

/** One of the human's decisions, with what they could see when they made it. */
export interface LoggedDecision {
  /** Where this decision sits in the hand's `actions`. */
  index: number
  street: Street
  /** Chips in the middle before acting, bets this street included. */
  pot: number
  toCall: number
  /** Chips behind before acting. */
  stack: number
  /**
   * The solved strategy's mix for this exact spot, where a solve applies
   * (heads-up at a trained depth, or multiway preflop). Absent elsewhere.
   */
  book?: KindMix
  /**
   * What a `PRO` character would have done here, asked the same question at
   * the same moment. Only recorded while hand review or hints are on.
   */
  pro?: LoggedMove
}

/** One specific move: for a bet, raise or all in, `amount` is what the bet was raised to. */
export interface LoggedMove {
  type: ActionType
  amount?: number
}

export interface HandRecord {
  /** Unique across sittings: the session's id and the hand's number. */
  id: string
  session: string
  /** When the hand ended (ms since epoch). */
  at: number
  /** The human's seat id at that table. */
  player: string
  position: PositionLabel | null
  /** Players dealt in. */
  players: number
  bigBlind: number
  /** Chips the human had before posting anything this hand. */
  startStack: number
  /** Hole cards and board, as rank + suit letter ("As", "Td"). */
  cards: string[]
  board: string[]
  actions: LoggedAction[]
  decisions: LoggedDecision[]
  /** Chips won (positive) or lost this hand. */
  net: number
  /** Still in when the cards were turned over, against at least one other hand. */
  showdown: boolean
  /** Won all or part of a pot. */
  won: boolean
}

export function cardCode(card: Card): string {
  return `${card.rank}${card.suit[0]}`
}

/**
 * What kind of action this was: an all in that doesn't raise (a short stack
 * calling off) is a call, not a raise. `level` is the bet to match when it
 * was taken.
 */
export function kindOf(type: ActionType, amount: number | undefined, level: number): ActionKind {
  if (type === 'fold') return 'fold'
  if (type === 'check' || type === 'call') return 'passive'
  if (type === 'all-in' && amount !== undefined && amount <= level) return 'passive'
  return 'aggressive'
}

/** A solved mix, by kind. A solve's all in is always a raise to everything. */
export function mixByKind(mix: WeightedAction[]): KindMix | undefined {
  const byKind: KindMix = { fold: 0, passive: 0, aggressive: 0 }
  for (const { action, probability } of mix) {
    byKind[kindOf(action.type, undefined, 0)] += probability
  }
  const total = byKind.fold + byKind.passive + byKind.aggressive
  if (!(total > 0)) return undefined
  return { fold: byKind.fold / total, passive: byKind.passive / total, aggressive: byKind.aggressive / total }
}

/**
 * Follows one human seat through a sitting and turns each hand into a
 * `HandRecord`. Three calls from the table: when a hand is dealt, before each
 * of the human's actions is applied, and when the hand is over.
 */
export class HandLogger {
  private current: {
    position: PositionLabel | null
    players: number
    bigBlind: number
    startStack: number
    cards: string[]
    decisions: LoggedDecision[]
  } | null = null

  readonly player: string
  readonly session: string

  constructor(player: string, session: string = newSessionId()) {
    this.player = player
    this.session = session
  }

  startHand(state: GameState): void {
    const me = state.players.find((p) => p.id === this.player)
    if (!me || me.isEliminated || me.holeCards.length !== 2) {
      this.current = null
      return
    }
    this.current = {
      position: positionLabels(state).get(this.player) ?? null,
      players: state.players.filter((p) => !p.isEliminated && p.holeCards.length === 2).length,
      bigBlind: state.config.bigBlind,
      startStack: me.stack + me.totalContributed,
      cards: me.holeCards.map(cardCode),
      decisions: [],
    }
  }

  /**
   * Call before the action is applied, with the solve's mix for the spot if
   * there is one, and what a pro would have done if one was asked.
   */
  decision(state: GameState, action: PokerAction, book?: WeightedAction[] | null, pro?: PokerAction | null): void {
    if (!this.current || action.playerId !== this.player) return
    const me = state.players.find((p) => p.id === this.player)
    if (!me) return
    const mix = book ? mixByKind(book) : undefined
    this.current.decisions.push({
      index: state.actionHistory.length,
      street: state.street,
      pot: state.players.reduce((sum, p) => sum + p.totalContributed, 0),
      toCall: Math.max(0, state.currentBet - me.betThisStreet),
      stack: me.stack,
      ...(mix ? { book: mix } : {}),
      ...(pro ? { pro: { type: pro.type, ...(pro.amount !== undefined ? { amount: pro.amount } : {}) } } : {}),
    })
  }

  /** The finished hand, or null if the human wasn't dealt in. Call once the hand is over. */
  endHand(state: GameState): HandRecord | null {
    const hand = this.current
    this.current = null
    const me = state.players.find((p) => p.id === this.player)
    if (!hand || !me) return null
    const stillIn = state.players.filter((p) => !p.folded && p.holeCards.length === 2)
    return {
      id: `${this.session}-${state.handNumber}`,
      session: this.session,
      at: Date.now(),
      player: this.player,
      position: hand.position,
      players: hand.players,
      bigBlind: hand.bigBlind,
      startStack: hand.startStack,
      cards: hand.cards,
      board: state.communityCards.map(cardCode),
      actions: state.actionHistory.map((a) => ({
        player: a.playerId,
        type: a.type,
        ...(a.amount !== undefined ? { amount: a.amount } : {}),
        street: a.street ?? 'preflop',
      })),
      decisions: hand.decisions,
      net: me.stack - hand.startStack,
      showdown: !me.folded && stillIn.length >= 2,
      won: state.lastResults.some((r) => r.winnerIds.includes(this.player)),
    }
  }
}

function newSessionId(): string {
  return Date.now().toString(36) + Math.floor(Math.random() * 36 ** 4).toString(36)
}

// --- storage -----------------------------------------------------------------

export const REVIEW_KEY = 'poker.review'

/**
 * How many hands are kept, newest last. About a kilobyte each, so a few
 * megabytes at most — well inside what a browser allows one site, with room
 * for everything else the app stores.
 */
export const MAX_HANDS = 2000

export interface ReviewData {
  version: 1
  hands: HandRecord[]
}

export function loadReview(): ReviewData {
  const data = readJSON<unknown>(REVIEW_KEY, null)
  if (isReviewData(data)) return data
  return { version: 1, hands: [] }
}

export function appendHand(hand: HandRecord): void {
  const data = loadReview()
  data.hands.push(hand)
  if (data.hands.length > MAX_HANDS) data.hands.splice(0, data.hands.length - MAX_HANDS)
  writeJSON(REVIEW_KEY, data)
}

export function clearReview(): void {
  writeJSON(REVIEW_KEY, { version: 1, hands: [] } satisfies ReviewData)
}

/** The whole history as a JSON file's contents, for download. */
export function exportReview(data: ReviewData = loadReview()): string {
  return JSON.stringify(data, null, 1)
}

function isReviewData(data: unknown): data is ReviewData {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { version?: unknown }).version === 1 &&
    Array.isArray((data as { hands?: unknown }).hands)
  )
}
