import { bluffFraction, minDefenceFrequency } from '../../math/odds'
import type { Rng } from '../../utils/random'

/**
 * Cognitive hierarchy / level-k (Camerer, Ho & Chong, 2004).
 *
 * Players reason to a finite depth. Level 0 plays its own cards and has no
 * model of anyone else. Level 1 best-responds to level 0 — "they bet big, so
 * they are strong". Level 2 best-responds to level 1 — "they think I am weak,
 * so I can bluff". Level 3 — "they think I think they are weak, so that small
 * bet is actually strong". Nobody plays the equilibrium, and depth is
 * Poisson-distributed across a population with mean about 1.5, which means
 * most people are level 1.
 *
 * This matters for building a cast of opponents, and it matters for a warning
 * the doc is explicit about: over-levelling is a real failure mode. Playing
 * level 3 against a level 1 opponent loses money, because they are not
 * thinking about you at all. That claim is testable here rather than
 * decorative — see `levelMatchValue`.
 *
 * The strategic content is carried by one toy game, the standard one for this
 * argument: a bettor who is strong half the time, a defender who always holds
 * a hand that beats a bluff and loses to value. Two numbers describe a
 * strategy in it — how often you bluff, and how often you call — and the
 * whole hierarchy is the fixed-point iteration of best responses to those.
 */

export interface LevelStrategy {
  /** How often this level bets a hand that cannot win a showdown. */
  bluffFrequency: number
  /** How often this level calls a bet holding a hand that only beats a bluff. */
  defenceFrequency: number
}

/**
 * The pure best-response chain, which is where the interesting structure is.
 *
 *   level 0: never bluffs, never bluff-catches — a bet means strength
 *   level 1: opponent never calls, so bluff always; opponent never bluffs, so never call
 *   level 2: opponent always bluffs, so always call; opponent still never calls, so still bluff
 *   level 3: opponent always calls, so stop bluffing; opponent still bluffs, so keep calling
 *   level 4: back to never bluffing and never calling — and the cycle repeats
 *
 * The period-four cycle is not an artefact. It is the levelling war itself:
 * every adaptation is a best response to the last one, and four steps later
 * you are back where you started, which is exactly why no level is stable and
 * why the equilibrium is somewhere none of them sit.
 */
export function pureBestResponse(level: number): { bluff: number; defend: number } {
  const k = Math.max(0, Math.floor(level))
  // bluff:  0, 1, 1, 0, 0, 1, 1, 0 ...    defend: 0, 0, 1, 1, 0, 0, 1, 1 ...
  const phase = k % 4
  return {
    bluff: phase === 1 || phase === 2 ? 1 : 0,
    defend: phase === 2 || phase === 3 ? 1 : 0,
  }
}

/**
 * What a level actually does, as opposed to what it believes it should.
 *
 * A pure best response is a caricature — nobody bluffs literally every hand —
 * so the strategy played is the best response blended toward the equilibrium
 * frequencies from `odds.ts` by `confidence`: how sure this player is of
 * their read. At confidence 1 the levelling is absolute and the argument
 * above holds exactly; at 0 the player is at equilibrium and their level
 * stops mattering, which is the right degenerate case.
 */
export function levelStrategy(level: number, bet: number, pot: number, confidence = 1): LevelStrategy {
  const best = pureBestResponse(level)
  const c = Math.min(Math.max(confidence, 0), 1)
  const equilibriumBluff = bluffFraction(bet, pot)
  const equilibriumDefence = minDefenceFrequency(bet, pot)
  return {
    bluffFrequency: (1 - c) * equilibriumBluff + c * best.bluff,
    defenceFrequency: (1 - c) * equilibriumDefence + c * best.defend,
  }
}

/**
 * What this level believes the player across the table is doing: whatever the
 * level below it does. That single line is the whole model — the depth of
 * reasoning is literally how many times it has been applied.
 */
export function believedOpponentStrategy(level: number, bet: number, pot: number, confidence = 1): LevelStrategy {
  return levelStrategy(Math.max(0, level - 1), bet, pot, confidence)
}

export interface ToyGame {
  /** Chips in the middle before anyone bets. */
  pot: number
  /** What the bettor bets. */
  bet: number
  /** How often the bettor has a hand worth value-betting. */
  strongProbability: number
  confidence: number
}

export const DEFAULT_TOY_GAME: ToyGame = { pot: 100, bet: 75, strongProbability: 0.5, confidence: 1 }

/**
 * Chips per hand won by a bettor playing `bluffFrequency` against a defender
 * playing `defenceFrequency`, in the toy game above.
 *
 * The pot is contributed equally, so winning it is worth half of it to the
 * winner and costs the loser the same; the bet moves in full.
 */
export function bettorValue(bluffFrequency: number, defenceFrequency: number, game: ToyGame): number {
  const { pot, bet, strongProbability: s } = game
  const d = defenceFrequency
  const b = bluffFrequency
  const strong = d * (pot / 2 + bet) + (1 - d) * (pot / 2)
  const bluffed = d * (-pot / 2 - bet) + (1 - d) * (pot / 2)
  const gaveUp = -pot / 2
  return s * strong + (1 - s) * (b * bluffed + (1 - b) * gaveUp)
}

/**
 * Chips per hand level A wins from level B, taking each side of the button
 * half the time.
 *
 * This is the function the over-levelling claim is made of. Run it across a
 * grid of levels and the pattern is visible: every level beats the one below
 * it, and against a level-1 opponent, level 2 earns more than level 3 does —
 * which is what "they are not thinking about you" cashes out to.
 */
export function levelMatchValue(levelA: number, levelB: number, game: ToyGame = DEFAULT_TOY_GAME): number {
  const a = levelStrategy(levelA, game.bet, game.pot, game.confidence)
  const b = levelStrategy(levelB, game.bet, game.pot, game.confidence)
  const aBetting = bettorValue(a.bluffFrequency, b.defenceFrequency, game)
  const bBetting = bettorValue(b.bluffFrequency, a.defenceFrequency, game)
  return (aBetting - bBetting) / 2
}

/** Poisson pmf, for checking the sampler against the distribution it claims. */
export function poissonProbability(k: number, tau: number): number {
  if (k < 0 || !Number.isInteger(k)) return 0
  let logP = -tau + k * Math.log(tau)
  for (let i = 2; i <= k; i++) logP -= Math.log(i)
  return Math.exp(logP)
}

/**
 * A reasoning depth for one bot, drawn from Poisson(tau).
 *
 * tau = 1.5 is the measured population value, and drawing from it is what
 * gives a table a realistic mix for free: about a fifth who never think about
 * you at all, a third at level 1, a quarter at level 2, and the occasional
 * player who has thought about it once too often.
 *
 * Knuth's method — multiply uniforms until the product falls below e^-tau.
 * At tau this small it takes two or three draws.
 */
export function samplePoissonLevel(rng: Rng, tau = 1.5): number {
  const limit = Math.exp(-tau)
  let k = 0
  let product = rng()
  while (product > limit) {
    k++
    product *= rng()
  }
  return k
}
