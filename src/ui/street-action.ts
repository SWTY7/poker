import type { HandLogEntry } from '../poker/game-state'

/**
 * What this player did on the CURRENT street. Scanning the whole hand instead
 * — as this used to — leaves a preflop "Raise $30" pinned to a seat while the
 * turn is being bet, which is worse than showing nothing.
 *
 * It also goes quiet once the action has moved on: after someone bets into a
 * player who had checked, that player owes chips and has not answered yet, so
 * their earlier "Check" is out of date. Showing it put "Check" under a $263 bet
 * to call.
 */
export function lastActionThisStreet(
  log: HandLogEntry[],
  player: { id: string; betThisStreet: number; folded: boolean; isAllIn: boolean },
  street: string,
  currentBet: number,
): string | undefined {
  const owes = !player.folded && !player.isAllIn && player.betThisStreet < currentBet
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i]
    if (entry.street !== street) break
    if (entry.kind !== 'action' || entry.playerId !== player.id) continue
    if (owes) return undefined
    switch (entry.actionType) {
      case 'fold':
        return 'Folded'
      case 'check':
        return 'Check'
      case 'call':
        return `Call $${entry.amount?.toLocaleString()}`
      case 'bet':
        return `Bet $${entry.toAmount?.toLocaleString()}`
      case 'raise':
        return `Raise $${entry.toAmount?.toLocaleString()}`
      case 'all-in':
        return 'All-in'
    }
  }
  return undefined
}
