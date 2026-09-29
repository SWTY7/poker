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
import { RANKS, SUITS, cardsEqual, type Card } from '../poker/card'
import { compareHandValues, evaluateBestHand, type HandValue } from '../poker/hand-evaluator'
import { describeHandValue } from '../poker/hand-name'

/**
 * The home game's table, in one of two card modes:
 *
 *   real    a real deck on a real table, and only the chips in the app. The
 *           host turns each street after dealing it for real, and picks who
 *           won each pot at showdown.
 *   online  the app deals. The deck and every hand live in this state on the
 *           room server; each phone is sent `viewFor` its own seat, which has
 *           nobody else's cards. Streets deal themselves when the betting
 *           closes, and the showdown is settled by the engine's own evaluator.
 *
 * Either way, the same betting rules as the dealt game (`poker/betting.ts`)
 * and the same side-pot maths (`poker/pot.ts`).
 *
 * A pure reducer: `reduce(state, command)` returns a new state or throws
 * `HomeTableError` with a message fit to show the person who tried it. It
 * draws no random numbers: a new hand's shuffled deck comes in with the
 * `startHand` command, from the server.
 */

export interface HomeConfig {
  startingStack: number
  smallBlind: number
  bigBlind: number
  ante: number
}

export type CardMode = 'real' | 'online'

/**
 * Where the hand stands, from the host's side:
 *   lobby       no hand yet: people join, the host seats them
 *   betting     someone is to act
 *   street-done this street's betting is over; the host deals the next card(s)
 *   showdown    the river is done; the host picks each pot's winner
 *   hand-over   chips are paid; the host deals the next hand when ready
 *
 * With online cards the table never rests in street-done or showdown: it deals
 * and settles those by itself.
 */
export type Phase = 'lobby' | 'betting' | 'street-done' | 'showdown' | 'hand-over'

export interface HandResult {
  potAmount: number
  winnerIds: string[]
  /** Online cards: what the winning hand was, e.g. 'two-pair'. */
  category?: string
  /** Online cards: the winning hand in words, e.g. 'Pair of jacks'. */
  hand?: string
}

