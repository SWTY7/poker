import type { Card, Rank, Suit } from '../poker/card'
import type { Street } from '../poker/game-state'
import { toCardInt, type CardInt } from '../poker/fast/cards'
import { multiwayEquity } from '../math/equity'
import { fullRange } from '../math/range'
import type { Rng } from '../utils/random'
import { createRng } from '../utils/random'
import { kindOf, type ActionKind, type HandRecord, type KindMix, type LoggedMove } from './log'
import { RARE, levelBefore, spotOf } from './leaks'

/**
 * One hand, gone back over decision by decision: what you did, what the
 * solve does in that spot, how good your hand was at the time, and what a
 * professional (the `PRO` character, asked the same question at the same
 * moment) would have done.
 *
 * Everything here is read off a finished `HandRecord`, so it works the same
 * for the hand just played and for any hand in the history.
 */

/**
 * How your action sits against the solve's mix:
 *   book   the solve's most frequent kind of action here
 *   mixed  one the solve plays too, just less often
 *   off    one it plays under `RARE` of the time
 *   none   no solve covers this spot
 */
export type Verdict = 'book' | 'mixed' | 'off' | 'none'

export interface ReviewedDecision {
  /** Plain-words name of the spot, e.g. "Flop, facing a bet". */
  spot: string
  street: Street
  /** The board as it was when you decided. */
  board: string[]
  pot: number
  toCall: number
  you: LoggedMove
  yourKind: ActionKind
  /** In words, e.g. "raised to $60". */
  youSaid: string
  book?: KindMix
  /** The solve's mix in words, most frequent first, e.g. "raise 85%, call 15%". */
  bookSaid?: string
  verdict: Verdict
  /**
   * Share of the pot your hand would win against random hands for every
   * opponent still in, 0..1. Null when not asked for (`equity: false`).
   */
  equity: number | null
  /** Opponents still in when you decided. */
  opponents: number
  pro?: LoggedMove
  /** In words, e.g. "would have called". */
  proSaid?: string
  /** True when the pro would have taken the same kind of action (fold / check-call / bet-raise). */
  proAgrees?: boolean
}

export interface HandReview {
  hand: HandRecord
  decisions: ReviewedDecision[]
  /** Decisions a solve covered, and how many of those were off it. */
  covered: number
  offBook: number
}

/** Samples per equity figure: within about a percentage point, and fast enough to run at the end of every hand. */
const EQUITY_SAMPLES = 2000

export function reviewHand(
  hand: HandRecord,
  options: { samples?: number; rng?: Rng; equity?: boolean } = {},
): HandReview {
  const rng = options.rng ?? createRng()
  const hero = hand.cards.map(parseCardCode)
  const decisions: ReviewedDecision[] = []
  let covered = 0
  let offBook = 0

  for (const decision of hand.decisions) {
    const action = hand.actions[decision.index]
    if (!action || action.player !== hand.player) continue
    const level = levelBefore(hand, decision.index)
    const you: LoggedMove = { type: action.type, ...(action.amount !== undefined ? { amount: action.amount } : {}) }
    const yourKind = kindOf(action.type, action.amount, level)
    const board = hand.board.slice(0, BOARD_SIZE[decision.street] ?? 0)
    const opponents = opponentsStillIn(hand, decision.index)

    const verdict = decision.book ? verdictOf(decision.book, yourKind) : 'none'
    if (decision.book) covered++
    if (verdict === 'off') offBook++

    const equity =
      options.equity === false
        ? null
        : hero.length === 2 && opponents > 0
        ? multiwayEquity(
            [toCardInt(hero[0]), toCardInt(hero[1])] as [CardInt, CardInt],
            Array.from({ length: opponents }, () => fullRange()),
            board.map((code) => toCardInt(parseCardCode(code))),
            { samples: options.samples ?? EQUITY_SAMPLES, rng },
          )
        : 1

    const reviewed: ReviewedDecision = {
      spot: spotOf(hand, decision.index),
      street: decision.street,
      board,
      pot: decision.pot,
      toCall: decision.toCall,
      you,
      yourKind,
      youSaid: describeMove(you, decision.toCall, decision.street, level, 'past'),
      verdict,
      equity,
      opponents,
    }
    if (decision.book) {
      reviewed.book = decision.book
      reviewed.bookSaid = describeMix(decision.book, decision.toCall, decision.street)
    }
    if (decision.pro) {
      reviewed.pro = decision.pro
      reviewed.proSaid = describeMove(decision.pro, decision.toCall, decision.street, level, 'would')
      reviewed.proAgrees = kindOf(decision.pro.type, decision.pro.amount, level) === yourKind
    }
    decisions.push(reviewed)
  }

  return { hand, decisions, covered, offBook }
}

export function verdictOf(book: KindMix, kind: ActionKind): Verdict {
  const share = book[kind]
  if (share < RARE) return 'off'
  const top = Math.max(book.fold, book.passive, book.aggressive)
  return share >= top ? 'book' : 'mixed'
}

/** What each kind of action is called in a spot: you check or bet when nothing is owed, call or raise when something is. */
export function kindWord(kind: ActionKind, toCall: number, street: Street): string {
  if (kind === 'fold') return 'fold'
  if (kind === 'passive') return toCall > 0 ? 'call' : 'check'
  return toCall > 0 || street === 'preflop' ? 'raise' : 'bet'
}

/** A mix in words, most frequent first, leaving out what the solve never does: "raise 85%, call 15%". */
export function describeMix(mix: KindMix, toCall: number, street: Street): string {
  return (Object.entries(mix) as [ActionKind, number][])
    .filter(([, share]) => Math.round(share * 100) > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, share]) => `${kindWord(kind, toCall, street)} ${Math.round(share * 100)}%`)
    .join(', ')
}

/** One move in words, either as done ("raised to $60") or as advice ("would raise to $60"). */
export function describeMove(
  move: LoggedMove,
  toCall: number,
  street: Street,
  level: number,
  tense: 'past' | 'would',
): string {
  const kind = kindOf(move.type, move.amount, level)
  const word = kindWord(kind, toCall, street)
  const past = tense === 'past'
  if (move.type === 'all-in') {
    return kind === 'passive'
      ? past
        ? 'called all in'
        : 'would call all in'
      : past
        ? 'went all in'
        : 'would go all in'
  }
  const verb = past ? PAST[word] : `would ${word}`
  if (kind === 'aggressive' && move.amount !== undefined) {
    return `${verb} ${word === 'bet' ? '' : 'to '}$${move.amount.toLocaleString()}`
  }
  if (kind === 'passive' && toCall > 0) return `${verb} $${toCall.toLocaleString()}`
  return verb
}

const PAST: Record<string, string> = {
  fold: 'folded',
  check: 'checked',
  call: 'called',
  bet: 'bet',
  raise: 'raised',
}

const BOARD_SIZE: Partial<Record<Street, number>> = { preflop: 0, flop: 3, turn: 4, river: 5 }

/** Players dealt in, less you, less everyone who had folded before this decision. */
function opponentsStillIn(hand: HandRecord, index: number): number {
  const folded = new Set<string>()
  for (const a of hand.actions.slice(0, index)) {
    if (a.type === 'fold' && a.player !== hand.player) folded.add(a.player)
  }
  return Math.max(hand.players - 1 - folded.size, 0)
}

const SUIT_BY_LETTER: Record<string, Suit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }

/** "As" → the ace of spades: the inverse of `cardCode`. */
export function parseCardCode(code: string): Card {
  return { rank: code[0] as Rank, suit: SUIT_BY_LETTER[code[1]] }
}
