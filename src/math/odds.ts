/**
 * Price, and the frequencies that price implies.
 *
 * Everything here is one of two formulas with the pot and the bet rearranged,
 * and they are worth keeping in one file because the relationship between
 * them is the whole of exploitative-versus-equilibrium thinking:
 *
 *   - `requiredEquity` is what YOU need to call profitably.
 *   - `bluffFraction` is how often the BETTOR must be bluffing to make you
 *     exactly indifferent to calling.
 *
 * They are the same expression. That is not a coincidence: a bettor who bluffs
 * at exactly the frequency that makes your call break even has given you
 * nothing to exploit, which is what an equilibrium strategy is for.
 */

/**
 * Equity a call needs to break even against a bet of `bet` into a pot of
 * `pot`, where `pot` is measured BEFORE the bet goes in.
 *
 * You risk `bet` to win the pot plus the bet, so you are getting `bet` to
 * `pot + bet` — and the share of the final pot you are paying for is
 * bet / (pot + 2 * bet).
 */
export function requiredEquity(bet: number, pot: number): number {
  if (bet <= 0) return 0
  return bet / (pot + 2 * bet)
}

/**
 * The same thing expressed as a fraction of the pot, which is how bets are
 * actually discussed: a half-pot bet needs 25%, a pot-sized bet 33%.
 */
export function requiredEquityForPotFraction(fraction: number): number {
  return fraction / (1 + 2 * fraction)
}

/**
 * Required equity once money you expect to win on LATER streets is counted.
 *
 * `extraWon` is the average extra you collect when you hit — not when you
 * miss, and not the most you could imagine collecting. It is the honest
 * version of "but I'll get paid off", and the reason a draw that raw pot odds
 * reject can still be a call.
 */
export function requiredEquityImplied(bet: number, pot: number, extraWon: number): number {
  if (bet <= 0) return 0
  return bet / (pot + 2 * bet + extraWon)
}

/**
 * How much extra you must expect to win on later streets for a call to break
 * even at a given equity. The question a player actually asks — "is this
 * callable?" — read backwards.
 */
export function impliedOddsNeeded(bet: number, pot: number, equity: number): number {
  if (equity <= 0) return Infinity
  return bet / equity - pot - 2 * bet
}

/**
 * The share of a betting range that must be bluffs for a caller to be exactly
 * indifferent. Identical to `requiredEquity` — see the note at the top.
 *
 *   half pot -> 25% bluffs (1 bluff per 3 value bets)
 *   pot      -> 33% bluffs (1 per 2)
 */
export function bluffFraction(bet: number, pot: number): number {
  return requiredEquity(bet, pot)
}

/**
 * How often a pure bluff of this size has to work to break even: it risks
 * `bet` to win `pot`. Usually written alpha.
 */
export function breakEvenBluffFrequency(bet: number, pot: number): number {
  if (bet <= 0) return 0
  return bet / (pot + bet)
}

/**
 * Minimum defence frequency — the share of your range you must continue with
 * so that a bluff of this size is not automatically profitable. One minus
 * alpha.
 *
 * Note the asymmetry with `bluffFraction`: a bigger bet must contain MORE
 * bluffs, but it also lets the defender fold MORE. That is the entire case
 * for overbetting — at twice pot the defender may fold two thirds of their
 * range, and 40% bluffs is a price worth paying for that.
 */
export function minDefenceFrequency(bet: number, pot: number): number {
  return 1 - breakEvenBluffFrequency(bet, pot)
}

/** Pot odds as the ratio players say out loud: 3 means "getting 3 to 1". */
export function potOddsRatio(bet: number, pot: number): number {
  if (bet <= 0) return Infinity
  return (pot + bet) / bet
}
