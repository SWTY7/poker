import { Deck } from './deck'
import { compareHandValues, evaluateBestHand } from './hand-evaluator'
import { createPlayer } from './player'
import { computePots, distributePots, totalPot } from './pot'
import { applyAction, getLegalActions, isBettingRoundComplete, isHandOver, logEvent, nextActingPlayerIndex } from './betting'
import type { GameConfig, GameState, PokerAction } from './game-state'
import type { Rng } from '../utils/random'

export interface PlayerSetup {
  id: string
  name: string
  stack: number
}

export class HoldemEngine {
  state: GameState
  private rng?: Rng

  constructor(players: PlayerSetup[], config: GameConfig, rng?: Rng) {
    if (players.length < 2) throw new Error('Need at least 2 players')
    this.rng = rng
    this.state = {
      players: players.map((p) => createPlayer(p.id, p.name, p.stack)),
      communityCards: [],
      pots: [],
      dealerIndex: -1,
      smallBlindIndex: -1,
      bigBlindIndex: -1,
      currentPlayerIndex: -1,
      currentBet: 0,
      minRaise: config.bigBlind,
      street: 'preflop',
      actionHistory: [],
      handLog: [],
      config,
      handNumber: 0,
      handInProgress: false,
      lastResults: [],
      deck: new Deck(rng),
      eliminationOrder: [],
    }
  }

  private nonEliminatedCount(): number {
    return this.state.players.filter((p) => !p.isEliminated).length
  }

  private nextNonEliminatedIndex(fromIndex: number): number {
    const n = this.state.players.length
    for (let step = 1; step <= n; step++) {
      const idx = (fromIndex + step) % n
      if (!this.state.players[idx].isEliminated) return idx
    }
    throw new Error('No non-eliminated players remain')
  }

  private activeIndicesFrom(startIndex: number): number[] {
    const n = this.state.players.length
    const order: number[] = []
    for (let step = 0; step < n; step++) {
      const idx = (startIndex + step) % n
      if (!this.state.players[idx].isEliminated) order.push(idx)
    }
    return order
  }

  private postBlind(index: number, amount: number, label: 'small blind' | 'big blind'): void {
    const p = this.state.players[index]
    const actual = Math.min(amount, p.stack)
    p.stack -= actual
    p.betThisStreet += actual
    p.totalContributed += actual
    if (p.stack === 0) p.isAllIn = true
    logEvent(this.state, {
      street: 'preflop',
      kind: 'blind',
      playerId: p.id,
      playerName: p.name,
      amount: actual,
      toAmount: p.betThisStreet,
      message: label,
    })
  }

  canStartHand(): boolean {
    return this.nonEliminatedCount() >= 2
  }

  /**
   * Changes the blinds and ante that the *next* `startHand()` will post —
   * this hand's config, if one is in progress, is untouched. This is the
   * entire mechanism rising tournament blinds run on: `startHand()` already
   * reads `state.config` from scratch every time, so a caller that knows
   * what level a tournament is on has nothing else to do.
   */
  setBlinds(config: GameConfig): void {
    this.state.config = config
  }

