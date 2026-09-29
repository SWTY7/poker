import { describe, expect, it } from 'vitest'
import type { Card, Rank, Suit } from '../../src/poker/card'
import { RANKS, SUITS, cardsEqual } from '../../src/poker/card'
import type { ActionType } from '../../src/poker/game-state'
import {
  HomeTableError,
  canStartHand,
  chipsInPlay,
  newTable,
  options,
  reduce,
  shuffledDeck,
  viewFor,
  type Command,
  type HomeState,
} from '../../src/home/table'
import { createRng } from '../../src/utils/random'

const CONFIG = { startingStack: 1000, smallBlind: 5, bigBlind: 10, ante: 0 }
const SUIT: Record<string, Suit> = { c: 'clubs', d: 'diamonds', h: 'hearts', s: 'spades' }

/** "As" → the ace of spades. */
const card = (text: string): Card => ({ rank: text[0] as Rank, suit: SUIT[text[1]] })

/**
 * A deck that deals exactly `order` first (cards come off the end), then
 * everything else. Three-handed with Ann on the button, hole cards go
 * Ben, Cy, Ann, Ben, Cy, Ann, then flop, turn, river.
 */
function stacked(...order: string[]): Card[] {
  const first = order.map(card)
  const rest = SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit }))).filter((c) => !first.some((f) => cardsEqual(f, c)))
  return [...rest, ...first.reverse()]
}

function table(names: string[]): HomeState {
  let state = newTable(CONFIG, 'online')
  for (const name of names) state = reduce(state, { type: 'join', id: name.toLowerCase(), name })
  return state
}

const act = (playerId: string, action: ActionType, amount?: number): Command => ({ type: 'act', playerId, action, amount })
const run = (state: HomeState, ...commands: Command[]) => commands.reduce(reduce, state)
const toAct = (state: HomeState) => state.players[state.currentPlayerIndex]?.id
const show = (cards: Card[]) => cards.map((c) => c.rank + c.suit[0]).join(' ')

describe('dealing', () => {
  it('won’t deal without a whole, honest deck', () => {
    const state = table(['Ann', 'Ben'])
    expect(() => reduce(state, { type: 'startHand' })).toThrow(HomeTableError)
    const short = shuffledDeck(createRng(1)).slice(1)
    expect(() => reduce(state, { type: 'startHand', deck: short })).toThrow(HomeTableError)
    const doubled = shuffledDeck(createRng(1))
    doubled[0] = doubled[1]
    expect(() => reduce(state, { type: 'startHand', deck: doubled })).toThrow(HomeTableError)
  })

  it('deals two cards each, one at a time from the left of the button', () => {
    const state = reduce(table(['Ann', 'Ben', 'Cy']), { type: 'startHand', deck: stacked('2c', '3c', '4c', '5c', '6c', '7c') })
    expect(state.players.map((p) => show(p.holeCards))).toEqual(['4c 7c', '2c 5c', '3c 6c'])
    expect(state.deck).toHaveLength(46)
    expect(state.board).toEqual([])
  })
})

describe('what each phone sees', () => {
  it('shows you your own cards and nobody else’s, and never the deck', () => {
    const state = reduce(table(['Ann', 'Ben', 'Cy']), { type: 'startHand', deck: shuffledDeck(createRng(2)) })
    const ben = viewFor(state, 'ben')
    expect(ben.deck).toEqual([])
    expect(ben.players.find((p) => p.id === 'ben')?.holeCards).toHaveLength(2)
    expect(ben.players.filter((p) => p.id !== 'ben').every((p) => p.holeCards.length === 0)).toBe(true)
    const dealerOnly = viewFor(state, null)
    expect(dealerOnly.players.every((p) => p.holeCards.length === 0)).toBe(true)
  })
})

describe('the app deals the streets', () => {
  it('turns the flop by itself when the preflop betting closes', () => {
    let state = reduce(table(['Ann', 'Ben', 'Cy']), { type: 'startHand', deck: stacked('2c', '3c', '4c', '5c', '6c', '7c', 'Ah', 'Kh', 'Qh', 'Jh', 'Th') })
    state = run(state, act('ann', 'call'), act('ben', 'call'), act('cy', 'check'))
    expect(state.street).toBe('flop')
    expect(state.phase).toBe('betting')
    expect(show(state.board)).toBe('Ah Kh Qh')
    expect(toAct(state)).toBe('ben')
  })

  it('leaves no dealing or judging to the host', () => {
    const state = reduce(table(['Ann', 'Ben']), { type: 'startHand', deck: shuffledDeck(createRng(3)) })
    expect(() => reduce(state, { type: 'advanceStreet' })).toThrow(/app deals/)
    expect(() => reduce(state, { type: 'award', winnersByPot: [['ann']] })).toThrow(/app settles/)
  })
})

