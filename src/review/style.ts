import type { HandRecord, LoggedAction } from './log'
import { kindOf } from './log'

/**
 * A player's style, from their own hand history: the standard numbers
 * poker players describe each other with, each with how many chances it
 * was measured over. Those counts matter more than the numbers. VPIP and
 * PFR settle within about a hundred hands; the river-and-showdown numbers
 * need many more, and a stat from twelve chances is a rumour.
 */

export interface Stat {
  /** How many times it happened. */
  count: number
  /** Out of how many chances. */
  of: number
  /** count / of, or null with no chances yet. */
  rate: number | null
}

export interface StyleProfile {
  hands: number
  /** Won or lost per hundred hands, in big blinds. */
  bbPer100: number | null
  /** Voluntarily put money in preflop (a big blind's free check doesn't count). */
  vpip: Stat
  /** Raised preflop. */
  pfr: Stat
  /** Re-raised when facing exactly one raise preflop. */
  threeBet: Stat
  /** Postflop bets and raises per call. `of` counts calls; null rate with no calls. */
  aggressionFactor: { aggressive: number; calls: number; value: number | null }
  /** Bet the flop after raising preflop, when checked to or first to act. */
  cbet: Stat
  /** Folded to the preflop raiser's flop bet. */
  foldToCbet: Stat
  /** Of hands where they saw a flop, how many reached a showdown. */
  wtsd: Stat
  /** Of showdowns, how many they won (all or part of the pot). */
  wsd: Stat
  tilt: TiltSignature
}

/**
 * Does their play change after losing a big pot? VPIP and PFR in the hands
 * straight after one, next to the same numbers in every other hand. A
 * steady player's two columns match; a tilting one loosens up afterwards.
 */
export interface TiltSignature {
  /** Big losses seen. */
  bigLosses: number
  after: { vpip: Stat; pfr: Stat }
  otherwise: { vpip: Stat; pfr: Stat }
}

/** A loss this big, in big blinds, is a big pot lost. */
export const BIG_LOSS_BB = 25
/** How many hands after one count as "after". */
export const TILT_WINDOW = 10

const stat = (count: number, of: number): Stat => ({ count, of, rate: of > 0 ? count / of : null })

/** What one hand says about the player, before summing. */
interface HandFacts {
  vpip: boolean
  pfr: boolean
  threeBetChance: boolean
  threeBet: boolean
  postflopAggressive: number
  postflopCalls: number
  cbetChance: boolean
  cbet: boolean
  foldToCbetChance: boolean
  foldToCbet: boolean
  sawFlop: boolean
}

export function handFacts(hand: HandRecord): HandFacts {
  const facts: HandFacts = {
    vpip: false,
    pfr: false,
    threeBetChance: false,
    threeBet: false,
    postflopAggressive: 0,
    postflopCalls: 0,
    cbetChance: false,
    cbet: false,
    foldToCbetChance: false,
    foldToCbet: false,
    sawFlop: false,
  }
  const me = hand.player
  let level = hand.bigBlind
  let street: LoggedAction['street'] = 'preflop'
  let preflopRaises = 0
  let preflopAggressor: string | null = null
  let foldedPreflop = false
  // The flop, as it goes: has anyone bet yet, and was the first bet the preflop raiser's?
  let flopBets = 0
  let flopFirstBetter: string | null = null
  let actedOnFlop = false

  for (const action of hand.actions) {
    if (action.street !== street) {
      street = action.street
      level = 0
    }
    const kind = kindOf(action.type, action.amount, level)
    const mine = action.player === me

    if (street === 'preflop') {
      if (mine) {
        if (kind !== 'fold' && action.type !== 'check') facts.vpip = true
        if (kind === 'aggressive') facts.pfr = true
        if (kind === 'fold') foldedPreflop = true
        if (preflopRaises === 1 && !facts.threeBetChance) {
          facts.threeBetChance = true
          facts.threeBet = kind === 'aggressive'
        }
      }
      if (kind === 'aggressive') {
        preflopRaises++
        preflopAggressor = action.player
      }
    } else {
      if (mine) {
        if (kind === 'aggressive') facts.postflopAggressive++
        else if (action.type === 'call' || (action.type === 'all-in' && kind === 'passive')) facts.postflopCalls++
      }
      if (street === 'flop') {
        if (mine && !actedOnFlop) {
          actedOnFlop = true
          if (preflopAggressor === me && flopBets === 0) {
            facts.cbetChance = true
            facts.cbet = kind === 'aggressive'
          }
          if (preflopAggressor !== me && flopBets === 1 && flopFirstBetter === preflopAggressor) {
            facts.foldToCbetChance = true
            facts.foldToCbet = kind === 'fold'
          }
        }
        if (kind === 'aggressive') {
          flopBets++
          if (flopBets === 1) flopFirstBetter = action.player
        }
      }
    }
    if (kind === 'aggressive' && action.amount !== undefined) level = Math.max(level, action.amount)
  }
  facts.sawFlop = !foldedPreflop && hand.board.length >= 3
  return facts
}

