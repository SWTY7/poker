import type { ActionType, HandLogEntry, PokerAction, Pot, Street } from '../poker/game-state'
import { createPlayer, type PlayerState } from '../poker/player'
import {
  applyAction,
  getLegalActions,
  isBettingRoundComplete,
  isHandOver,
  logEvent,
  maxRaiseTargetAmount,
  minRaiseTargetAmount,
  nextActingPlayerIndex,
  type BettingState,
} from '../poker/betting'
import { computePots, distributePots, totalPot } from '../poker/pot'

/**
 * The home game's table: real cards on a real table, and only the chips in
 * the app. The same betting rules as the dealt game (`poker/betting.ts`) and
 * the same side-pot maths (`poker/pot.ts`), but nothing is dealt or evaluated:
 * the host turns each street after dealing it for real, and picks who won each
 * pot at showdown.
 *
 * A pure reducer: `reduce(state, command)` returns a new state or throws
 * `HomeTableError` with a message fit to show the person who tried it. The
 * room (`room.ts`) runs it on the host's device, the only copy that counts.
 */

export interface HomeConfig {
  startingStack: number
  smallBlind: number
  bigBlind: number
  ante: number
}

/**
 * Where the hand stands, from the host's side:
 *   lobby       no hand yet: people join, the host seats them
 *   betting     someone is to act
 *   street-done this street's betting is over; the host deals the next card(s)
 *   showdown    the river is done; the host picks each pot's winner
 *   hand-over   chips are paid; the host deals the next hand when ready
 */
export type Phase = 'lobby' | 'betting' | 'street-done' | 'showdown' | 'hand-over'

export interface HandResult {
  potAmount: number
  winnerIds: string[]
}

interface Table extends BettingState {
  config: HomeConfig
  players: PlayerState[]
  phase: Phase
  street: Street
  dealerIndex: number
  smallBlindIndex: number
  bigBlindIndex: number
  /** -1 when nobody is to act. */
  currentPlayerIndex: number
  handNumber: number
  /** At showdown: the pots the host is picking winners for. */
  pots: Pot[]
  lastResults: HandResult[]
  actionHistory: PokerAction[]
  handLog: HandLogEntry[]
}

export interface HomeState extends Table {
  version: 1
  /** Earlier states of this hand, newest last, for undo. Cleared when a hand starts. */
  undo: Table[]
}

/** The table without its undo history: what phones are sent, and all the read-only helpers below need. */
export type TableSnapshot = Omit<HomeState, 'undo'>

export type Command =
  | { type: 'join'; id: string; name: string }
  | { type: 'remove'; id: string }
  | { type: 'move'; id: string; toIndex: number }
  | { type: 'configure'; config: HomeConfig }
  | { type: 'adjustStack'; id: string; stack: number }
  | { type: 'startHand' }
  | { type: 'act'; playerId: string; action: ActionType; amount?: number }
  | { type: 'advanceStreet' }
  | { type: 'award'; winnersByPot: string[][] }
  | { type: 'undo' }

export class HomeTableError extends Error {}

const MAX_UNDO = 40
const MAX_NAME = 16

export function newTable(config: HomeConfig): HomeState {
  return {
    version: 1,
    config,
    players: [],
    phase: 'lobby',
    street: 'preflop',
    dealerIndex: -1,
    smallBlindIndex: -1,
    bigBlindIndex: -1,
    currentPlayerIndex: -1,
    currentBet: 0,
    minRaise: config.bigBlind,
    handNumber: 0,
    pots: [],
    lastResults: [],
    actionHistory: [],
    handLog: [],
    undo: [],
  }
}

function fail(message: string): never {
  throw new HomeTableError(message)
}

/** True between hands, when seats, stacks and blinds may change. */
export function betweenHands(state: TableSnapshot): boolean {
  return state.phase === 'lobby' || state.phase === 'hand-over'
}

