import type { ActionType, GameState, HandLogEntry, PokerAction } from './game-state'
import type { PlayerState } from './player'
import { totalPot } from './pot'

function getPlayer(state: GameState, playerId: string): PlayerState {
  const player = state.players.find((p) => p.id === playerId)
  if (!player) throw new Error(`Unknown player: ${playerId}`)
  return player
}

/** Appends one line to the hand narration, stamping it with sequence and pot. */
export function logEvent(state: GameState, entry: Omit<HandLogEntry, 'seq' | 'potAfter'>): void {
  state.handLog.push({
    ...entry,
    seq: state.handLog.length,
    potAfter: totalPot(state.players),
  })
}

export function getLegalActions(state: GameState, playerId: string): ActionType[] {
  const player = getPlayer(state, playerId)
  if (player.folded || player.isAllIn) return []

  const toCall = state.currentBet - player.betThisStreet
  const actions: ActionType[] = []

  if (toCall > 0) {
    actions.push('fold', 'call')
  } else {
    actions.push('check')
  }

  // A 'bet'/'raise' action is only offered when the player can actually
  // cover a full-size minimum raise; a shorter stack can still go all-in,
  // it just can't reopen the betting with a full raise.
  const minRaiseTarget = state.currentBet + state.minRaise
  const canMakeFullRaise = player.stack > toCall && player.betThisStreet + player.stack >= minRaiseTarget
  if (canMakeFullRaise) {
    actions.push(state.currentBet === 0 ? 'bet' : 'raise')
  }
  if (player.stack > 0) actions.push('all-in')

  return actions
}

export function minRaiseTargetAmount(state: GameState): number {
  return state.currentBet + state.minRaise
}

export function maxRaiseTargetAmount(state: GameState, playerId: string): number {
  const player = getPlayer(state, playerId)
  return player.betThisStreet + player.stack
}

function commitChips(player: PlayerState, amount: number): void {
  player.stack -= amount
  player.betThisStreet += amount
  player.totalContributed += amount
}

/**
 * Applies a validated player action to the game state, mutating it in place.
 *
 * Simplification vs. formal tournament rules: any raise (including a short
 * all-in raise below the normal minimum) reopens the betting round for
 * players who already acted. Real casino rules sometimes deny full
 * re-raising rights after a short all-in raise; that nuance is not modeled.
 */
export function applyAction(state: GameState, action: PokerAction): void {
  const player = getPlayer(state, action.playerId)
  if (player.folded || player.isAllIn) {
    throw new Error(`Player ${action.playerId} cannot act (already folded or all-in)`)
  }

  const toCall = state.currentBet - player.betThisStreet
  const committedBefore = player.totalContributed

  switch (action.type) {
    case 'fold': {
      player.folded = true
      player.hasActed = true
      break
    }
    case 'check': {
      if (toCall !== 0) throw new Error('Cannot check while facing a bet')
      player.hasActed = true
      break
    }
    case 'call': {
      const amount = Math.min(toCall, player.stack)
      if (amount <= 0) throw new Error('Nothing to call')
      commitChips(player, amount)
      player.hasActed = true
      break
    }
    case 'bet':
    case 'raise':
    case 'all-in': {
      const targetTotal = action.type === 'all-in' ? player.betThisStreet + player.stack : action.amount
      if (targetTotal === undefined) throw new Error(`${action.type} requires an amount`)

      const increment = targetTotal - player.betThisStreet
      if (increment <= 0) throw new Error("Bet/raise must increase the player's bet")
      if (increment > player.stack) throw new Error('Not enough chips for that bet/raise')

      if (targetTotal <= state.currentBet) {
        // Going all-in for less than the current bet: it's just a (partial) call.
        commitChips(player, increment)
        player.hasActed = true
        break
      }

      const raiseSize = targetTotal - state.currentBet
      if (action.type !== 'all-in' && raiseSize < state.minRaise) {
        throw new Error('Raise is smaller than the minimum raise')
      }

      commitChips(player, increment)
      state.currentBet = targetTotal
      state.minRaise = Math.max(state.minRaise, raiseSize)
      player.hasActed = true
      for (const other of state.players) {
        if (other.id !== player.id && !other.folded && !other.isAllIn) other.hasActed = false
      }
      break
    }
  }

  if (player.stack === 0 && !player.folded) player.isAllIn = true
  state.actionHistory.push(action)

  const committed = player.totalContributed - committedBefore
  logEvent(state, {
    street: state.street,
    kind: 'action',
    playerId: player.id,
    playerName: player.name,
    actionType: action.type,
    amount: committed,
    toAmount: committed > 0 ? player.betThisStreet : undefined,
  })
}

export function isBettingRoundComplete(state: GameState): boolean {
  const contenders = state.players.filter((p) => !p.folded)
  if (contenders.length <= 1) return true
  const stillToAct = contenders.filter((p) => !p.isAllIn)
  if (stillToAct.length === 0) return true
  return stillToAct.every((p) => p.hasActed && p.betThisStreet === state.currentBet)
}

export function isHandOver(state: GameState): boolean {
  return state.players.filter((p) => !p.folded).length <= 1
}

/** Finds the next player able to act, starting the search after `fromIndex`. */
export function nextActingPlayerIndex(state: GameState, fromIndex: number): number | null {
  const n = state.players.length
  for (let step = 1; step <= n; step++) {
    const idx = (fromIndex + step) % n
    const p = state.players[idx]
    if (!p.folded && !p.isAllIn && !p.isEliminated) return idx
  }
  return null
}
