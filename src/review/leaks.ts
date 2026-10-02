import type { ActionKind, HandRecord, LoggedAction } from './log'
import { kindOf } from './log'

/**
 * Where the human's play departs from the solved strategy.
 *
 * Only decisions a solve covers count: heads-up at a trained depth, or
 * before the flop with three or more dealt in. At each, the solve's mix is
 * what was logged (`LoggedDecision.book`). A solve plays mixed strategies,
 * so no single hand is a mistake just for being rare. What this looks for is
 * a *pattern*: a kind of action (fold, check/call, bet/raise) the solve
 * almost never takes in a spot, taken again and again.
 *
 * "Cost" here is not chips lost. The trained files store how often to play
 * each action, not what each is worth, so the real price of a deviation
 * isn't known. It is a stand-in that ranks the right things first: how
 * rarely the solve plays what they did, times how big the pot was.
 */

/** A kind of action the solve takes less often than this, in a spot, is off the book there. */
export const RARE = 0.1

/** Off the book once is a hand; this many times in the same spot, the same way, is a habit worth naming. */
export const MIN_REPEATS = 2

export interface Leak {
  /** Plain-words name of the spot, e.g. "Preflop, facing a raise". */
  spot: string
  /** What they did there that the solve rarely does. */
  did: ActionKind
  /** What the solve mostly does there instead. */
  bookPrefers: ActionKind
  /** Times it happened. */
  count: number
  /** Covered decisions in this spot. */
  of: number
  /** Sum over those decisions of (1 − the solve's share of what they did) × pot in big blinds. */
  cost: number
}

export interface LeakReport {
  /** Decisions a solve covered. */
  covered: number
  /** Of those, how many were a kind the solve plays at least RARE of the time. */
  onBook: number
  /** Habits (seen at least MIN_REPEATS times), worst first. */
  leaks: Leak[]
  /** Off-book decisions that haven't repeated yet, so aren't listed. */
  oneOffs: number
}

/** The spot a decision was made in, in words anyone at the table would use. */
export function spotOf(hand: HandRecord, index: number): string {
  const street = hand.actions[index]?.street ?? 'preflop'
  const before = hand.actions.slice(0, index).filter((a) => a.street === street)
  const raises = countAggressive(before, street === 'preflop' ? hand.bigBlind : 0)
  const name = street[0].toUpperCase() + street.slice(1)
  if (street === 'preflop') {
    if (raises === 0) return `${name}, first in${hand.position ? ` from ${hand.position}` : ''}`
    if (raises === 1) return `${name}, facing a raise`
    return `${name}, facing a re-raise`
  }
  if (raises === 0) return `${name}, checked to you or first to act`
  return raises === 1 ? `${name}, facing a bet` : `${name}, facing a raise`
}

function countAggressive(actions: LoggedAction[], opening: number): number {
  let level = opening
  let count = 0
  for (const a of actions) {
    if (kindOf(a.type, a.amount, level) === 'aggressive') {
      count++
      if (a.amount !== undefined) level = Math.max(level, a.amount)
    }
  }
  return count
}

function levelBefore(hand: HandRecord, index: number): number {
  const street = hand.actions[index]?.street ?? 'preflop'
  let level = street === 'preflop' ? hand.bigBlind : 0
  for (const a of hand.actions.slice(0, index)) {
    if (a.street !== street) continue
    if (kindOf(a.type, a.amount, level) === 'aggressive' && a.amount !== undefined) level = Math.max(level, a.amount)
  }
  return level
}

export function findLeaks(hands: HandRecord[], limit = 5): LeakReport {
  let covered = 0
  let onBook = 0
  const bySpot = new Map<string, { of: number; deviations: Map<string, Leak> }>()

  for (const hand of hands) {
    for (const decision of hand.decisions) {
      if (!decision.book) continue
      const action = hand.actions[decision.index]
      if (!action || action.player !== hand.player) continue
      covered++
      const did = kindOf(action.type, action.amount, levelBefore(hand, decision.index))
      const spot = spotOf(hand, decision.index)
      let entry = bySpot.get(spot)
      if (!entry) {
        entry = { of: 0, deviations: new Map() }
        bySpot.set(spot, entry)
      }
      entry.of++
      const share = decision.book[did]
      if (share >= RARE) {
        onBook++
        continue
      }
      const bookPrefers = (Object.entries(decision.book) as [ActionKind, number][]).reduce((a, b) => (b[1] > a[1] ? b : a))[0]
      const key = `${did}>${bookPrefers}`
      const leak = entry.deviations.get(key) ?? { spot, did, bookPrefers, count: 0, of: 0, cost: 0 }
      leak.count++
      leak.cost += (1 - share) * (hand.bigBlind > 0 ? decision.pot / hand.bigBlind : 0)
      entry.deviations.set(key, leak)
    }
  }

  const leaks: Leak[] = []
  let oneOffs = 0
  for (const entry of bySpot.values()) {
    for (const leak of entry.deviations.values()) {
      if (leak.count >= MIN_REPEATS) leaks.push({ ...leak, of: entry.of })
      else oneOffs += leak.count
    }
  }
  leaks.sort((a, b) => b.cost - a.cost)
  return { covered, onBook, leaks: leaks.slice(0, limit), oneOffs }
}