export function reduce(state: HomeState, command: Command): HomeState {
  // Work on a copy: the betting rules mutate in place, and a command that
  // throws halfway must leave the real state untouched.
  const { undo, ...table } = state
  const next: HomeState = { ...structuredClone(table), undo }
  const snapshot = (): void => {
    next.undo = [...undo, structuredClone(table)].slice(-MAX_UNDO)
  }

  switch (command.type) {
    case 'join': {
      const name = command.name.trim().slice(0, MAX_NAME)
      if (!name) fail('Pick a name.')
      const existing = next.players.find((p) => p.id === command.id)
      if (existing) {
        existing.name = name
        return next
      }
      if (next.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) fail(`Someone is already called ${name}.`)
      if (next.players.length >= 10) fail('The table is full.')
      const player = createPlayer(command.id, name, next.config.startingStack)
      // Joining mid-hand is fine; they sit out until the next deal.
      if (!betweenHands(state)) player.folded = true
      next.players.push(player)
      return next
    }

    case 'remove': {
      if (!betweenHands(state)) fail('Wait for the hand to finish.')
      const index = next.players.findIndex((p) => p.id === command.id)
      if (index < 0) return next
      next.players.splice(index, 1)
      // Keep the button on the same seat, or the one before it if that seat left.
      if (index <= next.dealerIndex) next.dealerIndex--
      return next
    }

    case 'move': {
      if (!betweenHands(state)) fail('Wait for the hand to finish.')
      const from = next.players.findIndex((p) => p.id === command.id)
      if (from < 0) fail('No such player.')
      const to = Math.min(Math.max(command.toIndex, 0), next.players.length - 1)
      const dealerId = next.players[next.dealerIndex]?.id
      const [player] = next.players.splice(from, 1)
      next.players.splice(to, 0, player)
      if (dealerId) next.dealerIndex = next.players.findIndex((p) => p.id === dealerId)
      return next
    }

    case 'configure': {
      if (!betweenHands(state)) fail('Wait for the hand to finish.')
      const { startingStack, smallBlind, bigBlind, ante } = command.config
      if (!(smallBlind > 0 && bigBlind >= smallBlind && ante >= 0 && startingStack > 0)) fail('Those blinds don’t add up.')
      next.config = { startingStack, smallBlind, bigBlind, ante }
      return next
    }

    case 'adjustStack': {
      if (!betweenHands(state)) fail('Wait for the hand to finish.')
      const player = next.players.find((p) => p.id === command.id)
      if (!player) fail('No such player.')
      if (!Number.isInteger(command.stack) || command.stack < 0) fail('A stack is a whole number of chips.')
      player.stack = command.stack
      // A rebuy brings a busted player back in.
      player.isEliminated = command.stack === 0
      return next
    }

    case 'startHand':
      startHand(next)
      // Undo reaches back as far as the deal (a mis-tapped "New hand"), never into the last hand.
      next.undo = [structuredClone(table)]
      return next

    case 'act': {
      if (next.phase !== 'betting') fail('Nobody is to act right now.')
      const actor = next.players[next.currentPlayerIndex]
      if (actor?.id !== command.playerId) fail(`It's ${actor?.name ?? 'nobody'}'s turn.`)
      if (!getLegalActions(next, actor.id).includes(command.action)) fail(`Can't ${command.action} now.`)
      if (command.action === 'bet' || command.action === 'raise') {
        const amount = command.amount
        if (amount === undefined || !Number.isInteger(amount)) fail('How much?')
        if (amount < minRaiseTargetAmount(next)) fail(`The minimum is ${minRaiseTargetAmount(next)}.`)
        if (amount > maxRaiseTargetAmount(next, actor.id)) fail('That’s more than the stack.')
      }
      snapshot()
      try {
        applyAction(next, { playerId: actor.id, type: command.action, amount: command.amount })
      } catch (error) {
        fail(error instanceof Error ? error.message : 'Not allowed.')
      }
      afterAction(next)
      return next
    }

    case 'advanceStreet': {
      if (next.phase !== 'street-done') fail('Finish the betting first.')
      snapshot()
      advanceStreet(next)
      return next
    }

    case 'award': {
      if (next.phase !== 'showdown') fail('Not at a showdown.')
      if (command.winnersByPot.length !== next.pots.length) fail('Pick a winner for every pot.')
      next.pots.forEach((pot, i) => {
        const winners = command.winnersByPot[i]
        if (winners.length === 0) fail('Pick a winner for every pot.')
        if (!winners.every((id) => pot.eligiblePlayerIds.includes(id))) fail('Only players in a pot can win it.')
      })
      snapshot()
      const payouts = distributePots(next.pots, command.winnersByPot, seatOrderFromDealer(next))
      for (const [id, amount] of payouts) {
        const player = next.players.find((p) => p.id === id)
        if (player) player.stack += amount
      }
      next.lastResults = next.pots.map((pot, i) => ({ potAmount: pot.amount, winnerIds: command.winnersByPot[i] }))
      next.lastResults.forEach((result, i) => {
        const names = result.winnerIds.map((id) => next.players.find((p) => p.id === id)?.name ?? id).join(' & ')
        const potName = next.pots.length > 1 ? (i === 0 ? 'main pot' : `side pot ${i}`) : 'pot'
        logEvent(next, { street: 'showdown', kind: 'result', amount: result.potAmount, message: `${names} wins the ${potName}` })
      })
      endHand(next)
      return next
    }

    case 'undo': {
      const previous = undo.at(-1)
      if (!previous) fail('Nothing to undo.')
      return { ...structuredClone(previous), version: 1, undo: undo.slice(0, -1) }
    }
  }
}

