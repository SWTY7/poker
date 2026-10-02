import type { Card } from '../../poker/card'
import { toCardInts } from '../../poker/fast/cards'
import type { ActionType, GameState, PokerAction } from '../../poker/game-state'
import { totalPot } from '../../poker/pot'
import { DEFAULT_BUCKETS, NO_BUCKET, bucketOf } from '../../gto/holdem/buckets'
import { positionLabels } from '../../poker/position'
import { blindsFrom, sizeActions, sizeBucket, type SizeBucket } from './sizing'

/**
 * What every bot at the table has learned about a specific opponent's
 * tendencies, from watching their public actions this sitting — never their
 * cards. One instance is shared by every `PsychBot` at the table (wired
 * through in `useHoldemGame.ts`), because they are all watching the same
 * opponent and there is no reason for six separate, slower copies of the
 * same read.
 *
 * Resets when the table does — a new game is a new `OpponentModel` — the
 * same scope as tilt. A player who has been raising every pot for the last
 * twenty hands gets read as likely to keep doing it, but that read does not
 * carry into tomorrow's sitting — unless something saves it (`toJSON`) and
 * hands it back (`restore`), faded, which is how a recurring rival remembers
 * you.
 *
 * Learned, all of it visible to anyone at the table:
 *
 *   aggression  how often they bet or raise, out of everything they do
 *   fold-to-bet how often they fold when they have a bet to call
 *
 * and each is only a read *relative to what is normal in that spot*. Two
 * more come from watching closely: how often they bet big rather than small,
 * and — only from hands that reach a showdown, where their cards are turned
 * over — how often their river bets, at each size, were bluffs.
 *
 * This is the part that was once wrong and cost real chips: a single fixed
 * "balanced" aggression rate of 35% was far above what anyone does at a
 * full table (about 12-15%), so almost everyone read as passive there, and
 * a bot acting on those reads lost to the plain solve it was built on
 * (docs/combined-bot.md). So every action is recorded with its setting and
 * compared against the normal *measured* for that setting (`BASELINES`,
 * reproduced by `npm run calibrate:reads`).
 *
 * Confidence builds with evidence instead of switching on at a cutoff: a
 * read is the observed difference from normal, shrunk toward zero by how
 * little has been seen (n / (n + PRIOR_WEIGHT)). Three raises say almost
 * nothing; forty say a lot.
 */

export type Setting = 'headsUp' | 'multiway'

/** What was true at the table when an action was taken, as anyone there could see. */
export interface ActionContext {
  /** Players still in the hand when it was taken, the one acting included. */
  playersInHand: number
  /** Whether the one acting had a bet to call. */
  facingBet: boolean
  /** Whether it came after the flop. Absent counts as preflop, which the postflop rates ignore. */
  postflop?: boolean
  /** Chips in the middle, the bet to match, and what the one acting already has in this street — for sizing a bet. */
  pot?: number
  currentBet?: number
  committed?: number
}

/**
 * A hand that reached a showdown, as everyone at the table saw it: every
 * action, the board, and the cards turned over.
 */
export interface ShowdownRecord {
  actions: PokerAction[]
  board: Card[]
  shown: { playerId: string; cards: Card[] }[]
  /** Blinds posted before anyone acted, by player — to rebuild the pot each bet went into. */
  blinds: Map<string, number>
  bigBlind: number
}

/**
 * How often a player does each thing after the flop, by spot: bet when
 * checked to, and fold / call / raise when facing a bet. These are what a
 * range is read *from* (range-reading.ts): someone who bets 60% of the time
 * when checked to is betting their top 60%, not the same top third a
 * cautious player bets.
 */
export interface PostflopRates {
  bet: number
  fold: number
  call: number
  raise: number
  /** Of their bets when checked to, the share that were large (see sizing.ts). */
  large: number
}

/**
 * The showdown in a finished hand, as the table saw it — or null if nobody's
 * cards were turned over (everyone else folded). Read off the engine's own
 * narration, which logs a reveal for every hand still in at showdown.
 */
export function showdownOf(state: GameState): ShowdownRecord | null {
  const shown = state.handLog
    .filter((entry) => entry.kind === 'reveal' && entry.playerId && entry.cards?.length === 2)
    .map((entry) => ({ playerId: entry.playerId!, cards: entry.cards! }))
  if (shown.length === 0) return null
  const seats = [...positionLabels(state)].map(([id, position]) => ({ id, position }))
  return {
    actions: state.actionHistory,
    board: state.communityCards,
    shown,
    blinds: blindsFrom(seats, state.config.bigBlind),
    bigBlind: state.config.bigBlind,
  }
}

