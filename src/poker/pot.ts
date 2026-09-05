import type { PlayerState } from './player'
import type { Pot } from './game-state'

/** Every chip committed to this hand, including bets still out in front of players. */
export function totalPot(players: PlayerState[]): number {
  return players.reduce((sum, p) => sum + p.totalContributed, 0)
}

/** Chips wagered on the current street only — the stacks sitting in front of seats. */
export function streetBetTotal(players: PlayerState[]): number {
  return players.reduce((sum, p) => sum + p.betThisStreet, 0)
}

/**
 * The pot as a table would actually show it: chips already swept in from
 * earlier streets. This street's bets are displayed in front of each seat
 * instead, so counting them here as well would show every wager twice.
 */
export function committedPot(players: PlayerState[]): number {
  return totalPot(players) - streetBetTotal(players)
}

/**
 * Splits total contributions into a main pot and side pots based on each
 * player's total chips committed this hand. Handles uneven all-ins: a
 * player who is only eligible for part of the money because they went
 * all-in for less than others is only listed as eligible for the pot
 * layers they actually funded.
 */
export function computePots(players: PlayerState[]): Pot[] {
  const contributors = players.filter((p) => p.totalContributed > 0)
  if (contributors.length === 0) return []

  const levels = Array.from(new Set(contributors.map((p) => p.totalContributed))).sort((a, b) => a - b)

  const pots: Pot[] = []
  let previousLevel = 0
  for (const level of levels) {
    const increment = level - previousLevel
    const payers = contributors.filter((p) => p.totalContributed >= level)
    const amount = increment * payers.length
    if (amount > 0) {
      const eligiblePlayerIds = payers.filter((p) => !p.folded).map((p) => p.id)
      pots.push({ amount, eligiblePlayerIds })
    }
    previousLevel = level
  }

  return mergeAdjacentPotsWithSameEligibility(pots)
}

function mergeAdjacentPotsWithSameEligibility(pots: Pot[]): Pot[] {
  const merged: Pot[] = []
  for (const pot of pots) {
    const last = merged[merged.length - 1]
    if (last && sameMembers(last.eligiblePlayerIds, pot.eligiblePlayerIds)) {
      last.amount += pot.amount
    } else {
      merged.push({ ...pot })
    }
  }
  return merged
}

function sameMembers(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

/** Distributes each pot's chips among its winners, giving odd chips to the
 * earliest winner in seat order starting after the dealer button. */
export function distributePots(
  pots: Pot[],
  winnersByPot: string[][],
  seatOrderFromDealer: string[],
): Map<string, number> {
  const payouts = new Map<string, number>()
  pots.forEach((pot, i) => {
    const winners = winnersByPot[i]
    if (winners.length === 0) return
    const share = Math.floor(pot.amount / winners.length)
    let remainder = pot.amount - share * winners.length
    const orderedWinners = seatOrderFromDealer.filter((id) => winners.includes(id))
    for (const id of orderedWinners) {
      let amount = share
      if (remainder > 0) {
        amount += 1
        remainder -= 1
      }
      payouts.set(id, (payouts.get(id) ?? 0) + amount)
    }
  })
  return payouts
}