// ---------- the hand ----------

function inHand(p: PlayerState): boolean {
  return !p.isEliminated
}

function nextSeat(state: Table, from: number): number {
  const n = state.players.length
  for (let step = 1; step <= n; step++) {
    const i = (from + step + n) % n
    if (inHand(state.players[i])) return i
  }
  return fail('Nobody has chips.')
}

export function canStartHand(state: TableSnapshot): boolean {
  return betweenHands(state) && state.players.filter(inHand).length >= 2
}

function startHand(state: Table): void {
  if (!(state.phase === 'lobby' || state.phase === 'hand-over')) fail('A hand is already running.')
  if (state.players.filter(inHand).length < 2) fail('Need two players with chips.')

  for (const p of state.players) {
    p.folded = !inHand(p)
    p.isAllIn = false
    p.betThisStreet = 0
    p.totalContributed = 0
    p.hasActed = false
  }
  state.actionHistory = []
  state.handLog = []
  state.pots = []
  state.lastResults = []
  state.street = 'preflop'
  state.handNumber++
  state.dealerIndex = nextSeat(state, state.dealerIndex)

  const { smallBlind, bigBlind, ante } = state.config
  if (ante > 0) {
    for (const p of state.players) {
      if (!inHand(p)) continue
      const amount = Math.min(ante, p.stack)
      commit(p, amount, false)
      logEvent(state, { street: 'preflop', kind: 'ante', playerId: p.id, playerName: p.name, amount, message: 'ante' })
    }
  }

  const headsUp = state.players.filter(inHand).length === 2
  const sb = headsUp ? state.dealerIndex : nextSeat(state, state.dealerIndex)
  const bb = nextSeat(state, sb)
  postBlind(state, sb, smallBlind, 'small blind')
  postBlind(state, bb, bigBlind, 'big blind')
  state.smallBlindIndex = sb
  state.bigBlindIndex = bb
  state.currentBet = bigBlind
  state.minRaise = bigBlind

  const canAct = state.players.filter((p) => !p.folded && !p.isAllIn)
  if (canAct.length <= 1) {
    // A blind put someone all-in before anyone had a decision: no betting,
    // the host just deals the board out.
    state.phase = 'street-done'
    state.currentPlayerIndex = -1
    return
  }
  state.phase = 'betting'
  state.currentPlayerIndex = headsUp ? sb : (nextActingPlayerIndex(state, bb) as number)
}

function commit(p: PlayerState, amount: number, toStreet: boolean): void {
  p.stack -= amount
  p.totalContributed += amount
  if (toStreet) p.betThisStreet += amount
  if (p.stack === 0) p.isAllIn = true
}

