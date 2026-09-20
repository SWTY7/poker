import type { GameState } from '../poker/game-state'

/**
 * The shape rising blinds and payouts take. Everything here is pure — no
 * class, no mutation, nothing that remembers what hand it's on — because the
 * one piece of state a tournament actually needs (how many hands have been
 * played) already lives on `GameState`. A structure is just the rule for
 * turning that number into blinds, and a field size is just the rule for
 * turning a prize pool into a payout.
 */

export interface BlindLevel {
  /** 1-indexed, because "level 1" is what a player calls the starting blinds. */
  level: number
  smallBlind: number
  bigBlind: number
  ante: number
}

export interface TournamentStructure {
  id: 'sit-and-go' | 'standard' | 'deep'
  name: string
  description: string
  startingStack: number
  handsPerLevel: number
  startingSmallBlind: number
  /** Blinds double after this many levels — the pace of the clock. */
  doubleEvery: number
  /** Level an ante is added from. Below it, antes are zero. */
  anteFromLevel: number
}

/**
 * Three clocks, not infinitely many. A player picking a tournament is asking
 * "how long do I have", and that's better answered by three named, felt
 * differences than by a wall of independent sliders for stack size, level
 * length and blind pace that mostly interact with each other anyway.
 */
export const STRUCTURES: Record<TournamentStructure['id'], TournamentStructure> = {
  'sit-and-go': {
    id: 'sit-and-go',
    name: 'Sit & Go',
    description: 'Fast blinds, shallow stacks. Usually over in under an hour.',
    startingStack: 1_500,
    handsPerLevel: 10,
    startingSmallBlind: 10,
    doubleEvery: 3,
    anteFromLevel: 4,
  },
  standard: {
    id: 'standard',
    name: 'Standard',
    description: 'The pace of a real tournament: room to play a stack, not just push it.',
    startingStack: 3_000,
    handsPerLevel: 18,
    startingSmallBlind: 15,
    doubleEvery: 4,
    anteFromLevel: 5,
  },
  deep: {
    id: 'deep',
    name: 'Deep Stack',
    description: 'A hundred big blinds and a slow clock — the longest of the three.',
    startingStack: 10_000,
    handsPerLevel: 25,
    startingSmallBlind: 25,
    doubleEvery: 4,
    anteFromLevel: 5,
  },
}

/**
 * The blinds at a given level. Doubling is geometric off the starting small
 * blind — not read from a hand-written table — so there is no level the
 * clock can run off the end of: level 40 is exactly as well defined as level
 * 4, just not a place any of these structures expect to reach.
 *
 * The ante, once it starts, tracks the small blind rather than a fraction of
 * the pot: it stays a small, steady tax on staying in the hand rather than a
 * second bet size to think about.
 */
export function blindLevel(structure: TournamentStructure, level: number): BlindLevel {
  if (level < 1) throw new Error(`Level must be at least 1, got ${level}`)
  const doublings = Math.floor((level - 1) / structure.doubleEvery)
  const smallBlind = structure.startingSmallBlind * 2 ** doublings
  return {
    level,
    smallBlind,
    bigBlind: smallBlind * 2,
    ante: level >= structure.anteFromLevel ? smallBlind : 0,
  }
}

/**
 * Which level a given number of *completed* hands falls in. `handsCompleted`
 * is `GameState.handNumber` read before the next hand starts — the hand
 * about to be dealt is the first of a new level exactly when this crosses a
 * `handsPerLevel` boundary.
 */
export function levelForHandsCompleted(structure: TournamentStructure, handsCompleted: number): number {
  return Math.floor(Math.max(handsCompleted, 0) / structure.handsPerLevel) + 1
}

/** How many hands remain before the level increases, for a "next level in N hands" readout. */
export function handsUntilNextLevel(structure: TournamentStructure, handsCompleted: number): number {
  const intoLevel = Math.max(handsCompleted, 0) % structure.handsPerLevel
  return structure.handsPerLevel - intoLevel
}

// --- payouts -----------------------------------------------------------------