export function settingOf(playersInHand: number): Setting {
  return playersInHand <= 2 ? 'headsUp' : 'multiway'
}

/** The context of an action about to be taken, read off the table before it is applied. */
export function actionContext(state: GameState, playerId: string): ActionContext {
  const actor = state.players.find((p) => p.id === playerId)
  return {
    playersInHand: state.players.filter((p) => !p.folded).length,
    facingBet: actor ? state.currentBet - actor.betThisStreet > 0 : false,
    postflop: state.street !== 'preflop',
    pot: totalPot(state.players),
    currentBet: state.currentBet,
    committed: actor?.betThisStreet ?? 0,
  }
}

/**
 * What a typical player does in each setting. Heads-up, "typical" is the
 * solved strategy playing itself — the one reference that is balanced by
 * construction. Multiway there is no solve, so it is the bot cast playing
 * itself: normal for this table's population. Measured, not chosen; see
 * scripts/calibrate-reads.ts for how, and rerun it if the bots change much.
 */
export const BASELINES: Record<Setting, { aggression: number; foldToBet: number; postflop: PostflopRates }> = {
  // 4,000 hands of the solve against itself across all four trained depths:
  // 10,208 actions, 7,854 facing a bet; postflop, 1,865 checked-to spots and
  // 837 facing a bet, 692 sized bets (2026-09-27).
  headsUp: { aggression: 0.38, foldToBet: 0.34, postflop: { bet: 0.37, fold: 0.46, call: 0.36, raise: 0.17, large: 0.41 } },
  // 1,500 six-handed hands of the cast against itself, multiway spots only,
  // with the multiway preflop book: 11,186 actions, 8,397 facing a bet;
  // postflop, 2,420 checked-to spots and 756 facing a bet, 419 sized bets
  // (2026-09-27). Folding to a bet rose from 0.43 when the book arrived —
  // it folds much more before the flop than instinct did.
  multiway: { aggression: 0.14, foldToBet: 0.63, postflop: { bet: 0.17, fold: 0.54, call: 0.43, raise: 0.03, large: 0.3 } },
}

/**
 * How many observations a read is worth before it counts for half its raw
 * value. Twenty actions is a handful of orbits — about when a person at the
 * table starts to trust "this one bets a lot".
 */
const PRIOR_WEIGHT = 20

const AGGRESSIVE: ReadonlySet<ActionType> = new Set(['bet', 'raise', 'all-in'])

/**
 * How many shown-down bets a showdown read is worth before it counts for
 * half. Far fewer than for action frequencies: a single shown bluff is a
 * fact about someone's cards, where a single raise is only a data point
 * about their tendencies.
 */
const SHOWDOWN_PRIOR_WEIGHT = 8

/**
 * A shown bet counts as a bluff if the hand was in the bottom this share of
 * all hands on the river board: not a hand that bet to be called by worse.
 */
const BLUFF_STRENGTH = 0.4

export interface ShownBets {
  bets: number
  bluffs: number
}

export interface Tally {
  aggressive: number
  total: number
  facingBet: number
  foldedToBet: number
  /** Postflop only, split by spot, for the rates a range is read from. */
  checkedTo: number
  betWhenCheckedTo: number
  facedPostflop: number
  postflop: { fold: number; call: number; raise: number }
  /** Bets when checked to whose size is known, and how many of those were large. */
  sizedBets: number
  largeBets: number
}

const emptyTally = (): Tally => ({
  aggressive: 0,
  total: 0,
  facingBet: 0,
  foldedToBet: 0,
  checkedTo: 0,
  betWhenCheckedTo: 0,
  facedPostflop: 0,
  postflop: { fold: 0, call: 0, raise: 0 },
  sizedBets: 0,
  largeBets: 0,
})

/**
 * Everything learned about some players, as plain JSON for saving between
 * sittings. Keyed by player id, which is whatever the table called them — a
 * caller that seats the same person under a different id renames the keys.
 */
export interface OpponentModelData {
  version: 1
  players: Record<string, { tallies: Record<Setting, Tally>; shown?: Record<SizeBucket, ShownBets> }>
}

export class OpponentModel {
  private tallies = new Map<string, Record<Setting, Tally>>()
  private shown = new Map<string, Record<SizeBucket, ShownBets>>()

