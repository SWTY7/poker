import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AIObservation, ObservedPlayer } from '../../src/ai/observation'
import type { Card } from '../../src/poker/card'
import type { PokerAction } from '../../src/poker/game-state'
import type { PositionLabel } from '../../src/poker/position'
import { MultiwayPreflopBook } from '../../src/gto/holdem/preflop-multiway-bot'
import type { MultiwayStrategyFile } from '../../src/gto/holdem/preflop-multiway'

const load = (name: string) => JSON.parse(readFileSync(`src/gto/holdem/${name}`, 'utf-8')) as MultiwayStrategyFile
const book = new MultiwayPreflopBook([load('preflop-6max-100.json'), load('preflop-3max-20.json')])

const card = (spec: string): Card => ({
  rank: spec.slice(0, -1) as Card['rank'],
  suit: { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }[spec.slice(-1)] as Card['suit'],
})

const SIX: PositionLabel[] = ['UTG', 'MP', 'CO', 'BTN', 'SB', 'BB']
const BB = 10

/**
 * A six-handed preflop spot at 100bb: `history` is what has happened so
 * far, `hero` the seat to act. Stacks and bets follow from the history.
 */
function spot(hero: PositionLabel, cards: [string, string], history: PokerAction[], stack = 1000): AIObservation {
  const bets = new Map<string, number>([
    ['SB', BB / 2],
    ['BB', BB],
  ])
  const folded = new Set<string>()
  let level = BB
  for (const action of history) {
    if (action.type === 'fold') folded.add(action.playerId)
    else if (action.type === 'call') bets.set(action.playerId, level)
    else if (action.amount !== undefined) {
      bets.set(action.playerId, action.amount)
      level = Math.max(level, action.amount)
    }
  }
  const players: ObservedPlayer[] = SIX.map((position) => {
    const bet = bets.get(position) ?? 0
    return { id: position, stack: stack - bet, betThisStreet: bet, folded: folded.has(position), isAllIn: false, position }
  })
  const me = players.find((p) => p.id === hero)!
  const toCall = level - me.betThisStreet
  return {
    playerId: hero,
    ownCards: cards.map(card),
    communityCards: [],
    potSize: players.reduce((sum, p) => sum + p.betThisStreet, 0),
    players,
    legalActions: toCall > 0 ? ['fold', 'call', 'raise', 'all-in'] : ['check', 'raise', 'all-in'],
    street: 'preflop',
    currentBet: level,
    toCall,
    minRaiseTo: level * 2,
    maxRaiseTo: stack,
    actionHistory: history.map((a) => ({ ...a, street: 'preflop' })),
    bigBlind: BB,
  }
}

const fold = (id: string): PokerAction => ({ playerId: id, type: 'fold' })
const raise = (id: string, amount: number): PokerAction => ({ playerId: id, type: 'raise', amount })
const call = (id: string): PokerAction => ({ playerId: id, type: 'call' })

const weightOf = (answer: ReturnType<MultiwayPreflopBook['strategyFor']>, type: string) =>
  (answer ?? []).filter((w) => w.action.type === type).reduce((sum, w) => sum + w.probability, 0)

describe('looking a real spot up in the multiway preflop book', () => {
  it('answers first in, as real actions that add up to one', () => {
    const answer = book.strategyFor(spot('UTG', ['As', 'Ad'], []))
    expect(answer).not.toBeNull()
    expect(answer!.reduce((sum, w) => sum + w.probability, 0)).toBeCloseTo(1, 6)
    // Aces open, at the tree's size: two and a half big blinds.
    const open = answer!.find((w) => w.action.type === 'raise' && w.action.amount === 25)
    expect(weightOf(answer, 'fold')).toBeLessThan(0.05)
    expect(open?.probability ?? 0).toBeGreaterThan(0.5)
  })

  it('folds the bottom of the deck under the gun', () => {
    expect(weightOf(book.strategyFor(spot('UTG', ['7c', '2d'], [])), 'fold')).toBeGreaterThan(0.95)
  })

  it('follows a hand through folds and an open to the seat facing it', () => {
    const history = [fold('UTG'), raise('MP', 25), fold('CO')]
    const answer = book.strategyFor(spot('BTN', ['Ks', 'Kd'], history))
    expect(answer).not.toBeNull()
    // Kings facing an open never fold, and mostly re-raise — to three times
    // the open in position, or all in.
    expect(weightOf(answer, 'fold')).toBeLessThan(0.05)
    const threeBet = answer!.find((w) => w.action.type === 'raise' && w.action.amount === 75)
    expect(threeBet?.probability ?? 0).toBeGreaterThan(0.3)
  })

  it('reads a real raise of a different size as the tree’s raise', () => {
    const history = [fold('UTG'), raise('MP', 30), fold('CO')]
    expect(book.strategyFor(spot('BTN', ['Ks', 'Kd'], history))).not.toBeNull()
  })

  it('has nothing to say about a limp, which the solved game does not allow', () => {
    expect(book.strategyFor(spot('MP', ['As', 'Kd'], [call('UTG')]))).toBeNull()
  })

  it('has nothing to say after the flop, heads-up, or at a depth nothing was trained near', () => {
    const flop = { ...spot('UTG', ['As', 'Ad'], []), street: 'flop' as const }
    expect(book.strategyFor(flop)).toBeNull()

    const headsUp = spot('UTG', ['As', 'Ad'], [])
    headsUp.players = headsUp.players.map((p) => (p.id === 'SB' || p.id === 'BB' ? p : { ...p, position: null }))
    expect(book.strategyFor(headsUp)).toBeNull()

    // 400bb: twice as far from 100 as the band allows.
    expect(book.strategyFor(spot('UTG', ['As', 'Ad'], [], 4000))).toBeNull()
  })

  it('counts what it was asked and what it answered', () => {
    const counted = new MultiwayPreflopBook([load('preflop-6max-100.json')])
    counted.strategyFor(spot('UTG', ['As', 'Ad'], []))
    counted.strategyFor(spot('MP', ['As', 'Kd'], [call('UTG')]))
    expect(counted.asked).toBe(2)
    expect(counted.answered).toBe(1)
  })
})