  /** `deckOverride` is a test/debug hook to force exact cards for a hand. */
  startHand(deckOverride?: Deck): void {
    const state = this.state
    if (!this.canStartHand()) throw new Error('Not enough players with chips to start a hand')

    for (const p of state.players) {
      p.holeCards = []
      p.folded = p.isEliminated
      p.isAllIn = false
      p.betThisStreet = 0
      p.totalContributed = 0
      p.hasActed = false
    }
    state.communityCards = []
    state.pots = []
    state.actionHistory = []
    state.handLog = []
    state.currentBet = 0
    state.minRaise = state.config.bigBlind
    state.street = 'preflop'
    state.handNumber += 1
    state.handInProgress = true
    state.lastResults = []
    state.deck = deckOverride ?? new Deck(this.rng)

    state.dealerIndex = this.nextNonEliminatedIndex(state.dealerIndex)

    if (state.config.ante > 0) {
      for (const p of state.players) {
        if (p.isEliminated) continue
        const amount = Math.min(state.config.ante, p.stack)
        p.stack -= amount
        p.totalContributed += amount
        if (p.stack === 0) p.isAllIn = true
        logEvent(state, {
          street: 'preflop',
          kind: 'ante',
          playerId: p.id,
          playerName: p.name,
          amount,
          message: 'ante',
        })
      }
    }

    const headsUp = this.nonEliminatedCount() === 2
    const sbIndex = headsUp ? state.dealerIndex : this.nextNonEliminatedIndex(state.dealerIndex)
    const bbIndex = this.nextNonEliminatedIndex(sbIndex)

    this.postBlind(sbIndex, state.config.smallBlind, 'small blind')
    this.postBlind(bbIndex, state.config.bigBlind, 'big blind')
    state.smallBlindIndex = sbIndex
    state.bigBlindIndex = bbIndex
    state.currentBet = state.config.bigBlind
    state.minRaise = state.config.bigBlind

    const dealOrder = this.activeIndicesFrom(sbIndex)
    for (let round = 0; round < 2; round++) {
      for (const idx of dealOrder) {
        state.players[idx].holeCards.push(state.deck.draw())
      }
    }

    // A blind can be bigger than a short stack, which puts that player all-in
    // before anyone has had a decision to make. If that leaves fewer than two
    // players able to act, there is no preflop betting round at all: run the
    // board out and go to showdown.
    //
    // Without this the next line handed the action to whoever the blind had
    // just put all-in — a player with no legal actions — and the hand stopped
    // dead there. In the app that is a table frozen forever, waiting for an
    // action that cannot be made. It is reachable in any heads-up pot where
    // the small blind cannot cover the small blind.
    const canAct = state.players.filter((p) => !p.folded && !p.isEliminated && !p.isAllIn)
    if (canAct.length <= 1) {
      this.advanceStreet()
      return
    }

    // Heads-up the small blind acts first preflop; otherwise it is the seat
    // after the big blind. The check above guarantees both can actually act,
    // which is why there is no fallback here — the old `?? bbIndex` fallback
    // was itself a way of seating the action on a player who could not act.
    const firstToAct = headsUp ? sbIndex : nextActingPlayerIndex(state, bbIndex)
    state.currentPlayerIndex = firstToAct as number
  }

  getLegalActions(playerId: string) {
    return getLegalActions(this.state, playerId)
  }

  act(action: PokerAction): void {
    const state = this.state
    if (!state.handInProgress) throw new Error('No hand in progress')
    const currentPlayer = state.players[state.currentPlayerIndex]
    if (currentPlayer.id !== action.playerId) {
      throw new Error(`It is not ${action.playerId}'s turn`)
    }

    applyAction(state, action)

    if (isHandOver(state)) {
      this.finishHandByFold()
      return
    }

    if (isBettingRoundComplete(state)) {
      this.advanceStreet()
    } else {
      const next = nextActingPlayerIndex(state, state.currentPlayerIndex)
      if (next === null) {
        this.advanceStreet()
      } else {
        state.currentPlayerIndex = next
      }
    }
  }

  private advanceStreet(): void {
    const state = this.state

    for (const p of state.players) {
      p.betThisStreet = 0
      if (!p.folded && !p.isAllIn) p.hasActed = false
    }
    state.currentBet = 0
    state.minRaise = state.config.bigBlind

    if (state.street === 'preflop') {
      state.communityCards.push(state.deck.draw(), state.deck.draw(), state.deck.draw())
      state.street = 'flop'
    } else if (state.street === 'flop') {
      state.communityCards.push(state.deck.draw())
      state.street = 'turn'
    } else if (state.street === 'turn') {
      state.communityCards.push(state.deck.draw())
      state.street = 'river'
    } else {
      this.showdown()
      return
    }

    const dealt = state.street === 'flop' ? state.communityCards.slice(0, 3) : state.communityCards.slice(-1)
    logEvent(state, { street: state.street, kind: 'deal', cards: dealt })

    const contenders = state.players.filter((p) => !p.folded)
    const canAct = contenders.filter((p) => !p.isAllIn)
    if (canAct.length <= 1) {
      this.advanceStreet()
      return
    }

    const firstToAct = nextActingPlayerIndex(state, state.dealerIndex)
    state.currentPlayerIndex = firstToAct as number
  }

