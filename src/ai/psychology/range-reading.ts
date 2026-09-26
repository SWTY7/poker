import { COMBO_A, COMBO_B, COMBO_CLASS, COMBO_COUNT, classCombos } from '../../math/combos'
import { classStrengthOrder, OPEN_PERCENT } from '../../math/realization'
import { emptyRange, type Range } from '../../math/range'
import type { CardInt } from '../../poker/fast/cards'
import { toCardInts } from '../../poker/fast/cards'
import type { PokerAction, Street } from '../../poker/game-state'
import type { PositionLabel } from '../../poker/position'
import { DEFAULT_BUCKETS, NO_BUCKET, bucketOf } from '../../gto/holdem/buckets'
import type { AIObservation } from '../observation'
import type { PostflopRates } from './opponent-model'

/**
 * Reading a hand: what each opponent can still be holding, given everything
 * they have done since the cards were dealt.
 *
 * It is Bayes' rule, one action at a time. Every opponent starts able to
 * hold any two cards. Each time they act, every combo's weight is multiplied
 * by how likely that action was *with that combo*: a raise multiplies the
 * strong hands by nearly one and the medium ones by very little; a check
 * does the reverse. Three streets later the weights say what a person
 * across the table would say — "he check-called the flop and led the turn,
 * so a draw that got there or a slowplayed set, not top pair".
 *
 * How likely an action is with a combo is a small, explainable model, not a
 * solve. After the flop, each action is taken by the top of what the player
 * can still hold, as much of it as *this player* is seen taking that action
 * (the opponent model's postflop rates) — plus, for bets and raises, some of
 * the weakest of it (bluffs), as many as they are believed to bluff.
 * Preflop, where nobody has shown their game yet, the widths are population
 * norms by position. Strength is the hand's percentile on the board *as it
 * was then*: the same run-out-sampled, draw-aware measure buckets.ts gives
 * the solver, so a flush draw that bet the flop reads as a hand that bets
 * the flop.
 *
 * Nothing is ever ruled out completely (`FLOOR`): people make strange
 * plays, and a combo zeroed on the flop could never come back, however the
 * rest of the hand went.
 */

/** Weight kept by a combo the model thinks almost never takes this action. */
const FLOOR = 0.03

/** How sharp the edge of a range is, in percentile — a blurred cut, not a wall. */
const SOFTNESS = 0.06

/** Preflop re-raise (3-bet and up) width: population norm, since nobody has shown their game yet. */
const RERAISE_WIDTH = 0.08

/** Preflop flat call or limp width. */
const PREFLOP_CALL_WIDTH = 0.45

/** Bluffs come from the weakest part of a player's range — its bottom this share. */
const BLUFF_REGION = 0.35

/** Beyond half, "bluffs" would outnumber the hands being represented — not a player, a random number generator. */
const MAX_BLUFF_SHARE = 0.5

type Move = 'openRaise' | 'reraise' | 'preflopCall' | 'preflopCheck' | 'bet' | 'raise' | 'call' | 'check'

const BOARD_CARDS: Record<Street, number> = { preflop: 0, flop: 3, turn: 4, river: 5, showdown: 5 }

/**
 * Reads the range of each of `playerIds` from this hand's action history.
 * `bluffShare` is the share of that opponent's bets believed to be bluffs —
 * the same belief PsychBot already holds about them. `rates` is how often
 * that opponent bets, folds, calls and raises after the flop (the opponent
 * model's measured read, blended toward normal), which sets how wide each
 * postflop action's range is.
 */
export function readRanges(
  obs: AIObservation,
  playerIds: string[],
  bluffShare: (playerId: string) => number,
  rates: (playerId: string) => PostflopRates,
): Map<string, Range> {
  const board = toCardInts(obs.communityCards)
  const ranges = new Map<string, Range>()
  for (const id of playerIds) ranges.set(id, new Float64Array(COMBO_COUNT).fill(1))

  let street: Street | null = null
  let level = 0
  for (const action of obs.actionHistory) {
    // An action with no street stamp is one described by hand rather than
    // recorded by the engine; the only street it can belong to is this one.
    const actionStreet = action.street ?? obs.street
    if (actionStreet !== street) {
      street = actionStreet
      level = street === 'preflop' ? (obs.bigBlind ?? 0) : 0
    }

    const move = classify(action, street, level, obs.bigBlind ?? 0)
    if (action.amount !== undefined && action.amount > level) level = action.amount
    const range = ranges.get(action.playerId)
    if (!range || !move) continue

    const strength =
      street === 'preflop' ? preflopPercentiles() : postflopPercentiles(board.slice(0, BOARD_CARDS[street]))
    // Combos the board has made impossible go first, so every cut below is
    // taken over hands they could actually be holding.
    for (let id = 0; id < COMBO_COUNT; id++) if (strength[id] < 0) range[id] = 0

    const bluffs = Math.min(Math.max(bluffShare(action.playerId), 0), MAX_BLUFF_SHARE)
    const likely =
      street === 'preflop'
        ? preflopLikelihood(move, obs.players.find((p) => p.id === action.playerId)?.position ?? null)
        : postflopLikelihood(move, range, strength, rates(action.playerId), bluffs)

    let peak = 0
    for (let id = 0; id < COMBO_COUNT; id++) {
      if (range[id] === 0) continue
      range[id] *= Math.max(FLOOR, likely(strength[id]))
      if (range[id] > peak) peak = range[id]
    }
    // Only the ratios mean anything; keep the numbers from drifting toward zero.
    if (peak > 0) for (let id = 0; id < COMBO_COUNT; id++) range[id] /= peak
  }

  return ranges
}

