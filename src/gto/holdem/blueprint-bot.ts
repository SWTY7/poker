import type { Agent } from '../../ai/agent'
import type { AIObservation } from '../../ai/observation'
import { HeuristicBot } from '../../ai/heuristic-bot'
import { classOf } from '../../math/combos'
import type { PokerAction, Street } from '../../poker/game-state'
import { toCardInts, type CardInt } from '../../poker/fast/cards'
import { createRng, type Rng } from '../../utils/random'
import type { Strategy } from '../game'
import { bucketOf } from './buckets'
import { decodeBlueprint, type BlueprintFile } from './blueprint'
import type { HoldemOptions } from './abstract-holdem'

/**
 * Plays the solved strategy at a real table.
 *
 * The blueprint is a strategy for a game that is not quite this one: hands
 * are grouped into buckets, bets come in three sizes, and it was solved at
 * one stack depth. Getting from here to there is the translation problem, and
 * it is where most of the strength of a solver is lost in practice.
 *
 * What this does about it:
 *
 *   Heads-up only. The solve has no theorem behind it with three players at
 *   the table, so with anyone else still in the hand it hands over to the
 *   fallback bot rather than pretending.
 *
 *   A stack depth near the one it was trained at. A twenty big blind strategy
 *   played a hundred deep is not a weaker strategy, it is a different game's
 *   strategy, and it would shove with hands that should be opening small.
 *   Outside the band, the fallback plays.
 *
 *   The betting so far is replayed into the abstraction — each real bet
 *   mapped to whichever of half pot, pot or all-in it is closest to — which
 *   is how a spot at the table becomes a key the blueprint knows.
 *
 * Every one of those is a place the real game leaks out of the abstraction,
 * and the tests measure the one that can be measured: how often the lookup
 * finds anything at all.
 */

const STREET_INDEX: Record<Street, number> = { preflop: 0, flop: 1, turn: 2, river: 3, showdown: 3 }

export interface BlueprintBotOptions {
  /** Plays every spot the blueprint cannot: not heads-up, wrong depth, key not found. */
  fallback?: Agent
  rng?: Rng
  /** How far from the trained depth the blueprint is still trusted, as a ratio. */
  depthBand?: [number, number]
}

export class BlueprintBot implements Agent {
  private strategy: Strategy
  private options: HoldemOptions
  private fallback: Agent
  private rng: Rng
  private band: [number, number]

  /** Spots asked of it, and spots the blueprint actually had an answer for. */
  asked = 0
  answered = 0

  constructor(file: BlueprintFile, options: BlueprintBotOptions = {}) {
    this.strategy = decodeBlueprint(file)
    this.options = file.options
    this.rng = options.rng ?? createRng()
    this.fallback = options.fallback ?? new HeuristicBot(this.rng)
    this.band = options.depthBand ?? [0.5, 2]
  }

  decideAction(obs: AIObservation): PokerAction {
    this.asked++
    const action = this.lookUp(obs)
    if (action) {
      this.answered++
      return action
    }
    return this.fallback.decideAction(obs)
  }

  private lookUp(obs: AIObservation): PokerAction | null {
    const live = obs.players.filter((p) => !p.folded)
    if (live.length !== 2) return null

    const me = obs.players.find((p) => p.id === obs.playerId)
    if (!me || obs.ownCards.length !== 2) return null

    const bb = obs.bigBlind
    if (!(bb > 0)) return null
    // Everyone's stack plus what is already in the middle, in big blinds.
    const effective = (Math.min(...live.map((p) => p.stack)) + obs.potSize / live.length) / bb
    const ratio = effective / this.options.stack
    if (ratio < this.band[0] || ratio > this.band[1]) return null

    const replayed = this.replay(obs)
    if (!replayed) return null

    const hole = toCardInts(obs.ownCards) as [CardInt, CardInt]
    const board = toCardInts(obs.communityCards)
    const street = STREET_INDEX[obs.street]
    const bucket = street === 0 ? classOf(hole[0], hole[1]) : bucketOf(hole, board, this.options.buckets)
    const key = `${street}|${bucket}|${[...replayed.past, replayed.betting].join('/')}`

    const probabilities = this.strategy.get(key)
    if (!probabilities) return null
    return this.realise(obs, this.pick(probabilities, replayed.actions))
  }