  /** What has been learned about these players (everyone, if not given), to save. */
  toJSON(players?: readonly string[]): OpponentModelData {
    const ids = players ?? [...new Set([...this.tallies.keys(), ...this.shown.keys()])]
    const data: OpponentModelData = { version: 1, players: {} }
    for (const id of ids) {
      const tallies = this.tallies.get(id)
      const shown = this.shown.get(id)
      if (!tallies && !shown) continue
      data.players[id] = {
        tallies: structuredClone(tallies ?? { headsUp: emptyTally(), multiway: emptyTally() }),
        ...(shown ? { shown: structuredClone(shown) } : {}),
      }
    }
    return data
  }

  /**
   * Adds saved evidence back in, every count multiplied by `decay` (0..1) —
   * the older a read, the less it weighs, so one that is restored session
   * after session fades unless it keeps being confirmed, and never freezes.
   * Adds to what is already here rather than replacing it, so several saved
   * reads on the same player (two rivals who both know you) can be pooled.
   * Anything that isn't recognisable saved data is ignored.
   */
  restore(data: unknown, decay = 1): void {
    if (!isModelData(data)) return
    const keep = clamp01(decay)
    for (const [id, saved] of Object.entries(data.players)) {
      let byPlayer = this.tallies.get(id)
      if (!byPlayer) {
        byPlayer = { headsUp: emptyTally(), multiway: emptyTally() }
        this.tallies.set(id, byPlayer)
      }
      for (const setting of ['headsUp', 'multiway'] as const) {
        const from = saved.tallies?.[setting]
        if (from) addTally(byPlayer[setting], from, keep)
      }
      if (!saved.shown) continue
      let shown = this.shown.get(id)
      if (!shown) {
        shown = { small: { bets: 0, bluffs: 0 }, large: { bets: 0, bluffs: 0 } }
        this.shown.set(id, shown)
      }
      for (const size of ['small', 'large'] as const) {
        shown[size].bets += num(saved.shown[size]?.bets) * keep
        shown[size].bluffs += num(saved.shown[size]?.bluffs) * keep
      }
    }
  }

  /** A model that starts from saved evidence, faded by `decay`. */
  static fromJSON(data: unknown, decay = 1): OpponentModel {
    const model = new OpponentModel()
    model.restore(data, decay)
    return model
  }

  /** Records one action taken at the table, by whoever took it, in the spot they took it in. */
  observe(action: PokerAction, context: ActionContext): void {
    let byPlayer = this.tallies.get(action.playerId)
    if (!byPlayer) {
      byPlayer = { headsUp: emptyTally(), multiway: emptyTally() }
      this.tallies.set(action.playerId, byPlayer)
    }
    const tally = byPlayer[settingOf(context.playersInHand)]
    tally.total++
    if (AGGRESSIVE.has(action.type)) tally.aggressive++
    if (context.facingBet) {
      tally.facingBet++
      if (action.type === 'fold') tally.foldedToBet++
    }
    if (!context.postflop) return
    if (context.facingBet) {
      tally.facedPostflop++
      if (action.type === 'fold') tally.postflop.fold++
      else if (AGGRESSIVE.has(action.type)) tally.postflop.raise++
      else tally.postflop.call++
    } else {
      tally.checkedTo++
      if (AGGRESSIVE.has(action.type)) {
        tally.betWhenCheckedTo++
        if (context.pot !== undefined && context.pot > 0 && action.amount !== undefined) {
          const fraction = (action.amount - (context.currentBet ?? 0)) / context.pot
          tally.sizedBets++
          if (sizeBucket(fraction) === 'large') tally.largeBets++
        }
      }
    }
  }

  /**
   * Learns from a hand that went to showdown: every river bet or raise made
   * by someone whose cards were then shown is scored as value or bluff, by
   * where their hand stood among all hands on that board, and filed under
   * its size.
   *
   * Only river bets, deliberately. A river bet is called or not by someone
   * who can't see the bettor's cards, so the ones that reach a showdown are
   * a fair sample of all of them. An earlier bet reaches showdown only if the
   * bettor kept going — and bluffs are exactly the bets that give up later —
   * so counting them would read every player as more honest than they are,
   * and the one mistake this bot has measurably paid for is reading bets as
   * stronger than they are (docs/combined-bot.md).
   */
  observeShowdown(record: ShowdownRecord): void {
    if (record.board.length < 5) return
    const board = toCardInts(record.board)
    const holes = new Map(record.shown.map((s) => [s.playerId, toCardInts(s.cards)]))
    for (const sized of sizeActions(record.actions, record.blinds, record.bigBlind)) {
      if (sized.street !== 'river' || sized.fraction === null) continue
      const hole = holes.get(sized.action.playerId)
      if (!hole || hole.length !== 2) continue
      const bucket = bucketOf([hole[0], hole[1]], board, DEFAULT_BUCKETS)
      if (bucket === NO_BUCKET) continue
      let byPlayer = this.shown.get(sized.action.playerId)
      if (!byPlayer) {
        byPlayer = { small: { bets: 0, bluffs: 0 }, large: { bets: 0, bluffs: 0 } }
        this.shown.set(sized.action.playerId, byPlayer)
      }
      const tally = byPlayer[sizeBucket(sized.fraction)]
      tally.bets++
      if ((bucket + 0.5) / DEFAULT_BUCKETS < BLUFF_STRENGTH) tally.bluffs++
    }
  }