/** What an action says about the hand behind it, or null if it says nothing (a fold ends the read). */
function classify(action: PokerAction, street: Street, level: number, bigBlind: number): Move | null {
  const preflop = street === 'preflop'
  const aggressive =
    action.type === 'bet' || action.type === 'raise' || (action.type === 'all-in' && (action.amount ?? 0) > level)

  if (action.type === 'fold') return null
  if (aggressive) {
    if (preflop) return level <= bigBlind ? 'openRaise' : 'reraise'
    return level > 0 ? 'raise' : 'bet'
  }
  if (action.type === 'check') return preflop ? 'preflopCheck' : 'check'
  // A call, or an all-in for no more than the bet it faces — a call either way.
  return preflop ? 'preflopCall' : 'call'
}

/** Rises from 0 to 1 around `cut`: hands above the cut do it, hands below don't. */
function above(s: number, cut: number): number {
  return 1 / (1 + Math.exp(-(s - cut) / SOFTNESS))
}

/**
 * Preflop, a range is read against population norms: nobody has shown how
 * they play yet this hand, and an open is mostly about position — how wide
 * each seat opens is `OPEN_PERCENT`.
 */
function preflopLikelihood(move: Move, position: PositionLabel | null): (s: number) => number {
  const openWidth = position ? OPEN_PERCENT[position] : 0.25
  switch (move) {
    case 'openRaise':
      return (s) => above(s, 1 - openWidth)
    case 'reraise':
      return (s) => above(s, 1 - RERAISE_WIDTH)
    case 'preflopCall':
      // The very top usually raises rather than flats.
      return (s) => above(s, 1 - PREFLOP_CALL_WIDTH) * (1 - 0.7 * above(s, 0.95))
    default:
      // The big blind declining to raise — mild information, most hands check.
      return (s) => 1 - 0.7 * above(s, 0.8)
  }
}

/**
 * After the flop, each action is read *relative to what this player can
 * still be holding* and at *how often this player takes it*: someone who
 * bets 60% of the time when checked to is betting the top 60% of their
 * range, someone who bets 20% the top 20%. A fixed width here (it was once
 * "bets are the top 35% of all hands") reads an aggressive player's bets as
 * far stronger than they are — measured, it made the bot fold to them and
 * lose (docs/combined-bot.md).
 *
 * Aggressive actions split into value — the top of the range — and bluffs
 * from its bottom `BLUFF_REGION`, in the believed share. A call is the band
 * between what folds (the bottom `fold` share) and what raises for value.
 */
function postflopLikelihood(
  move: Move,
  range: Range,
  strength: Float64Array,
  rates: PostflopRates,
  bluffShare: number,
): (s: number) => number {
  const cut = (share: number) => topShareCut(range, strength, share)
  const airCut = cut(1 - BLUFF_REGION)
  const aggressive = (width: number) => {
    const valueCut = cut(width * (1 - bluffShare))
    const airRate = Math.min(1, (width * bluffShare) / BLUFF_REGION)
    return (s: number) => Math.min(1, above(s, valueCut) + airRate * (1 - above(s, airCut)))
  }
  switch (move) {
    case 'bet':
      return aggressive(rates.bet)
    case 'raise':
      return aggressive(rates.raise)
    case 'check': {
      // Whatever would have bet mostly didn't — a slowplay keeps some of it.
      const bets = aggressive(rates.bet)
      return (s) => 1 - 0.85 * bets(s)
    }
    default: {
      const foldCut = cut(1 - rates.fold)
      const raiseCut = cut(rates.raise * (1 - bluffShare))
      return (s) => above(s, foldCut) * (1 - 0.8 * above(s, raiseCut))
    }
  }
}

/**
 * The strength above which `share` of this range's weight lies — "their top
 * 40%" as a percentile on the board. 1 for no share, below every hand for
 * all of it.
 */
function topShareCut(range: Range, strength: Float64Array, share: number): number {
  const ids: number[] = []
  let total = 0
  for (let id = 0; id < COMBO_COUNT; id++) {
    if (range[id] > 0 && strength[id] >= 0) {
      ids.push(id)
      total += range[id]
    }
  }
  if (share <= 0 || total <= 0) return 1 + SOFTNESS * 4
  ids.sort((x, y) => strength[y] - strength[x])
  const target = Math.min(share, 1) * total
  let seen = 0
  for (const id of ids) {
    seen += range[id]
    if (seen >= target) return strength[id]
  }
  return -SOFTNESS * 4
}

