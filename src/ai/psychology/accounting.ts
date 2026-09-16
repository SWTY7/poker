/**
 * Mental accounting (Thaler & Johnson, 1990) — where the reference point sits.
 *
 * The two effects this file exists for are not separate mechanisms, and that
 * is the point worth preserving in the code:
 *
 *   House money. After winning, players treat the winnings as not quite
 *   theirs and take bigger risks with them.
 *
 *   Break-even. After losing, risk appetite rises specifically for gambles
 *   that could restore the reference point. This is what "chasing" is.
 *
 * Both fall straight out of reference dependence, so neither gets its own
 * rule here. All this module does is decide where the reference point is;
 * `prospect.ts` does the rest, and the effects appear on their own. A player
 * who is ahead evaluates the next pot in the gain domain, where the value
 * function is concave and loss aversion does not apply, so risking the
 * winnings costs little. A player who is behind evaluates it in the loss
 * domain, which is convex, so the gamble beats the certain loss.
 *
 * If either effect had to be coded as its own adjustment, the model would be
 * wrong.
 */

export interface SessionState {
  /** Chips the player sat down with. */
  buyIn: number
  /** Chips in front of them now. */
  stack: number
}

export type AdaptationMode =
  /** The reference point never moves off the buy-in: everything is measured against "even for the session". */
  | 'session'
  /** The reference point is always the current stack: no history, no house money, no chasing. This is the rational control. */
  | 'current'
  /** Partial adaptation — the usual case, and the one with a knob. */
  | 'partial'

export interface AccountingParams {
  mode: AdaptationMode
  /**
   * For 'partial': how much of the session result is still felt, 0..1. At 1
   * the reference point stays at the buy-in and nothing is ever absorbed; at
   * 0 it tracks the stack and the session is forgotten as fast as it happens.
   *
   * Asymmetry is allowed because it is real: people absorb wins into their
   * sense of normal faster than they absorb losses, which is exactly why the
   * house-money effect fades over an evening while the urge to get back to
   * even does not.
   */
  persistenceOfGains: number
  persistenceOfLosses: number
}

export const HUMAN_ACCOUNTING: AccountingParams = {
  mode: 'partial',
  persistenceOfGains: 0.5,
  persistenceOfLosses: 0.9,
}

/** The control: every pot judged on its own, no session history. */
export const RATIONAL_ACCOUNTING: AccountingParams = {
  mode: 'current',
  persistenceOfGains: 0,
  persistenceOfLosses: 0,
}

/** Chips up or down for the session. */
export function sessionPnl(session: SessionState): number {
  return session.stack - session.buyIn
}

/**
 * Where zero is, in chips.
 *
 *   reference = stack - persistence * pnl
 *
 * so a player who is up 400 with full persistence has a reference point 400
 * below their stack — they are standing on a gain — and one who is down 400
 * has a reference point 400 above it, standing in a hole.
 */
export function referencePoint(session: SessionState, params: AccountingParams = HUMAN_ACCOUNTING): number {
  const pnl = sessionPnl(session)
  switch (params.mode) {
    case 'current':
      return session.stack
    case 'session':
      return session.buyIn
    case 'partial': {
      const persistence = pnl >= 0 ? params.persistenceOfGains : params.persistenceOfLosses
      return session.stack - persistence * pnl
    }
  }
}

/**
 * How far above or below the reference point the player currently stands, in
 * chips. Positive means playing with house money, negative means chasing.
 *
 * Every outcome a bot evaluates is offset by this: a pot won or lost is felt
 * from here, not from zero.
 */
export function standing(session: SessionState, params: AccountingParams = HUMAN_ACCOUNTING): number {
  return session.stack - referencePoint(session, params)
}
