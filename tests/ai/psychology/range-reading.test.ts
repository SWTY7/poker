import { describe, expect, it } from 'vitest'
import { readRanges, splitAgainstBet } from '../../../src/ai/psychology/range-reading'
import { BASELINES, type PostflopRates } from '../../../src/ai/psychology/opponent-model'
import type { AIObservation } from '../../../src/ai/observation'
import type { Card } from '../../../src/poker/card'
import type { PokerAction } from '../../../src/poker/game-state'
import type { PositionLabel } from '../../../src/poker/position'
import { toCardInt } from '../../../src/poker/fast/cards'
import { COMBO_A, COMBO_B, COMBO_COUNT, comboId } from '../../../src/math/combos'
import { emptyRange, fullRange } from '../../../src/math/range'
import { topPercentRange } from '../../../src/math/realization'

const card = (spec: string): Card => ({
  rank: spec.slice(0, -1) as Card['rank'],
  suit: { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }[spec.slice(-1)] as Card['suit'],
})
const int = (spec: string) => toCardInt(card(spec))
const combo = (a: string, b: string) => comboId(int(a), int(b))

function observation(board: string[], history: PokerAction[], villainPosition: PositionLabel | null = null): AIObservation {
  return {
    playerId: 'hero',
    ownCards: [card('2c'), card('2d')],
    communityCards: board.map(card),
    potSize: 100,
    players: [
      { id: 'hero', stack: 1000, betThisStreet: 0, folded: false, isAllIn: false, position: null },
      { id: 'villain', stack: 1000, betThisStreet: 0, folded: false, isAllIn: false, position: villainPosition },
    ],
    legalActions: ['check', 'bet'],
    street: board.length === 0 ? 'preflop' : board.length === 3 ? 'flop' : board.length === 4 ? 'turn' : 'river',
    currentBet: 0,
    toCall: 0,
    minRaiseTo: 10,
    maxRaiseTo: 1000,
    actionHistory: history,
    bigBlind: 10,
  }
}

const normal = BASELINES.headsUp.postflop
const read = (obs: AIObservation, bluffShare = 0.2, rates: PostflopRates = normal) =>
  readRanges(obs, ['villain'], () => bluffShare, () => rates).get('villain')!

describe('reading a range from how the hand was played', () => {
  const river = ['Ah', 'Kd', '7s', '4c', '9h']
  const set = combo('7c', '7d')
  const air = combo('6c', '3d')

  it('reads a bet as strength and a check as weakness', () => {
    const bet = read(observation(river, [{ playerId: 'villain', type: 'bet', amount: 50, street: 'river' }]))
    const check = read(observation(river, [{ playerId: 'villain', type: 'check', street: 'river' }]))
    expect(bet[set] / bet[air]).toBeGreaterThan(3)
    expect(check[set] / check[air]).toBeLessThan(1)
  })

  it('reads the same bet as a wider range from someone who bets far more often', () => {
    // A hand in the middle of the board's strength order: in a frequent
    // bettor's range, not a cautious one's.
    const history: PokerAction[] = [{ playerId: 'villain', type: 'bet', amount: 50, street: 'river' }]
    const middle = combo('Qc', 'Jd')
    const cautious = read(observation(river, history), 0.1, { ...normal, bet: 0.2 })
    const frequent = read(observation(river, history), 0.1, { ...normal, bet: 0.75 })
    expect(frequent[middle] / frequent[set]).toBeGreaterThan(cautious[middle] / cautious[set] * 2)
  })

  it('keeps more air in the betting range of a player believed to bluff more', () => {
    const history: PokerAction[] = [{ playerId: 'villain', type: 'bet', amount: 50, street: 'river' }]
    const honest = read(observation(river, history), 0.05)
    const bluffer = read(observation(river, history), 0.4)
    expect(bluffer[air] / bluffer[set]).toBeGreaterThan(honest[air] / honest[set])
  })

  it('reads a preflop raise by where it came from', () => {
    // A hand from the 30-35% band of the strength order: a button opens it
    // (45%), under the gun doesn't (15%).
    const inBand = topPercentRange(0.35)
    const stronger = topPercentRange(0.3)
    const marginal = Array.from(inBand.keys()).find((id) => inBand[id] > 0 && stronger[id] === 0)!
    const raise: PokerAction[] = [{ playerId: 'villain', type: 'raise', amount: 30, street: 'preflop' }]
    const utg = read(observation([], raise, 'UTG'))
    const button = read(observation([], raise, 'BTN'))
    const aces = combo('Ac', 'Ad')
    expect(button[marginal] / button[aces]).toBeGreaterThan(0.9)
    expect(utg[marginal] / utg[aces]).toBeLessThan(0.1)
  })

  it('reads each action on the board as it was when the action was taken', () => {
    // A6 with one heart: ace-high on the two-heart flop, the nut flush once
    // two more hearts arrive. The same bet means something different about
    // it depending on which street it came on.
    const board = ['Kh', '8h', '3c', '5h', '2h']
    const a6 = combo('Ah', '6c')
    const onFlop = read(observation(board, [{ playerId: 'villain', type: 'bet', amount: 50, street: 'flop' }]))
    const onRiver = read(observation(board, [{ playerId: 'villain', type: 'bet', amount: 50, street: 'river' }]))
    expect(onRiver[a6]).toBeGreaterThan(onFlop[a6])
  })

  it('never rules a live hand out completely, however the hand went', () => {
    const history: PokerAction[] = [
      { playerId: 'villain', type: 'raise', amount: 30, street: 'preflop' },
      { playerId: 'villain', type: 'bet', amount: 40, street: 'flop' },
      { playerId: 'villain', type: 'bet', amount: 90, street: 'turn' },
      { playerId: 'villain', type: 'bet', amount: 200, street: 'river' },
    ]
    const range = read(observation(river, history, 'UTG'), 0)
    const board = new Set(river.map(int))
    for (let id = 0; id < COMBO_COUNT; id++) {
      if (board.has(COMBO_A[id]) || board.has(COMBO_B[id])) expect(range[id]).toBe(0)
      else expect(range[id]).toBeGreaterThan(0)
    }
  })

  it('assumes an unstamped action happened on the street being played', () => {
    const stamped = read(observation(river, [{ playerId: 'villain', type: 'bet', amount: 50, street: 'river' }]))
    const unstamped = read(observation(river, [{ playerId: 'villain', type: 'bet', amount: 50 }]))
    expect(Array.from(unstamped)).toEqual(Array.from(stamped))
  })
})

