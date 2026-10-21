import { describe, expect, it } from 'vitest'
import {
  CITIES,
  FIELD_SIZE,
  LEGACY_CAREER_KEY,
  TOUR_STORAGE_KEY,
  finishingOrder,
  loadTour,
  migrateTour,
  newTour,
  planEvent,
  prizeFor,
  prizesFor,
  purseFor,
  recordTourResult,
  roiAtChance,
  saveTour,
  tourStatus,
  type TourData,
} from '../../src/game/tour'
import { ROSTER, rivalProfile } from '../../src/game/rivals'
import { STRUCTURES } from '../../src/game/tournament'
import type { GameState } from '../../src/poker/game-state'
import { createRng } from '../../src/utils/random'

describe('the cities', () => {
  it('are 8 to 10, with unique ids and real rivals, four to a city', () => {
    expect(CITIES.length).toBeGreaterThanOrEqual(8)
    expect(CITIES.length).toBeLessThanOrEqual(10)
    expect(new Set(CITIES.map((c) => c.id)).size).toBe(CITIES.length)
    for (const c of CITIES) {
      expect(c.rivals).toHaveLength(FIELD_SIZE - 2)
      expect(new Set(c.rivals).size).toBe(c.rivals.length)
      for (const id of c.rivals) expect(ROSTER.some((r) => r.id === id)).toBe(true)
      expect(STRUCTURES[c.structure]).toBeDefined()
    }
  })

  it('climb the cash ladder: $100 first, $5,000 or more at the top, buy-ins rising', () => {
    expect(CITIES[0].buyIn).toBe(100)
    expect(CITIES[CITIES.length - 1].buyIn).toBeGreaterThanOrEqual(5_000)
    for (let i = 1; i < CITIES.length; i++) {
      expect(CITIES[i].buyIn).toBeGreaterThan(CITIES[i - 1].buyIn)
      expect(CITIES[i].discipline).toBeGreaterThan(CITIES[i - 1].discipline)
      expect(CITIES[i].level).toBeGreaterThanOrEqual(CITIES[i - 1].level)
    }
  })
})

describe('prizes', () => {
  it('pay the top three only and sum exactly to the purse', () => {
    for (const c of CITIES) {
      const prizes = prizesFor(c)
      expect(prizes).toHaveLength(3)
      expect(prizes.reduce((a, b) => a + b, 0)).toBe(purseFor(c))
      expect(prizes[0]).toBeGreaterThanOrEqual(prizes[1])
      expect(prizes[1]).toBeGreaterThanOrEqual(prizes[2])
      expect(prizeFor(c, 4)).toBe(0)
      expect(prizeFor(c, 6)).toBe(0)
    }
  })

  it('pay 1st at least 4x the buy-in, and a seat finishing by chance comes out ahead', () => {
    for (const c of CITIES) {
      expect(prizeFor(c, 1)).toBeGreaterThanOrEqual(4 * c.buyIn)
      expect(roiAtChance(c)).toBeGreaterThan(0.3)
      expect(roiAtChance(c)).toBeLessThan(0.7)
      // 3rd place alone is at least a buy-in back.
      expect(prizeFor(c, 3)).toBeGreaterThanOrEqual(c.buyIn)
    }
  })

  it('ROI at chance per city (documented in the decision record)', () => {
    const roi = Object.fromEntries(CITIES.map((c) => [c.id, Math.round(roiAtChance(c) * 1000) / 10]))
    expect(roi).toEqual({
      lisbon: 58.3,
      prague: 56.7,
      'cape-town': 50,
      'buenos-aires': 50,
      macau: 45,
      'monte-carlo': 40,
      singapore: 40,
      'las-vegas': 35,
      sydney: 35,
    })
  })

  it('beat a break-even cash session over a tournament-length of hands (arithmetic, not a sim)', () => {
    // A strong cash player wins ~10 big blinds per 100 hands; a $1,000 stack at $5/$10 is 100 bb.
    // Over ~100 hands that is +10 bb = +10% of the buy-in. Even the lowest tour ROI at chance is far above that.
    const strongCashRoi = 0.1
    for (const c of CITIES) expect(roiAtChance(c)).toBeGreaterThan(strongCashRoi)
  })
})

describe('unlocking', () => {
  it('opens only the first city on a fresh tour, with a reason for the rest', () => {
    const status = tourStatus(newTour(), 1_000)
    expect(status[0]).toMatchObject({ unlocked: true, affordable: true, playable: true, reason: 'Ready' })
    expect(status[1].unlocked).toBe(false)
    expect(status[1].reason).toContain('top 3')
    expect(status[1].reason).toContain(CITIES[0].city)
  })

  it('needs a top-3 in the previous city AND the bankroll', () => {
    const data = recordTourResult(newTour(), 'lisbon', 3)
    const rich = tourStatus(data, 1_000)
    expect(rich[1]).toMatchObject({ unlocked: true, affordable: true, playable: true })
    const poor = tourStatus(data, 100)
    expect(poor[1]).toMatchObject({ unlocked: true, affordable: false, playable: false })
    expect(poor[1].reason).toContain('$150 short')
    expect(rich[2].unlocked).toBe(false)
  })

  it('does not unlock on a 4th place, and stays unlocked after a bankroll dip', () => {
    expect(tourStatus(recordTourResult(newTour(), 'lisbon', 4), 9e9)[1].unlocked).toBe(false)
    const data = recordTourResult(newTour(), 'lisbon', 1)
    expect(tourStatus(data, 0)[1].unlocked).toBe(true)
  })
})

