import { beforeEach, describe, expect, it } from 'vitest'
import { HoldemEngine } from '../../src/poker/game-engine'
import { buildObservation } from '../../src/ai/observation'
import { HeuristicBot } from '../../src/ai/heuristic-bot'
import { createRng } from '../../src/utils/random'
import {
  HandLogger,
  MAX_HANDS,
  appendHand,
  clearReview,
  exportReview,
  kindOf,
  loadReview,
  mixByKind,
  type HandRecord,
} from '../../src/review/log'
import { styleProfile } from '../../src/review/style'

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string) {
    this.store.set(key, value)
  }
  removeItem(key: string) {
    this.store.delete(key)
  }
}

beforeEach(() => {
  // @ts-expect-error -- test-only global shim
  globalThis.localStorage = new MemoryStorage()
})

/**
 * Plays a real sitting through the engine with a bot in the human's seat
 * (the cheap heuristic one: what's under test is the logging, not the play),
 * logged exactly as the table logs the human: startHand, a decision before
 * every one of their actions, endHand.
 */
function loggedSession(seed: number, hands: number, players = 6): { records: HandRecord[]; engine: HoldemEngine } {
  const setup = Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `P${i}`, stack: 1000 }))
  const engine = new HoldemEngine(setup, { smallBlind: 1, bigBlind: 2, ante: 0 }, createRng(seed))
  const bots = setup.map((_, i) => new HeuristicBot(createRng(seed * 7 + i)))
  const logger = new HandLogger('p0', 'test')
  const records: HandRecord[] = []
  for (let h = 0; h < hands && engine.canStartHand(); h++) {
    engine.startHand()
    logger.startHand(engine.state)
    while (engine.state.handInProgress) {
      const actor = engine.state.players[engine.state.currentPlayerIndex]
      const action = bots[Number(actor.id.slice(1))].decideAction(buildObservation(engine, actor.id))
      logger.decision(engine.state, action, [{ action: { playerId: actor.id, type: 'fold' }, probability: 1 }])
      engine.act(action)
    }
    const record = logger.endHand(engine.state)
    if (record) records.push(record)
  }
  return { records, engine }
}

describe('logging the human’s hands', () => {
  it('records every hand they were dealt, and every decision at the right place in the hand', { timeout: 30_000 }, () => {
    const all: HandRecord[] = []
    for (let seed = 1; seed <= 12; seed++) {
      const { records, engine } = loggedSession(seed, 60)
      all.push(...records)
      // Every chip accounted for: the hands' results add up to the stack.
      const net = records.reduce((sum, h) => sum + h.net, 0)
      expect(1000 + net).toBe(engine.state.players[0].stack)
    }
    expect(all.length).toBeGreaterThan(40)
    expect(all.some((h) => h.showdown)).toBe(true)
    for (const hand of all) {
      expect(hand.cards).toHaveLength(2)
      expect(hand.players).toBeGreaterThanOrEqual(2)
      const mine = hand.actions.flatMap((a, i) => (a.player === 'p0' ? [i] : []))
      expect(hand.decisions.map((d) => d.index)).toEqual(mine)
      for (const d of hand.decisions) {
        expect(hand.actions[d.index].street).toBe(d.street)
        expect(d.pot).toBeGreaterThan(0)
      }
      if (hand.showdown) expect(hand.board).toHaveLength(5)
    }
  })

  it('knows nothing about a hand it wasn’t told started', () => {
    const logger = new HandLogger('p0')
    const engine = new HoldemEngine([{ id: 'p0', name: 'a', stack: 100 }, { id: 'p1', name: 'b', stack: 100 }], { smallBlind: 1, bigBlind: 2, ante: 0 })
    engine.startHand()
    expect(logger.endHand(engine.state)).toBeNull()
  })

  it('feeds the style profile end to end', { timeout: 30_000 }, () => {
    const hands = Array.from({ length: 12 }, (_, i) => loggedSession(i + 20, 60).records).flat()
    const profile = styleProfile(hands)
    expect(profile.hands).toBe(hands.length)
    expect(profile.vpip.rate).toBeGreaterThan(0)
    expect(profile.pfr.count).toBeLessThanOrEqual(profile.vpip.count)
    expect(profile.wsd.of).toBe(profile.wtsd.count)
  })
})

describe('kinds of action', () => {
  it('treats an all in that doesn’t raise as a call', () => {
    expect(kindOf('all-in', 40, 100)).toBe('passive')
    expect(kindOf('all-in', 400, 100)).toBe('aggressive')
    expect(kindOf('check', undefined, 0)).toBe('passive')
  })

  it('sums a solved mix by kind', () => {
    const mix = mixByKind([
      { action: { playerId: 'x', type: 'fold' }, probability: 0.2 },
      { action: { playerId: 'x', type: 'raise', amount: 30 }, probability: 0.5 },
      { action: { playerId: 'x', type: 'all-in', amount: 1000 }, probability: 0.3 },
    ])
    expect(mix).toEqual({ fold: 0.2, passive: 0, aggressive: 0.8 })
    expect(mixByKind([])).toBeUndefined()
  })
})

describe('the stored history', () => {
  const hand = (n: number): HandRecord => ({
    id: `s-${n}`,
    session: 's',
    at: n,
    player: 'p0',
    position: 'BTN',
    players: 2,
    bigBlind: 10,
    startStack: 1000,
    cards: ['As', 'Kd'],
    board: [],
    actions: [],
    decisions: [],
    net: 0,
    showdown: false,
    won: false,
  })

  it('starts empty, keeps what is added, and exports it as JSON', () => {
    expect(loadReview().hands).toEqual([])
    appendHand(hand(1))
    appendHand(hand(2))
    expect(loadReview().hands.map((h) => h.id)).toEqual(['s-1', 's-2'])
    expect(JSON.parse(exportReview()).hands).toHaveLength(2)
    clearReview()
    expect(loadReview().hands).toEqual([])
  })

  it('keeps only the newest hands past the cap', () => {
    localStorage.setItem('poker.review', JSON.stringify({ version: 1, hands: Array.from({ length: MAX_HANDS }, (_, i) => hand(i)) }))
    for (let i = MAX_HANDS; i < MAX_HANDS + 5; i++) appendHand(hand(i))
    const kept = loadReview().hands
    expect(kept).toHaveLength(MAX_HANDS)
    expect(kept[0].id).toBe('s-5')
  })

  it('ignores anything in storage that isn’t a history', () => {
    localStorage.setItem('poker.review', '{"version":9}')
    expect(loadReview().hands).toEqual([])
    localStorage.setItem('poker.review', 'not json')
    expect(loadReview().hands).toEqual([])
  })
})