  private finishHandByFold(): void {
    const state = this.state
    const winner = state.players.find((p) => !p.folded)
    if (!winner) throw new Error('No winner found when hand ended by fold')
    const pot = totalPot(state.players)
    logEvent(state, {
      street: state.street,
      kind: 'result',
      playerId: winner.id,
      playerName: winner.name,
      amount: pot,
      message: `${winner.name} wins $${pot.toLocaleString()} — everyone else folded`,
    })
    winner.stack += pot
    state.lastResults = [{ potAmount: pot, winnerIds: [winner.id] }]
    state.pots = []
    for (const p of state.players) p.betThisStreet = 0
    this.eliminateBustedPlayers()
    state.handInProgress = false
  }

  private showdown(): void {
    const state = this.state
    state.street = 'showdown'
    const pots = computePots(state.players)
    state.pots = pots

    const seatOrder = this.activeIndicesFrom(this.nextNonEliminatedIndex(state.dealerIndex)).map(
      (i) => state.players[i].id,
    )

    // Show every hand that reached showdown before announcing who won with
    // what — the log is the only place to check a bot's play against the
    // cards it actually held, and that check is worthless without this.
    for (const id of seatOrder) {
      const player = state.players.find((p) => p.id === id)
      if (!player || player.folded) continue
      logEvent(state, {
        street: 'showdown',
        kind: 'reveal',
        playerId: player.id,
        playerName: player.name,
        cards: player.holeCards,
      })
    }

    const winnersByPot: { ids: string[]; category?: string }[] = pots.map((pot) => {
      const contenders = pot.eligiblePlayerIds
      if (contenders.length === 1) return { ids: contenders }

      let best: ReturnType<typeof evaluateBestHand> | null = null
      let winners: string[] = []
      for (const id of contenders) {
        const player = state.players.find((p) => p.id === id)
        if (!player) continue
        const value = evaluateBestHand([...player.holeCards, ...state.communityCards])
        if (!best || compareHandValues(value, best) > 0) {
          best = value
          winners = [id]
        } else if (compareHandValues(value, best) === 0) {
          winners.push(id)
        }
      }
      return { ids: winners, category: best?.category }
    })

    const payouts = distributePots(
      pots,
      winnersByPot.map((w) => w.ids),
      seatOrder,
    )
    for (const [id, amount] of payouts) {
      const player = state.players.find((p) => p.id === id)
      if (player) player.stack += amount
    }

    state.lastResults = pots.map((pot, i) => ({
      potAmount: pot.amount,
      winnerIds: winnersByPot[i].ids,
      category: winnersByPot[i].category,
    }))

    state.lastResults.forEach((result, i) => {
      const names = result.winnerIds
        .map((id) => state.players.find((p) => p.id === id)?.name ?? id)
        .join(' & ')
      const potName = pots.length > 1 ? (i === 0 ? 'main pot' : `side pot ${i}`) : 'pot'
      const hand = result.category ? ` with ${result.category.replace(/-/g, ' ')}` : ''
      logEvent(state, {
        street: 'showdown',
        kind: 'result',
        amount: result.potAmount,
        message: `${names} wins the ${potName} — $${result.potAmount.toLocaleString()}${hand}`,
      })
    })

    for (const p of state.players) p.betThisStreet = 0
    this.eliminateBustedPlayers()
    state.handInProgress = false
  }

  /**
   * Marks anyone at zero chips as out, and records the order — the only
   * place a tournament's finishing positions come from. Two players busting
   * in the same hand (a three-way all-in, say) are recorded in seat order,
   * which is an arbitrary but deterministic tiebreak rather than an attempt
   * to rank simultaneous elimination by, say, chips carried into the hand.
   */
  private eliminateBustedPlayers(): void {
    for (const p of this.state.players) {
      if (p.stack === 0 && !p.isEliminated) {
        p.isEliminated = true
        this.state.eliminationOrder.push(p.id)
      }
    }
  }
}