  /**
   * The share of this player's bets of this size that are bluffs: `prior`
   * (what the bot would believe without having seen their cards), moved
   * toward what their shown river bets actually were, by how many have been
   * seen. Exactly `prior` for a player never seen at showdown.
   */
  showdownBluffShare(playerId: string, size: SizeBucket, prior: number): number {
    const tally = this.shown.get(playerId)?.[size]
    if (!tally || tally.bets === 0) return prior
    return (tally.bluffs + SHOWDOWN_PRIOR_WEIGHT * prior) / (tally.bets + SHOWDOWN_PRIOR_WEIGHT)
  }

  /** How many of this player's bets have been seen at showdown, of either size. */
  shownBets(playerId: string): number {
    const byPlayer = this.shown.get(playerId)
    return byPlayer ? byPlayer.small.bets + byPlayer.large.bets : 0
  }

  /**
   * How often this player bets, folds, calls and raises after the flop in
   * `setting`: what has been seen of them, blended with what is normal there
   * — with no evidence, exactly normal; with a lot, mostly them. (The
   * posterior mean under a prior worth PRIOR_WEIGHT observations.)
   */
  postflopRates(playerId: string, setting: Setting): PostflopRates {
    const normal = BASELINES[setting].postflop
    const tally = this.tallies.get(playerId)?.[setting]
    if (!tally) return { ...normal }
    const blend = (count: number, total: number, prior: number) => (count + PRIOR_WEIGHT * prior) / (total + PRIOR_WEIGHT)
    return {
      bet: blend(tally.betWhenCheckedTo, tally.checkedTo, normal.bet),
      fold: blend(tally.postflop.fold, tally.facedPostflop, normal.fold),
      call: blend(tally.postflop.call, tally.facedPostflop, normal.call),
      raise: blend(tally.postflop.raise, tally.facedPostflop, normal.raise),
      large: blend(tally.largeBets, tally.sizedBets, normal.large),
    }
  }

  /**
   * How much more (positive) or less (negative) often this player bets or
   * raises than is normal in `setting`, shrunk by how much has been seen.
   * 0 for anyone never seen there.
   */
  aggressionBias(playerId: string, setting: Setting): number {
    const tally = this.tallies.get(playerId)?.[setting]
    if (!tally || tally.total === 0) return 0
    return shrink(tally.aggressive / tally.total - BASELINES[setting].aggression, tally.total)
  }

  /**
   * How much more (positive) or less (negative) often this player folds to a
   * bet than is normal in `setting`, shrunk the same way. Positive is an
   * over-folder — bluff them; negative is a calling station — don't.
   */
  foldBias(playerId: string, setting: Setting): number {
    const tally = this.tallies.get(playerId)?.[setting]
    if (!tally || tally.facingBet === 0) return 0
    return shrink(tally.foldedToBet / tally.facingBet - BASELINES[setting].foldToBet, tally.facingBet)
  }
}

function shrink(difference: number, observations: number): number {
  return difference * (observations / (observations + PRIOR_WEIGHT))
}

function addTally(into: Tally, from: Partial<Tally>, weight: number): void {
  const counts = [
    'aggressive',
    'total',
    'facingBet',
    'foldedToBet',
    'checkedTo',
    'betWhenCheckedTo',
    'facedPostflop',
    'sizedBets',
    'largeBets',
  ] as const
  for (const key of counts) {
    into[key] += num(from[key]) * weight
  }
  for (const key of ['fold', 'call', 'raise'] as const) {
    into.postflop[key] += num(from.postflop?.[key]) * weight
  }
}

/** A saved count, or 0 for anything missing or not a sane count. */
function num(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(Math.max(x, 0), 1) : 0
}

function isModelData(data: unknown): data is OpponentModelData {
  if (typeof data !== 'object' || data === null) return false
  const candidate = data as { version?: unknown; players?: unknown }
  return candidate.version === 1 && typeof candidate.players === 'object' && candidate.players !== null
}