describe('against a bet: who folds, and what the hero\'s cards block', () => {
  // Three hearts on board. Say the only hands strong enough to continue
  // whatever else they hold are flushes — two hearts in the hand.
  const board = ['Kh', '8h', '3h', '5c', '2d'].map(int)
  const hearts = new Set(['A', 'Q', 'J', 'T', '9', '7', '6', '4'].map((r) => int(`${r}h`)))
  const flushes = emptyRange()
  for (let id = 0; id < COMBO_COUNT; id++) if (hearts.has(COMBO_A[id]) && hearts.has(COMBO_B[id])) flushes[id] = 1

  it('folds out more of the opponent when the hero holds the ace of the flush suit', () => {
    const withBlocker = splitAgainstBet(fullRange(), flushes, 0, board, [int('Ah'), int('4c')])!
    const without = splitAgainstBet(fullRange(), flushes, 0, board, [int('Ac'), int('4c')])!
    expect(withBlocker.folds).toBeGreaterThan(without.folds)
    // And the hands that call can't include the card the hero is holding.
    for (let id = 0; id < COMBO_COUNT; id++) {
      if (COMBO_A[id] === int('Ah') || COMBO_B[id] === int('Ah')) expect(withBlocker.called[id]).toBe(0)
    }
  })

  it('has a capped range still defend itself instead of folding everything', () => {
    // A range with no flushes in it at all — nothing "strong" — still
    // continues with the top `defence` share of itself, the way a player
    // who check-called twice calls the river with their best medium hands.
    const capped = fullRange()
    for (let id = 0; id < COMBO_COUNT; id++) if (flushes[id] > 0) capped[id] = 0
    const split = splitAgainstBet(capped, flushes, 0.4, board, [int('Jc'), int('Jd')])!
    expect(split.folds).toBeGreaterThan(0.5)
    expect(split.folds).toBeLessThan(0.65)
    const noDefence = splitAgainstBet(capped, flushes, 0, board, [int('Jc'), int('Jd')])
    expect(noDefence).toBeNull()
  })

  it('reports nothing to split when the range has nothing left', () => {
    expect(splitAgainstBet(emptyRange(), flushes, 0.4, board, [int('Ac'), int('4c')])).toBeNull()
  })
})
