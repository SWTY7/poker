import type { ActionType, GameState, PokerAction } from '../../poker/game-state'

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
 * carry into tomorrow's sitting.
 *
 * Two things are learned, both visible in the action stream alone:
 *
 *   aggression  how often they bet or raise, out of everything they do
 *   fold-to-bet how often they fold when they have a bet to call
 *
 * and each is only a read *relative to what is normal in that spot*. This
 * is the part that was once wrong and cost real chips: a single fixed
 * "balanced" aggression rate, set for a full table, read every heads-up
 * player as a maniac — heads-up, everyone bets far more, the solved
 * strategy included — and a bot acting on that read lost to the plain
 * solve it was built on (docs/combined-bot.md). So every action is recorded
 * with its setting, and compared against the normal *measured* for that
 * setting (`BASELINES`, reproduced by `npm run calibrate:reads`).
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
  // 837 facing a bet (2026-09-25).
  headsUp: { aggression: 0.38, foldToBet: 0.34, postflop: { bet: 0.37, fold: 0.46, call: 0.36, raise: 0.17 } },
  // 1,500 six-handed hands of the cast against itself, multiway spots only:
  // 15,410 actions, 9,719 facing a bet; postflop, 5,052 checked-to spots and
  // 1,485 facing a bet (2026-09-25).
  multiway: { aggression: 0.15, foldToBet: 0.43, postflop: { bet: 0.15, fold: 0.56, call: 0.4, raise: 0.04 } },
}

/**
 * How many observations a read is worth before it counts for half its raw
 * value. Twenty actions is a handful of orbits — about when a person at the
 * table starts to trust "this one bets a lot".
 */
const PRIOR_WEIGHT = 20

const AGGRESSIVE: ReadonlySet<ActionType> = new Set(['bet', 'raise', 'all-in'])

interface Tally {
  aggressive: number
  total: number
  facingBet: number
  foldedToBet: number
  /** Postflop only, split by spot, for the rates a range is read from. */
  checkedTo: number
  betWhenCheckedTo: number
  facedPostflop: number
  postflop: { fold: number; call: number; raise: number }
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
})

export class OpponentModel {
  private tallies = new Map<string, Record<Setting, Tally>>()

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
      if (AGGRESSIVE.has(action.type)) tally.betWhenCheckedTo++
    }
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