describe('the showdown', () => {
  it('pays the best hand, shows the hands still in, and keeps a folded hand hidden', () => {
    // Ben: A♠A♦, Cy: K♠K♦, Ann: 7♣2♦ (folds). Board 9♣ 8♦ 4♥ 3♠ J♣: aces win.
    let state = reduce(table(['Ann', 'Ben', 'Cy']), { type: 'startHand', deck: stacked('As', 'Ks', '7c', 'Ad', 'Kd', '2d', '9c', '8d', '4h', '3s', 'Jc') })
    state = run(state, act('ann', 'fold'), act('ben', 'call'), act('cy', 'check'))
    for (let street = 0; street < 3; street++) state = run(state, act('ben', 'check'), act('cy', 'check'))
    expect(state.phase).toBe('hand-over')
    expect(state.lastResults).toEqual([{ potAmount: 20, winnerIds: ['ben'], category: 'pair' }])
    expect(state.revealed.sort()).toEqual(['ben', 'cy'])
    expect(viewFor(state, 'cy').players.find((p) => p.id === 'ann')?.holeCards).toEqual([])
    expect(viewFor(state, 'cy').players.find((p) => p.id === 'ben')?.holeCards).toHaveLength(2)
  })

  it('splits a tie and builds side pots for a short all-in, all by itself', () => {
    // Cy is short (200). Ann: 2♣2♦, Ben: A♠K♠, Cy: A♥K♥. Board Q♣ J♦ T♠ 5♥ 3♦: Ben and Cy make the
    // same straight and split the main pot; only Ben can win the side pot he and Ann built.
    let state = table(['Ann', 'Ben', 'Cy'])
    state = reduce(state, { type: 'adjustStack', id: 'cy', stack: 200 })
    state = reduce(state, { type: 'startHand', deck: stacked('As', 'Ah', '2c', 'Ks', 'Kh', '2d', 'Qc', 'Jd', 'Ts', '5h', '3d') })
    state = run(state, act('ann', 'all-in'), act('ben', 'all-in'), act('cy', 'all-in'))
    // Nobody could bet after that: the board ran out by itself.
    expect(state.phase).toBe('hand-over')
    expect(state.board).toHaveLength(5)
    expect(state.lastResults.map((r) => [r.potAmount, [...r.winnerIds].sort()])).toEqual([
      [600, ['ben', 'cy']],
      [1600, ['ben']],
    ])
    expect(state.players.map((p) => p.stack)).toEqual([0, 1900, 300])
  })
})

describe('undo with online cards', () => {
  it('takes back an action within a betting round, but never back past a dealt card', () => {
    let state = reduce(table(['Ann', 'Ben', 'Cy']), { type: 'startHand', deck: shuffledDeck(createRng(5)) })
    expect(state.undo).toEqual([])
    state = reduce(state, act('ann', 'call'))
    const back = reduce(state, { type: 'undo' })
    expect(toAct(back)).toBe('ann')
    state = run(state, act('ben', 'call'), act('cy', 'check'))
    expect(state.street).toBe('flop')
    expect(() => reduce(state, { type: 'undo' })).toThrow(/Nothing to undo/)
  })
})

describe('a long online session', () => {
  it('never creates or loses a chip, and no phone ever sees a card it shouldn’t', () => {
    const rng = createRng(77)
    let state = table(['Ann', 'Ben', 'Cy', 'Dee', 'Eli'])
    let total = chipsInPlay(state)
    const pick = <T,>(items: T[]): T => items[Math.floor(rng() * items.length)]

    for (let step = 0; step < 3000; step++) {
      if (state.phase === 'lobby' || state.phase === 'hand-over') {
        for (const p of state.players.filter((p) => p.isEliminated)) {
          state = reduce(state, { type: 'adjustStack', id: p.id, stack: 1000 })
          total += 1000
        }
        if (!canStartHand(state)) break
        state = reduce(state, { type: 'startHand', deck: shuffledDeck(rng) })
      } else {
        expect(state.phase).toBe('betting')
        const id = toAct(state)!
        const choices = options(state, id)!
        const action = pick(choices.actions)
        const amount = action === 'bet' || action === 'raise' ? choices.minTo + Math.floor(rng() * (choices.maxTo - choices.minTo + 1)) : undefined
        state = reduce(state, act(id, action, amount))
      }
      expect(chipsInPlay(state)).toBe(total)
      // Every card is in exactly one place, and a phone sees only its own and what's been shown.
      const everywhere = [...state.deck, ...state.board, ...state.players.flatMap((p) => p.holeCards)]
      if (state.handNumber > 0) expect(everywhere).toHaveLength(52)
      for (const viewer of state.players) {
        const view = viewFor(state, viewer.id)
        expect(view.deck).toEqual([])
        for (const p of view.players) {
          if (p.id !== viewer.id && !state.revealed.includes(p.id)) expect(p.holeCards).toEqual([])
        }
      }
    }
    expect(state.handNumber).toBeGreaterThan(20)
  })
})