/**
 * Percent of the pool by finishing position, most players first. These are
 * the conventional brackets for a field this small — a two-table event pays
 * deeper than a headline-final-table structure would, because a field of
 * eight losing six players to pay two is a harsher structure than most home
 * games want.
 */
function payoutSplits(fieldSize: number): number[] {
  if (fieldSize <= 2) return [100]
  if (fieldSize <= 6) return [65, 35]
  if (fieldSize <= 9) return [50, 30, 20]
  return [40, 25, 16, 10, 6, 3]
}

export function placesPaid(fieldSize: number): number {
  return payoutSplits(fieldSize).length
}

/**
 * The actual dollar prize for every paid position, summing to exactly
 * `prizePool` — not to each split rounded independently, which drifts a few
 * dollars off in either direction and would mean the payouts don't add up to
 * the money that was actually bought in. The rounding remainder is folded
 * into first place, which is the conventional way to absorb it and the one
 * that never turns a smaller finish into a larger prize.
 */
export function prizesForField(prizePool: number, fieldSize: number): number[] {
  const splits = payoutSplits(fieldSize)
  const raw = splits.map((split) => (prizePool * split) / 100)
  const rounded = raw.map((amount) => Math.round(amount))
  const remainder = prizePool - rounded.reduce((sum, amount) => sum + amount, 0)
  rounded[0] += remainder
  return rounded
}

/** Zero for anyone finishing outside the paid places. */
export function prizeForPosition(prizePool: number, fieldSize: number, position: number): number {
  const prizes = prizesForField(prizePool, fieldSize)
  return position >= 1 && position <= prizes.length ? prizes[position - 1] : 0
}

/**
 * True exactly when the next elimination decides who gets paid and who
 * doesn't — the one hand of a tournament with a story attached to it before
 * it's even dealt.
 */
export function isBubble(playersRemaining: number, fieldSize: number): boolean {
  return playersRemaining === placesPaid(fieldSize) + 1
}

// --- standings -----------------------------------------------------------------

export interface Standing {
  playerId: string
  /** 1 is first place. */
  position: number
}

/**
 * Finishing order for a tournament that has ended — call once
 * `eliminationOrder` accounts for every seat but one. The busted players
 * read straight off it: first eliminated is last place. Whoever is left
 * standing didn't bust at all, which is exactly what makes them the winner,
 * so they are placed first and not read from the list.
 */
export function tournamentStandings(state: GameState, fieldSize: number): Standing[] {
  const standings: Standing[] = state.eliminationOrder.map((playerId, index) => ({
    playerId,
    position: fieldSize - index,
  }))
  const champion = state.players.find((p) => !p.isEliminated)
  if (champion) standings.push({ playerId: champion.id, position: 1 })
  return standings.sort((a, b) => a.position - b.position)
}

/** A tournament is over once at most one seat can still play a hand. */
export function isTournamentOver(state: GameState): boolean {
  return state.players.filter((p) => !p.isEliminated).length <= 1
}

// --- the live HUD --------------------------------------------------------------

export interface TournamentHudInfo {
  level: number
  smallBlind: number
  bigBlind: number
  ante: number
  handsUntilNextLevel: number
  playersRemaining: number
  fieldSize: number
  placesPaid: number
  bubble: boolean
}

/** Everything a HUD needs to say what's going on in the tournament right now. */
export function tournamentHudInfo(state: GameState, structure: TournamentStructure, fieldSize: number): TournamentHudInfo {
  // handNumber counts the hand in progress (or just finished), so the level
  // it belongs to is based on the hands completed *before* it — one less.
  const handsCompleted = Math.max(state.handNumber - 1, 0)
  const level = levelForHandsCompleted(structure, handsCompleted)
  const blinds = blindLevel(structure, level)
  const playersRemaining = state.players.filter((p) => !p.isEliminated).length
  return {
    level,
    smallBlind: blinds.smallBlind,
    bigBlind: blinds.bigBlind,
    ante: blinds.ante,
    handsUntilNextLevel: handsUntilNextLevel(structure, handsCompleted),
    playersRemaining,
    fieldSize,
    placesPaid: placesPaid(fieldSize),
    bubble: isBubble(playersRemaining, fieldSize),
  }
}