  /**
   * Walks the hand so far back through the abstraction.
   *
   * The engine reports a bet as a number of chips; the blueprint knows it as
   * "pot" or "half pot". So each action is re-derived in the abstract game's
   * own terms, which also rebuilds where the street boundaries fell — the
   * action history has no marks for them.
   */
  private replay(obs: AIObservation): Replay | null {
    const bb = obs.bigBlind
    const stack = this.options.stack
    // Heads-up, whoever acts first before the flop is the small blind.
    const sbId = obs.actionHistory[0]?.playerId ?? obs.playerId
    const seatOf = (id: string) => (id === sbId ? 0 : 1)

    let contributions = [0.5, 1]
    let streetStart = [...contributions]
    let street = 0
    let betting = ''
    const past: string[] = []

    for (const action of obs.actionHistory) {
      const seat = seatOf(action.playerId)
      let letter: string

      if (action.type === 'fold') letter = 'f'
      else if (action.type === 'check') letter = 'k'
      else if (action.type === 'call') {
        letter = 'c'
        contributions[seat] = contributions[1 - seat]
      } else {
        const to = streetStart[seat] + (action.amount ?? 0) / bb
        letter = classifySize(contributions, seat, to, stack)
        contributions[seat] = Math.min(to, stack)
      }

      betting += letter
      if (!closed(betting, contributions)) continue
      past.push(summarise(betting, street))
      street++
      betting = ''
      streetStart = [...contributions]
    }

    // If the replay and the engine disagree about which street this is, the
    // translation has drifted and the key would be a guess. Better to hand
    // the spot to the fallback than to answer confidently from the wrong row.
    if (street !== STREET_INDEX[obs.street]) return null

    const seat = seatOf(obs.playerId)
    return { past, betting, contributions, seat, actions: legalLetters(betting, contributions, seat, stack) }
  }

  private pick(probabilities: number[], actions: string[]): string {
    let roll = this.rng()
    for (let i = 0; i < actions.length && i < probabilities.length; i++) {
      roll -= probabilities[i]
      if (roll <= 0) return actions[i]
    }
    return actions[actions.length - 1]
  }

  /** Turns an abstract letter back into chips at this table. */
  private realise(obs: AIObservation, letter: string): PokerAction | null {
    const id = obs.playerId
    if (letter === 'f') return obs.legalActions.includes('fold') ? { playerId: id, type: 'fold' } : null
    if (letter === 'k') return obs.legalActions.includes('check') ? { playerId: id, type: 'check' } : null
    if (letter === 'c') return obs.legalActions.includes('call') ? { playerId: id, type: 'call' } : null

    const type = obs.legalActions.includes('bet') ? 'bet' : obs.legalActions.includes('raise') ? 'raise' : null
    if (!type) return obs.legalActions.includes('call') ? { playerId: id, type: 'call' } : null

    if (letter === 'a') return { playerId: id, type, amount: obs.maxRaiseTo }

    const fraction = letter === 'h' ? 0.5 : 1
    const after = obs.potSize + obs.toCall
    const target = Math.round(obs.currentBet + fraction * after)
    return { playerId: id, type, amount: clamp(target, obs.minRaiseTo, obs.maxRaiseTo) }
  }
}

interface Replay {
  past: string[]
  betting: string
  contributions: number[]
  seat: number
  actions: string[]
}

// --- the abstraction's own rules, as the bot has to re-apply them ------------

function closed(betting: string, contributions: number[]): boolean {
  if (betting.includes('f')) return true
  if (betting.length < 2) return false
  const last = betting[betting.length - 1]
  if (last === 'c' || last === 'k') return true
  return Math.abs(contributions[0] - contributions[1]) < 1e-9
}

function summarise(betting: string, street: number): string {
  const aggressive = (a: string) => a === 'h' || a === 'p' || a === 'a'
  const first = [...betting].findIndex(aggressive)
  if (first < 0) return 'x'
  const raises = [...betting].filter(aggressive).length
  return `${raises}${((street === 0 ? 0 : 1) + first) % 2}`
}

function legalLetters(betting: string, contributions: number[], seat: number, stack: number): string[] {
  const owed = contributions[1 - seat] - contributions[seat]
  const raises = [...betting].filter((a) => a === 'h' || a === 'p' || a === 'a').length
  const actions = owed > 1e-9 ? ['f', 'c'] : ['k']
  if (raises < 3 && contributions[seat] < stack - 1e-9) actions.push('h', 'p', 'a')
  return actions
}

/** Whichever of the three sizes this bet was closest to, in pot terms. */
function classifySize(contributions: number[], seat: number, to: number, stack: number): string {
  if (to >= stack - 1e-9) return 'a'
  const pot = contributions[0] + contributions[1]
  const owed = contributions[1 - seat] - contributions[seat]
  const after = pot + owed
  const half = contributions[seat] + owed + 0.5 * after
  const full = contributions[seat] + owed + after
  return Math.abs(to - half) <= Math.abs(to - full) ? 'h' : 'p'
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high)
}