describe('recording a result', () => {
  it('books best finish, wins, top-3 count, winnings, net and the last result', () => {
    const lisbon = CITIES[0]
    let data = recordTourResult(newTour(), 'lisbon', 5)
    expect(data.cities.lisbon).toEqual({ plays: 1, best: 5, wins: 0, top3: 0 })
    expect(data.winnings).toBe(0)
    expect(data.net).toBe(-lisbon.buyIn)
    data = recordTourResult(data, 'lisbon', 1)
    data = recordTourResult(data, 'lisbon', 2)
    expect(data.cities.lisbon).toEqual({ plays: 3, best: 1, wins: 1, top3: 2 })
    expect(data.winnings).toBe(prizeFor(lisbon, 1) + prizeFor(lisbon, 2))
    expect(data.net).toBe(data.winnings - 3 * lisbon.buyIn)
    expect(data.last).toEqual({ cityId: 'lisbon', place: 2, prize: prizeFor(lisbon, 2), buyIn: lisbon.buyIn })
  })

  it('is pure and rejects an unknown city', () => {
    const before = newTour()
    recordTourResult(before, 'prague', 1)
    expect(before).toEqual(newTour())
    expect(() => recordTourResult(before, 'atlantis', 1)).toThrow()
  })
})

describe('seating', () => {
  it('seats the city’s four rivals and one walk-in at the city’s strength', () => {
    const city = CITIES[4]
    const seats = planEvent(city.id, createRng(9))
    expect(seats).toHaveLength(FIELD_SIZE - 1)
    const rivals = seats.filter((s) => s.kind === 'rival')
    expect(rivals.map((s) => (s.kind === 'rival' ? s.rival.id : '')).sort()).toEqual([...city.rivals].sort())
    expect(seats.filter((s) => s.kind === 'walk-in')).toHaveLength(1)
    for (const seat of rivals) {
      if (seat.kind !== 'rival') continue
      const base = rivalProfile(seat.rival)
      expect(seat.profile.discipline).toBeCloseTo(Math.min(base.discipline + city.discipline, 1))
      expect(seat.profile.level).toBe(base.level + city.level)
    }
  })

  it('throws for an unknown city', () => {
    expect(() => planEvent('atlantis', createRng(1))).toThrow()
  })
})

describe('finishing order', () => {
  const state = (players: { id: string; stack: number; out?: boolean }[], eliminationOrder: string[]) =>
    ({
      players: players.map((p) => ({ id: p.id, stack: p.stack, isEliminated: Boolean(p.out) })),
      eliminationOrder,
    }) as unknown as GameState

  it('puts the survivor first and the busted in reverse order of busting', () => {
    const s = state(
      [
        { id: 'p0', stack: 9000 },
        { id: 'p1', stack: 0, out: true },
        { id: 'p2', stack: 0, out: true },
      ],
      ['p2', 'p1'],
    )
    expect(finishingOrder(s, 'p0', false)).toEqual(['p0', 'p1', 'p2'])
  })

  it('on a quit, places the others still in by chips, and you behind them', () => {
    const s = state(
      [
        { id: 'p0', stack: 5000 },
        { id: 'p1', stack: 1000 },
        { id: 'p2', stack: 3000 },
        { id: 'p3', stack: 0, out: true },
      ],
      ['p3'],
    )
    expect(finishingOrder(s, 'p0', true)).toEqual(['p2', 'p1', 'p0', 'p3'])
  })
})

describe('saved data', () => {
  it('starts a new tour from anything unrecognisable', () => {
    expect(migrateTour(null)).toEqual(newTour())
    expect(migrateTour({ version: 2 })).toEqual(newTour())
    expect(migrateTour('x')).toEqual(newTour())
  })

  it('round-trips valid data', () => {
    const data = recordTourResult(recordTourResult(newTour(), 'lisbon', 1), 'prague', 6)
    expect(migrateTour(JSON.parse(JSON.stringify(data)))).toEqual(data)
  })

  it('drops unknown cities and clamps bad numbers', () => {
    const raw = {
      version: 1,
      cities: {
        lisbon: { plays: -3, best: 9, wins: 'x', top3: 2.5 },
        atlantis: { plays: 1, best: 1, wins: 1, top3: 1 },
        prague: { plays: 2, best: 2, wins: 0, top3: 1 },
      },
      winnings: -5,
      net: Number.NaN,
      last: { cityId: 'atlantis', place: 1, prize: 1, buyIn: 1 },
    }
    const data: TourData = migrateTour(raw)
    expect(Object.keys(data.cities).sort()).toEqual(['lisbon', 'prague'])
    expect(data.cities.lisbon).toEqual({ plays: 0, best: null, wins: 0, top3: 0 })
    expect(data.cities.prague).toEqual({ plays: 2, best: 2, wins: 0, top3: 1 })
    expect(data.winnings).toBe(0)
    expect(data.net).toBe(0)
    expect(data.last).toBeNull()
  })

  it('drops the old poker.career key on load and reads poker.tour', () => {
    const store = new Map<string, string>()
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    }
    const g = globalThis as unknown as { localStorage?: unknown }
    const prior = g.localStorage
    g.localStorage = fake
    try {
      store.set(LEGACY_CAREER_KEY, JSON.stringify({ version: 1, tier: 2 }))
      saveTour(recordTourResult(newTour(), 'lisbon', 2))
      expect(store.has(TOUR_STORAGE_KEY)).toBe(true)
      const loaded = loadTour()
      expect(store.has(LEGACY_CAREER_KEY)).toBe(false)
      expect(loaded.cities.lisbon.best).toBe(2)
    } finally {
      g.localStorage = prior
    }
  })
})
