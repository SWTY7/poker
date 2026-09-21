import type { ActionType, PokerAction } from '../../poker/game-state'

/**
 * What every psychological bot at the table has learned about a specific
 * opponent's tendencies, from watching their public actions this sitting —
 * never their cards. One instance is shared by every `PsychBot` at the
 * table (wired through in `useHoldemGame.ts`), because they are all
 * watching the same opponent and there is no reason for six separate,
 * slower copies of the same read.
 *
 * Resets when the table does — a new game is a new `OpponentModel` — the
 * same scope as tilt. "Per session" rather than persisted: a player who
 * has been raise-then-potsize-raising every pot for the last twenty hands
 * gets read as more likely to be doing it again, but that read does not
 * carry into tomorrow's sitting.
 *
 * Deliberately the only thing learned is *how often* someone bets or
 * raises, never *what they had* — nothing here ever sees a hole card, which
 * keeps it inside the same "only what a player at the table could actually
 * know" boundary `observation.ts` documents. Frequency alone is still real
 * information: a player betting well above a balanced rate is, by
 * necessity, betting a range with more air in it than one betting at
 * equilibrium — that's arithmetic, not a read on their cards.
 */

const AGGRESSIVE: ReadonlySet<ActionType> = new Set(['bet', 'raise', 'all-in'])

interface Tally {
  aggressive: number
  total: number
}

export class OpponentModel {
  private tallies = new Map<string, Tally>()

  /** Records one action taken at the table, by whoever took it. */
  observe(action: PokerAction): void {
    const tally = this.tallies.get(action.playerId) ?? { aggressive: 0, total: 0 }
    tally.total++
    if (AGGRESSIVE.has(action.type)) tally.aggressive++
    this.tallies.set(action.playerId, tally)
  }

  /**
   * How much more (positive) or less (negative) often this player bets or
   * raises than `baseline`, a roughly-balanced aggression rate. Exactly 0
   * until `minSamples` actions have been seen from them — an explicit "no
   * read yet" rather than a confident-sounding number built from three
   * hands of noise.
   */
  aggressionBias(playerId: string, baseline = 0.35, minSamples = 12): number {
    const tally = this.tallies.get(playerId)
    if (!tally || tally.total < minSamples) return 0
    return tally.aggressive / tally.total - baseline
  }
}