function postBlind(state: Table, index: number, amount: number, label: string): void {
  const p = state.players[index]
  const actual = Math.min(amount, p.stack)
  commit(p, actual, true)
  logEvent(state, { street: 'preflop', kind: 'blind', playerId: p.id, playerName: p.name, amount: actual, toAmount: p.betThisStreet, message: label })
}

function afterAction(state: Table): void {
  if (isHandOver(state)) {
    // Everyone else folded: no showdown, no cards shown, the pot just goes.
    const winner = state.players.find((p) => !p.folded)!
    const pot = totalPot(state.players)
    winner.stack += pot
    state.lastResults = [{ potAmount: pot, winnerIds: [winner.id] }]
    logEvent(state, { street: state.street, kind: 'result', playerId: winner.id, playerName: winner.name, amount: pot, message: `${winner.name} wins — everyone else folded` })
    endHand(state)
    return
  }
  const next = isBettingRoundComplete(state) ? null : nextActingPlayerIndex(state, state.currentPlayerIndex)
  if (next !== null) {
    state.currentPlayerIndex = next
    return
  }
  state.currentPlayerIndex = -1
  if (state.street === 'river') toShowdown(state)
  else state.phase = 'street-done'
}

const NEXT_STREET: Partial<Record<Street, Street>> = { preflop: 'flop', flop: 'turn', turn: 'river' }

function advanceStreet(state: Table): void {
  const street = NEXT_STREET[state.street]
  if (!street) {
    toShowdown(state)
    return
  }
  for (const p of state.players) {
    p.betThisStreet = 0
    if (!p.folded && !p.isAllIn) p.hasActed = false
  }
  state.currentBet = 0
  state.minRaise = state.config.bigBlind
  state.street = street
  logEvent(state, { street, kind: 'deal' })

  const canAct = state.players.filter((p) => !p.folded && !p.isAllIn)
  if (canAct.length <= 1) {
    // Everyone left is all-in (or one player isn't): nothing to bet, keep dealing.
    state.phase = 'street-done'
    state.currentPlayerIndex = -1
    return
  }
  state.phase = 'betting'
  state.currentPlayerIndex = nextActingPlayerIndex(state, state.dealerIndex) as number
}

function toShowdown(state: Table): void {
  for (const p of state.players) p.betThisStreet = 0
  state.street = 'showdown'
  state.pots = computePots(state.players)
  state.phase = 'showdown'
  state.currentPlayerIndex = -1
}

function endHand(state: Table): void {
  for (const p of state.players) {
    p.betThisStreet = 0
    if (p.stack === 0) p.isEliminated = true
  }
  state.pots = []
  state.currentBet = 0
  state.currentPlayerIndex = -1
  state.phase = 'hand-over'
}

/** Seats from the one after the button, for who gets an odd chip in a split. */
function seatOrderFromDealer(state: Table): string[] {
  const n = state.players.length
  return Array.from({ length: n }, (_, step) => state.players[(state.dealerIndex + 1 + step) % n].id)
}

// ---------- what a phone needs to show ----------

/** What the player to act may do, and the bet sizes allowed. */
export function options(state: TableSnapshot, playerId: string): { actions: ActionType[]; toCall: number; minTo: number; maxTo: number } | null {
  if (state.phase !== 'betting' || state.players[state.currentPlayerIndex]?.id !== playerId) return null
  const player = state.players[state.currentPlayerIndex]
  return {
    actions: getLegalActions(state, playerId),
    toCall: Math.min(state.currentBet - player.betThisStreet, player.stack),
    minTo: minRaiseTargetAmount(state),
    maxTo: maxRaiseTargetAmount(state, playerId),
  }
}

/** Every chip at the table, in stacks and in the pot. Never changes except by the host adjusting a stack. */
export function chipsInPlay(state: TableSnapshot): number {
  return state.players.reduce((sum, p) => sum + p.stack + (betweenHands(state) ? 0 : p.totalContributed), 0)
}

/** Chips in the middle, bets in front of players included. */
export function potTotal(state: TableSnapshot): number {
  return betweenHands(state) ? 0 : totalPot(state.players)
}
