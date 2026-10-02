import { describe, expect, it } from 'vitest'
import {
  HomeTableError,
  canStartHand,
  chipsInPlay,
  newTable,
  options,
  potTotal,
  reduce,
  type Command,
  type HomeState,
} from '../../src/home/table'
import { createRng } from '../../src/utils/random'
import type { ActionType } from '../../src/poker/game-state'

const CONFIG = { startingStack: 1000, smallBlind: 5, bigBlind: 10, ante: 0 }

function table(names: string[], config = CONFIG): HomeState {
  let state = newTable(config)
  for (const name of names) state = reduce(state, { type: 'join', id: name.toLowerCase(), name })
  return state
}

function run(state: HomeState, ...commands: Command[]): HomeState {
  return commands.reduce(reduce, state)
}

const act = (playerId: string, action: ActionType, amount?: number): Command => ({ type: 'act', playerId, action, amount })

/** Whose turn it is, by id. */
const toAct = (state: HomeState) => state.players[state.currentPlayerIndex]?.id

describe('seating', () => {
  it('seats people in join order with the starting stack', () => {
    const state = table(['Ann', 'Ben', 'Cy'])
    expect(state.players.map((p) => [p.name, p.stack])).toEqual([
      ['Ann', 1000],
      ['Ben', 1000],
      ['Cy', 1000],
    ])
  })

  it('refuses a duplicate name, but a rejoin under the same id just renames', () => {
    const state = table(['Ann'])
    expect(() => reduce(state, { type: 'join', id: 'other', name: 'ann' })).toThrow(HomeTableError)
    const renamed = reduce(state, { type: 'join', id: 'ann', name: 'Annie' })
    expect(renamed.players).toHaveLength(1)
    expect(renamed.players[0].name).toBe('Annie')
  })

  it('moves a seat to match the real table, keeping the button on its player', () => {
    // Ann has the button; Ben and Cy post. Ann and Ben fold.
    let state = run(table(['Ann', 'Ben', 'Cy']), { type: 'startHand' }, act('ann', 'fold'), act('ben', 'fold'))
    expect(state.phase).toBe('hand-over')
    const dealer = state.players[state.dealerIndex].id
    state = reduce(state, { type: 'move', id: 'cy', toIndex: 0 })
    expect(state.players.map((p) => p.id)).toEqual(['cy', 'ann', 'ben'])
    expect(state.players[state.dealerIndex].id).toBe(dealer)
  })

  it('won’t let seats or stacks change mid-hand', () => {
    const state = run(table(['Ann', 'Ben']), { type: 'startHand' })
    expect(() => reduce(state, { type: 'remove', id: 'ann' })).toThrow(HomeTableError)
    expect(() => reduce(state, { type: 'adjustStack', id: 'ann', stack: 5000 })).toThrow(HomeTableError)
  })
})

describe('the deal', () => {
  it('moves the button and posts the blinds, three-handed', () => {
    let state = run(table(['Ann', 'Ben', 'Cy']), { type: 'startHand' })
    expect(state.players[state.dealerIndex].id).toBe('ann')
    expect(state.players.map((p) => p.betThisStreet)).toEqual([0, 5, 10])
    expect(toAct(state)).toBe('ann')
    expect(potTotal(state)).toBe(15)

    state = run(state, act('ann', 'fold'), act('ben', 'fold'))
    state = reduce(state, { type: 'startHand' })
    expect(state.players[state.dealerIndex].id).toBe('ben')
    expect(state.players.map((p) => p.betThisStreet)).toEqual([10, 0, 5])
  })

  it('heads-up, the button posts the small blind and acts first preflop', () => {
    const state = run(table(['Ann', 'Ben']), { type: 'startHand' })
    expect(state.players[state.dealerIndex].id).toBe('ann')
    expect(state.players[0].betThisStreet).toBe(5)
    expect(toAct(state)).toBe('ann')
  })

  it('takes antes from everyone', () => {
    const state = run(table(['Ann', 'Ben', 'Cy'], { ...CONFIG, ante: 2 }), { type: 'startHand' })
    expect(potTotal(state)).toBe(21)
  })
})

