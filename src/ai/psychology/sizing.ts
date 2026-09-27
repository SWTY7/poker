import type { PokerAction, Street } from '../../poker/game-state'

/**
 * How big each bet in a hand was, as a share of the pot it went into.
 *
 * "He bet 60" means nothing on its own; "he bet a third of the pot" and "he
 * bet one and a half pots" are different statements about his hand, and
 * reading them differently is most of what a player means by paying
 * attention to sizing. The action history has chip amounts only, so the pot
 * is rebuilt alongside it, action by action.
 *
 * The size of a bet or raise is what it adds beyond calling, over the pot
 * once that call is in — the same measure the bots size their own bets by
 * ("raise by half the pot"), so a bot's reading of a bet and its own sense
 * of what that bet would say agree. Antes are not in the history and are
 * left out; they move every fraction by the same small amount.
 */

export interface SizedAction {
  action: PokerAction
  street: Street
  /** The pot before this action, everything from earlier streets included. */
  potBefore: number
  /** The bet to match on this street before this action. */
  level: number
  /** For a bet or raise: what it added beyond a call, over the pot after that call. Otherwise null. */
  fraction: number | null
}

/**
 * Replays `actions` (street-stamped, as the engine records them), given what
 * each player had in as a blind before anyone acted. An action without a
 * stamp — one described by hand rather than recorded — is taken to belong
 * to `unstamped`, the street in progress.
 */
export function sizeActions(
  actions: PokerAction[],
  blinds: Map<string, number>,
  bigBlind: number,
  unstamped: Street = 'preflop',
): SizedAction[] {
  const committed = new Map(blinds)
  let pot = [...blinds.values()].reduce((sum, chips) => sum + chips, 0)
  let street: Street | null = null
  let level = 0
  const sized: SizedAction[] = []

  for (const action of actions) {
    const actionStreet: Street = action.street ?? unstamped
    if (actionStreet !== street) {
      if (actionStreet !== 'preflop') committed.clear()
      level = actionStreet === 'preflop' ? bigBlind : 0
    }
    street = actionStreet
    const before = committed.get(action.playerId) ?? 0
    const potBefore = pot
    let fraction: number | null = null
    let after = before

    if (action.type === 'call') {
      after = Math.max(level, before)
    } else if (action.type === 'bet' || action.type === 'raise' || action.type === 'all-in') {
      const to = action.amount ?? level
      if (to > level) {
        const potAfterCall = pot + (level - before)
        fraction = potAfterCall > 0 ? (to - level) / potAfterCall : null
        level = to
      }
      after = Math.max(to, before)
    }

    pot += after - before
    committed.set(action.playerId, after)
    sized.push({ action, street, potBefore, level, fraction })
  }
  return sized
}

/**
 * Bets come in two sizes as far as reading them goes: small (under 60% of
 * the pot — a third, a half) and large (three quarters, pot, an overbet, an
 * all in). Two, not five, because a read has to be learned from how one
 * player bets, and the evidence per bucket runs out fast.
 */
export type SizeBucket = 'small' | 'large'

export const LARGE_BET_FRACTION = 0.6

export function sizeBucket(fraction: number): SizeBucket {
  return fraction >= LARGE_BET_FRACTION ? 'large' : 'small'
}

/** The blinds each player posted this hand, as read off the seat names. */
export function blindsFrom(players: { id: string; position: string | null }[], bigBlind: number): Map<string, number> {
  const blinds = new Map<string, number>()
  for (const player of players) {
    if (player.position === 'SB') blinds.set(player.id, bigBlind / 2)
    if (player.position === 'BB') blinds.set(player.id, bigBlind)
  }
  return blinds
}