// --- against a bet: who folds, who continues, and what the hero's cards block ---

/**
 * How an opponent's range splits against a bet: the share of it that folds,
 * as the hero sees it, and the weighted part that continues (for measuring
 * equity when called). Null if nothing is left of the range to split.
 *
 * Who continues is decided the way the opponent would decide it, which means
 * *without* knowing the hero's cards:
 *
 *   - anything in `strong` — hands good enough to continue whatever else
 *     they hold — continues;
 *   - and so does the top `defence` share of their own range, however weak
 *     that range is. A player who has check-called twice holds a capped
 *     range of medium hands, and those are exactly the hands they call a
 *     river bet with: nobody folds everything just because none of it is
 *     the nuts. Measuring only against the top of *all* hands would have
 *     them fold a capped range almost every time, which is how a bot talks
 *     itself into bluffing every checked-to river.
 *
 * Then the hero's own cards come out, and that is the whole of blocker
 * reasoning: the opponent's plan doesn't change, but the combos the hero is
 * holding can't be in their hand. Hold the ace of the flush suit and their
 * nut flushes — part of what continues — are gone, so more of what's left
 * folds. Hold cards they would have folded, and the reverse.
 */
export function splitAgainstBet(
  range: Range,
  strong: Range,
  defence: number,
  board: CardInt[],
  hole: readonly CardInt[],
): { folds: number; called: Range } | null {
  const onBoard = new Uint8Array(52)
  for (const card of board) onBoard[card] = 1
  const strength = board.length === 0 ? preflopPercentiles() : postflopPercentiles(board)

  // Their plan: rank what they can hold (the board is all they know) and
  // mark the top `defence` share of it as continuing.
  const theirs: number[] = []
  let theirTotal = 0
  for (let id = 0; id < COMBO_COUNT; id++) {
    if (range[id] <= 0 || onBoard[COMBO_A[id]] || onBoard[COMBO_B[id]]) continue
    theirs.push(id)
    theirTotal += range[id]
  }
  theirs.sort((x, y) => strength[y] - strength[x])
  const continues = new Float64Array(COMBO_COUNT)
  let room = Math.min(Math.max(defence, 0), 1) * theirTotal
  for (const id of theirs) {
    if (room <= 0) break
    continues[id] = Math.min(1, room / range[id])
    room -= range[id]
  }
  for (const id of theirs) if (strong[id] > 0) continues[id] = 1

  // What the hero sees: the same plan, minus every combo the hero holds a card of.
  const called = emptyRange()
  let total = 0
  let kept = 0
  for (const id of theirs) {
    if (COMBO_A[id] === hole[0] || COMBO_A[id] === hole[1] || COMBO_B[id] === hole[0] || COMBO_B[id] === hole[1]) {
      continue
    }
    total += range[id]
    called[id] = range[id] * continues[id]
    kept += called[id]
  }
  if (total <= 0 || kept <= 0) return null
  return { folds: 1 - kept / total, called }
}

// --- strength percentiles ----------------------------------------------------

let preflopTable: Float64Array | null = null

/** Each combo's preflop strength percentile, 1 the best — from the same measured order topPercentRange uses. */
function preflopPercentiles(): Float64Array {
  if (preflopTable) return preflopTable
  const table = new Float64Array(COMBO_COUNT)
  let stronger = 0
  for (const classIndex of classStrengthOrder()) {
    const count = classCombos(classIndex).length
    const percentile = 1 - (stronger + count / 2) / COMBO_COUNT
    for (let id = 0; id < COMBO_COUNT; id++) if (COMBO_CLASS[id] === classIndex) table[id] = percentile
    stronger += count
  }
  preflopTable = table
  return table
}

/**
 * Only the boards of the hand in progress are ever asked for twice, so a
 * small cache is all this needs — and an unbounded one would grow by a few
 * boards every hand for as long as the tab stays open.
 */
const postflopTables = new Map<string, Float64Array>()
const MAX_CACHED_BOARDS = 32

/** Each combo's percentile on this board, 1 the best; -1 for a combo the board makes impossible. */
function postflopPercentiles(board: CardInt[]): Float64Array {
  const key = [...board].sort((a, b) => a - b).join(',')
  const cached = postflopTables.get(key)
  if (cached) return cached
  if (postflopTables.size >= MAX_CACHED_BOARDS) postflopTables.clear()
  const table = new Float64Array(COMBO_COUNT)
  for (let id = 0; id < COMBO_COUNT; id++) {
    const bucket = bucketOf([COMBO_A[id], COMBO_B[id]], board, DEFAULT_BUCKETS)
    table[id] = bucket === NO_BUCKET ? -1 : (bucket + 0.5) / DEFAULT_BUCKETS
  }
  postflopTables.set(key, table)
  return table
}