interface Table extends BettingState {
  config: HomeConfig
  cards: CardMode
  /** Online cards: what's left of this hand's deck, next card last. Never leaves the server. */
  deck: Card[]
  /** Online cards: the community cards dealt so far. */
  board: Card[]
  /** Online cards: players whose hole cards everyone may see (those still in at a showdown). */
  revealed: string[]
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
  /** `deck` is required with online cards: all 52, shuffled by the server. */
  | { type: 'startHand'; deck?: Card[] }
  | { type: 'act'; playerId: string; action: ActionType; amount?: number }
  | { type: 'advanceStreet' }
  | { type: 'award'; winnersByPot: string[][] }
  | { type: 'undo' }

export class HomeTableError extends Error {}

const MAX_UNDO = 40
const MAX_NAME = 16

export function newTable(config: HomeConfig, cards: CardMode = 'real'): HomeState {
  return {
    version: 1,
    config,
    cards,
    deck: [],
    board: [],
    revealed: [],
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
      startHand(next, command.deck)
      // Undo reaches back as far as the deal (a mis-tapped "New hand"), never into the last hand.
      // Not with online cards: everyone has already looked at theirs.
      next.undo = next.cards === 'online' ? [] : [structuredClone(table)]
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
      // With online cards, undo never reaches back past a card being shown: nobody replays a decision knowing what came next.
      if (next.cards === 'online' && (next.board.length !== state.board.length || (next.phase as Phase) === 'hand-over')) next.undo = []
      return next
    }

    case 'advanceStreet': {
      if (next.cards === 'online') fail('The app deals in this game.')
      if (next.phase !== 'street-done') fail('Finish the betting first.')
      snapshot()
      advanceStreet(next)
      return next
    }

    case 'award': {
      if (next.cards === 'online') fail('The app settles the showdown in this game.')
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

function startHand(state: Table, deck: Card[] | undefined): void {
  if (!(state.phase === 'lobby' || state.phase === 'hand-over')) fail('A hand is already running.')
  if (state.players.filter(inHand).length < 2) fail('Need two players with chips.')
  if (state.cards === 'online' && !isFullDeck(deck)) fail('The deck didn’t arrive. Try again.')

  state.board = []
  state.revealed = []
  state.deck = state.cards === 'online' ? [...deck!] : []
  for (const p of state.players) {
    p.holeCards = []
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

  if (state.cards === 'online') {
    // Two rounds, one card at a time, starting left of the button, the way a dealer does.
    const n = state.players.length
    for (let round = 0; round < 2; round++) {
      for (let step = 1; step <= n; step++) {
        const p = state.players[(state.dealerIndex + step) % n]
        if (inHand(p)) p.holeCards.push(state.deck.pop()!)
      }
    }
  }

  const canAct = state.players.filter((p) => !p.folded && !p.isAllIn)
  if (canAct.length <= 1) {
    // A blind put someone all-in before anyone had a decision: no betting,
    // the board is just dealt out.
    state.phase = 'street-done'
    state.currentPlayerIndex = -1
    if (state.cards === 'online') runOut(state)
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
  if (state.cards === 'online') runOut(state)
}

/**
 * Online cards: deals on from a closed street by itself, straight through
 * any street nobody can bet on (everyone all-in), to the next betting round
 * or to a settled showdown.
 */
function runOut(state: Table): void {
  while (state.phase === 'street-done') advanceStreet(state)
  if (state.phase === 'showdown') settleShowdown(state)
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
  if (state.cards === 'online') {
    const dealt = Array.from({ length: street === 'flop' ? 3 : 1 }, () => state.deck.pop()!)
    state.board.push(...dealt)
    logEvent(state, { street, kind: 'deal', cards: dealt })
  } else {
    logEvent(state, { street, kind: 'deal' })
  }

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

/**
 * Online cards: the showdown the host would otherwise judge. Every pot goes
 * to the best hand among the players in it, ties split, and everyone still
 * in shows their cards. Folded hands stay face down for good.
 */
function settleShowdown(state: Table): void {
  const value = new Map<string, HandValue>()
  for (const p of state.players) {
    if (!p.folded && p.holeCards.length === 2) value.set(p.id, evaluateBestHand([...p.holeCards, ...state.board]))
  }
  const winners = state.pots.map((pot) => {
    let best: HandValue | null = null
    let ids: string[] = []
    for (const id of pot.eligiblePlayerIds) {
      const v = value.get(id)
      if (!v) continue
      const order = best ? compareHandValues(v, best) : 1
      if (order > 0) {
        best = v
        ids = [id]
      } else if (order === 0) ids.push(id)
    }
    return { ids, category: best?.category, hand: best ? describeHandValue(best) : undefined }
  })
  const payouts = distributePots(
    state.pots,
    winners.map((w) => w.ids),
    seatOrderFromDealer(state),
  )
  for (const [id, amount] of payouts) {
    const player = state.players.find((p) => p.id === id)
    if (player) player.stack += amount
  }
  state.revealed = [...value.keys()]
  for (const id of state.revealed) {
    const p = state.players.find((pl) => pl.id === id)!
    logEvent(state, { street: 'showdown', kind: 'reveal', playerId: id, playerName: p.name, cards: p.holeCards })
  }
  state.lastResults = state.pots.map((pot, i) => ({
    potAmount: pot.amount,
    winnerIds: winners[i].ids,
    category: winners[i].category,
    hand: winners[i].hand,
  }))
  state.lastResults.forEach((result, i) => {
    const names = result.winnerIds.map((id) => state.players.find((p) => p.id === id)?.name ?? id).join(' & ')
    const potName = state.pots.length > 1 ? (i === 0 ? 'main pot' : `side pot ${i}`) : 'pot'
    const hand = result.hand ? ` (${result.hand})` : ''
    logEvent(state, { street: 'showdown', kind: 'result', amount: result.potAmount, message: `${names} wins the ${potName}${hand}` })
  })
  endHand(state)
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

// ---------- decks ----------

/** All 52 cards, shuffled with `random` (the server passes a crypto-strength one). */
export function shuffledDeck(random: () => number): Card[] {
  const deck: Card[] = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })))
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[deck[i], deck[j]] = [deck[j], deck[i]]
  }
  return deck
}

function isFullDeck(deck: Card[] | undefined): deck is Card[] {
  if (!Array.isArray(deck) || deck.length !== 52) return false
  return deck.every((card, i) => RANKS.includes(card?.rank) && SUITS.includes(card?.suit) && deck.findIndex((c) => cardsEqual(c, card)) === i)
}

// ---------- what a phone needs to show ----------

/**
 * The table as one seat may see it: no deck, and nobody's hole cards but
 * their own, unless shown at a showdown. `viewerId` null (the host who only
 * deals, or a spectator) sees no hole cards at all.
 */
export function viewFor<T extends TableSnapshot>(state: T, viewerId: string | null): T {
  return {
    ...state,
    deck: [],
    players: state.players.map((p) => (p.id === viewerId || state.revealed.includes(p.id) ? p : { ...p, holeCards: [] })),
  }
}

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