export function styleProfile(hands: HandRecord[]): StyleProfile {
  const all = hands.map((hand) => ({ hand, facts: handFacts(hand) }))
  const count = (pick: (f: HandFacts) => boolean, among = all) => among.filter(({ facts }) => pick(facts)).length

  const chances = (chance: (f: HandFacts) => boolean, hit: (f: HandFacts) => boolean) => {
    const eligible = all.filter(({ facts }) => chance(facts))
    return stat(eligible.filter(({ facts }) => hit(facts)).length, eligible.length)
  }

  const aggressive = all.reduce((sum, { facts }) => sum + facts.postflopAggressive, 0)
  const calls = all.reduce((sum, { facts }) => sum + facts.postflopCalls, 0)
  const sawFlop = all.filter(({ facts }) => facts.sawFlop)
  const showdowns = all.filter(({ hand }) => hand.showdown)
  const bbWon = hands.reduce((sum, h) => sum + (h.bigBlind > 0 ? h.net / h.bigBlind : 0), 0)

  // Tilt: mark the hands within TILT_WINDOW after a big loss, in the same sitting.
  const afterLoss = new Set<number>()
  let bigLosses = 0
  hands.forEach((hand, i) => {
    if (hand.bigBlind <= 0 || hand.net > -BIG_LOSS_BB * hand.bigBlind) return
    bigLosses++
    for (let j = i + 1; j <= i + TILT_WINDOW && j < hands.length; j++) {
      if (hands[j].session === hand.session) afterLoss.add(j)
    }
  })
  const after = all.filter((_, i) => afterLoss.has(i))
  const otherwise = all.filter((_, i) => !afterLoss.has(i))

  return {
    hands: hands.length,
    bbPer100: hands.length > 0 ? (bbWon / hands.length) * 100 : null,
    vpip: stat(count((f) => f.vpip), all.length),
    pfr: stat(count((f) => f.pfr), all.length),
    threeBet: chances(
      (f) => f.threeBetChance,
      (f) => f.threeBet,
    ),
    aggressionFactor: { aggressive, calls, value: calls > 0 ? aggressive / calls : null },
    cbet: chances(
      (f) => f.cbetChance,
      (f) => f.cbet,
    ),
    foldToCbet: chances(
      (f) => f.foldToCbetChance,
      (f) => f.foldToCbet,
    ),
    wtsd: stat(sawFlop.filter(({ hand }) => hand.showdown).length, sawFlop.length),
    wsd: stat(showdowns.filter(({ hand }) => hand.won).length, showdowns.length),
    tilt: {
      bigLosses,
      after: { vpip: stat(count((f) => f.vpip, after), after.length), pfr: stat(count((f) => f.pfr, after), after.length) },
      otherwise: {
        vpip: stat(count((f) => f.vpip, otherwise), otherwise.length),
        pfr: stat(count((f) => f.pfr, otherwise), otherwise.length),
      },
    },
  }
}