describe('betting', () => {
  it('offers only legal actions, and enforces the minimum raise', () => {
    const state = run(table(['Ann', 'Ben', 'Cy']), { type: 'startHand' })
    expect(options(state, 'ann')).toMatchObject({ actions: ['fold', 'call', 'raise', 'all-in'], toCall: 10, minTo: 20, maxTo: 1000 })
    expect(options(state, 'ben')).toBeNull()
    expect(() => reduce(state, act('ann', 'raise', 15))).toThrow(/minimum is 20/)
    expect(() => reduce(state, act('ben', 'call'))).toThrow(/Ann's turn/)
    expect(() => reduce(state, act('ann', 'check'))).toThrow(HomeTableError)
  })

  it('stops for the host when a street closes, then starts the next one left of the button', () => {
    let state = run(table(['Ann', 'Ben', 'Cy']), { type: 'startHand' }, act('ann', 'call'), act('ben', 'call'), act('cy', 'check'))
    expect(state.phase).toBe('street-done')
    expect(toAct(state)).toBeUndefined()
    expect(() => reduce(state, act('ann', 'check'))).toThrow(HomeTableError)

    state = reduce(state, { type: 'advanceStreet' })
    expect(state.street).toBe('flop')
    expect(state.phase).toBe('betting')
    expect(toAct(state)).toBe('ben')
    expect(options(state, 'ben')?.actions).toEqual(['check', 'bet', 'all-in'])
  })

  it('pays the last player standing at once, with no showdown', () => {
    const state = run(table(['Ann', 'Ben', 'Cy']), { type: 'startHand' }, act('ann', 'raise', 40), act('ben', 'fold'), act('cy', 'fold'))
    expect(state.phase).toBe('hand-over')
    expect(state.lastResults).toEqual([{ potAmount: 55, winnerIds: ['ann'] }])
    expect(state.players.map((p) => p.stack)).toEqual([1015, 995, 990])
  })

  it('goes to showdown after the river betting', () => {
    let state = run(table(['Ann', 'Ben']), { type: 'startHand' }, act('ann', 'call'), act('ben', 'check'))
    for (let street = 0; street < 3; street++) {
      state = reduce(state, { type: 'advanceStreet' })
      // After the flop the big blind (Ben) acts first heads-up.
      state = run(state, act('ben', 'check'), act('ann', 'check'))
    }
    expect(state.phase).toBe('showdown')
    expect(state.pots).toEqual([{ amount: 20, eligiblePlayerIds: ['ann', 'ben'] }])
  })
})

/** Everyone all-in preflop, Cy short: a main pot for three and a side pot for two. */
function allInWithSidePot(): HomeState {
  let state = table(['Ann', 'Ben', 'Cy'])
  state = reduce(state, { type: 'adjustStack', id: 'cy', stack: 200 })
  state = run(state, { type: 'startHand' }, act('ann', 'all-in'), act('ben', 'all-in'), act('cy', 'all-in'))
  expect(state.phase).toBe('street-done')
  // Nobody can bet: the host deals the board out.
  state = run(state, { type: 'advanceStreet' }, { type: 'advanceStreet' }, { type: 'advanceStreet' })
  expect(state.street).toBe('river')
  return reduce(state, { type: 'advanceStreet' })
}

describe('the showdown', () => {
  it('builds a side pot for a short all-in, and pays each pot to who the host picks', () => {
    const state = allInWithSidePot()
    expect(state.phase).toBe('showdown')
    expect(state.pots).toEqual([
      { amount: 600, eligiblePlayerIds: ['ann', 'ben', 'cy'] },
      { amount: 1600, eligiblePlayerIds: ['ann', 'ben'] },
    ])
    const paid = reduce(state, { type: 'award', winnersByPot: [['cy'], ['ben']] })
    expect(paid.players.map((p) => p.stack)).toEqual([0, 1600, 600])
    expect(paid.players[0].isEliminated).toBe(true)
    expect(paid.phase).toBe('hand-over')
  })

  it('only lets someone in a pot win it, and every pot needs a winner', () => {
    const state = allInWithSidePot()
    expect(() => reduce(state, { type: 'award', winnersByPot: [['cy'], ['cy']] })).toThrow(/in a pot/)
    expect(() => reduce(state, { type: 'award', winnersByPot: [['cy'], []] })).toThrow(/every pot/)
    expect(() => reduce(state, { type: 'award', winnersByPot: [['cy']] })).toThrow(/every pot/)
  })

  it('splits a pot, odd chip to the first winner left of the button', () => {
    let state = table(['Ann', 'Ben', 'Cy'], { ...CONFIG, smallBlind: 5, bigBlind: 10, ante: 1 })
    state = run(state, { type: 'startHand' }, act('ann', 'call'), act('ben', 'call'), act('cy', 'check'))
    for (let i = 0; i < 3; i++) {
      state = reduce(state, { type: 'advanceStreet' })
      state = run(state, act('ben', 'check'), act('cy', 'check'), act('ann', 'check'))
    }
    // 33 in the pot; Ben and Ann split. Ben sits first after the button (Ann).
    const paid = reduce(state, { type: 'award', winnersByPot: [['ann', 'ben']] })
    expect(paid.lastResults).toEqual([{ potAmount: 33, winnerIds: ['ann', 'ben'] }])
    expect(paid.players.map((p) => p.stack)).toEqual([1005, 1006, 989])
  })

  it('a busted player comes back in with a rebuy', () => {
    let state = reduce(allInWithSidePot(), { type: 'award', winnersByPot: [['cy'], ['ben']] })
    expect(state.players[0].isEliminated).toBe(true)
    state = reduce(state, { type: 'adjustStack', id: 'ann', stack: 1000 })
    expect(state.players[0].isEliminated).toBe(false)
    expect(canStartHand(state)).toBe(true)
  })
})

describe('undo', () => {
  it('takes back the last action, and then the one before', () => {
    const dealt = run(table(['Ann', 'Ben', 'Cy']), { type: 'startHand' })
    const once = reduce(dealt, act('ann', 'call'))
    const twice = reduce(once, act('ben', 'raise', 30))
    const back = reduce(twice, { type: 'undo' })
    expect(toAct(back)).toBe('ben')
    expect(back.players.map((p) => p.stack)).toEqual(once.players.map((p) => p.stack))
    const backAgain = reduce(back, { type: 'undo' })
    expect(toAct(backAgain)).toBe('ann')
  })

  it('takes back a mis-tapped award, and a mis-tapped deal, but never into the last hand', () => {
    const showdown = allInWithSidePot()
    const paid = reduce(showdown, { type: 'award', winnersByPot: [['ann'], ['ann']] })
    const unpaid = reduce(paid, { type: 'undo' })
    expect(unpaid.phase).toBe('showdown')
    expect(unpaid.players.map((p) => p.stack)).toEqual(showdown.players.map((p) => p.stack))

    const next = reduce(reduce(paid, { type: 'adjustStack', id: 'cy', stack: 100 }), { type: 'startHand' })
    const undealt = reduce(next, { type: 'undo' })
    expect(undealt.phase).toBe('hand-over')
    expect(() => reduce(undealt, { type: 'undo' })).toThrow(/Nothing to undo/)
  })
})

describe('a long session', () => {
  it('never creates or loses a chip, whatever anyone does', () => {
    const rng = createRng(2026)
    let state = table(['Ann', 'Ben', 'Cy', 'Dee', 'Eli'])
    let total = chipsInPlay(state)
    const pick = <T,>(items: T[]): T => items[Math.floor(rng() * items.length)]

    for (let step = 0; step < 4000; step++) {
      if (state.phase === 'lobby' || state.phase === 'hand-over') {
        // Busted players rebuy, which is the one way chips are added.
        for (const p of state.players.filter((p) => p.isEliminated)) {
          state = reduce(state, { type: 'adjustStack', id: p.id, stack: 1000 })
          total += 1000
        }
        if (!canStartHand(state)) break
        state = reduce(state, { type: 'startHand' })
      } else if (state.phase === 'street-done') {
        state = reduce(state, { type: 'advanceStreet' })
      } else if (state.phase === 'showdown') {
        state = reduce(state, { type: 'award', winnersByPot: state.pots.map((pot) => pot.eligiblePlayerIds.filter(() => rng() < 0.5).concat(pot.eligiblePlayerIds.slice(0, 1)).filter((id, i, all) => all.indexOf(id) === i)) })
      } else {
        const id = toAct(state)!
        const choices = options(state, id)!
        const action = pick(choices.actions)
        const amount = action === 'bet' || action === 'raise' ? choices.minTo + Math.floor(rng() * (choices.maxTo - choices.minTo + 1)) : undefined
        state = reduce(state, act(id, action, amount))
        if (rng() < 0.05) state = reduce(state, { type: 'undo' })
      }
      expect(chipsInPlay(state)).toBe(total)
    }
    expect(state.handNumber).toBeGreaterThan(20)
  })
})
