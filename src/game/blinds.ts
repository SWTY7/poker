/**
 * Rising blinds for the home game, when the house plays them: a game played
 * until one player has everything needs the blinds to climb, or a table of
 * careful players never ends. (A cash game keeps its blinds for good, and the
 * tournaments have their own structures in `tournament.ts`.)
 *
 * Each level is about half again the last, rounded to the chip amounts a real
 * blind clock uses (5/10, 8/16, 15/30, 25/50, 40/80, 60/120, 100/200...), so
 * the game tightens steadily rather than doubling in sudden jumps.
 */

export interface Blinds {
  smallBlind: number
  bigBlind: number
  ante: number
}

/** Each level's small blind is at least this many times the last one's. */
const STEP = 1.5

/** Whole-chip amounts that read like a real blind clock: 1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50, 60, 75, 80, 100... */
const MANTISSAS = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8]

/** The smallest round amount at or above `x`. */
function roundUp(x: number): number {
  for (let scale = 1; ; scale *= 10) {
    for (const m of MANTISSAS) {
      const amount = m * scale
      if (Number.isInteger(amount) && amount >= x - 1e-9) return amount
    }
  }
}

/**
 * The blinds at `level` (1 is the starting blinds, unchanged). The big blind
 * and ante keep the same proportion to the small blind as the starting ones.
 */
export function risingBlinds(start: Blinds, level: number): Blinds {
  if (level <= 1) return { ...start }
  let smallBlind = start.smallBlind
  for (let l = 2; l <= level; l++) smallBlind = roundUp(Math.max(smallBlind * STEP, smallBlind + 1))
  const scale = smallBlind / start.smallBlind
  return {
    smallBlind,
    bigBlind: Math.max(Math.round(start.bigBlind * scale), smallBlind),
    ante: start.ante > 0 ? Math.max(Math.round(start.ante * scale), 1) : 0,
  }
}
