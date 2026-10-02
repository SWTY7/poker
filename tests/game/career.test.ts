import { describe, expect, it } from 'vitest'
import {
  CHAMPIONSHIP,
  POINTS,
  TIERS,
  YOU,
  finishingOrder,
  migrateCareer,
  newCareer,
  nextEvent,
  planEvent,
  recordEvent,
  seasonStandings,
  type CareerData,
} from '../../src/game/career'
import { ROSTER, rivalProfile } from '../../src/game/rivals'
import type { GameState } from '../../src/poker/game-state'
import { createRng } from '../../src/utils/random'

/** Plays out a whole season with the same finishing order every event. */
function playSeason(data: CareerData, order: (string | null)[]): CareerData {
  let next = data
  const events = TIERS[data.tier].events.length
  for (let i = 0; i < events; i++) next = recordEvent(next, order)
  return next
}

describe('the tiers', () => {
  it('are made of real rivals, four to a field, with every event a real structure', () => {
    for (const tier of TIERS) {
      expect(tier.field).toHaveLength(4)
      for (const id of tier.field) expect(ROSTER.some((r) => r.id === id)).toBe(true)
    }
    expect(TIERS[CHAMPIONSHIP].events).toEqual(['deep'])
  })

  it('get harder: more discipline and no less depth, tier by tier', () => {
    for (let i = 1; i < TIERS.length; i++) {
      expect(TIERS[i].discipline).toBeGreaterThan(TIERS[i - 1].discipline)
      expect(TIERS[i].level).toBeGreaterThanOrEqual(TIERS[i - 1].level)
    }
  })
})

describe('seating an event', () => {
  it('seats the tier’s four rivals and one walk-in, at the tier’s strength', () => {
    const career: CareerData = { ...newCareer(), tier: 2, points: {} }
    const seats = planEvent(career, createRng(9))
    expect(seats).toHaveLength(5)
    const rivals = seats.filter((s) => s.kind === 'rival')
    expect(rivals.map((s) => (s.kind === 'rival' ? s.rival.id : '')).sort()).toEqual([...TIERS[2].field].sort())
    for (const seat of rivals) {
      if (seat.kind !== 'rival') continue
      const base = rivalProfile(seat.rival)
      expect(seat.profile.discipline).toBeCloseTo(Math.min(base.discipline + TIERS[2].discipline, 1))
      expect(seat.profile.level).toBe(base.level + TIERS[2].level)
    }
  })
})

describe('a season', () => {
  const field = TIERS[0].field

  it('starts at Local, event one, everyone on zero', () => {
    const career = newCareer()
    expect(nextEvent(career)).toMatchObject({ number: 1, of: 5, isFinal: false })
    expect(career.points).toEqual({ [YOU]: 0, pia: 0, tomas: 0, hal: 0, wes: 0 })
  })

  it('pays points by finish, ignoring walk-ins, and records your finish', () => {
    const after = recordEvent(newCareer(), [field[0], null, YOU, field[1], field[2], field[3]])
    expect(after.points[field[0]]).toBe(POINTS[0])
    expect(after.points[YOU]).toBe(POINTS[2])
    expect(after.points[field[3]]).toBe(POINTS[5])
    expect(after.finishes).toEqual([3])
    expect(after.eventIndex).toBe(1)
  })

  it('promotes you after the final when you finish top two', () => {
    const after = playSeason(newCareer(), [field[0], YOU, field[1], field[2], field[3], null])
    expect(after.lastSeason).toMatchObject({ season: 1, tier: 0, place: 2, result: 'promoted' })
    expect(after).toMatchObject({ tier: 1, season: 2, eventIndex: 0, finishes: [] })
    expect(Object.keys(after.points).sort()).toEqual([YOU, ...TIERS[1].field].sort())
    expect(Object.values(after.points).every((p) => p === 0)).toBe(true)
  })

  it('keeps you in the tier otherwise', () => {
    const after = playSeason(newCareer(), [field[0], field[1], YOU, field[2], field[3], null])
    expect(after.lastSeason?.result).toBe('repeat')
    expect(after.tier).toBe(0)
    expect(after.season).toBe(2)
  })

  it('breaks a tie on points by the final, and a tie there goes against you', () => {
    const career: CareerData = { ...newCareer(), points: { [YOU]: 20, pia: 20, tomas: 20, hal: 0, wes: 0 } }
    expect(seasonStandings(career, ['tomas', YOU, 'pia']).map((s) => s.id).slice(0, 3)).toEqual(['tomas', YOU, 'pia'])
    expect(seasonStandings(career).map((s) => s.id).at(2)).toBe(YOU)
  })
})

describe('the Championship', () => {
  const championship: CareerData = { ...newCareer(), tier: CHAMPIONSHIP, points: {} }
  const field = TIERS[CHAMPIONSHIP].field
  const withPoints = migrateCareer(championship)

  it('is one final: win it for a title and defend it next season', () => {
    const after = recordEvent(withPoints, [YOU, ...field, null])
    expect(after.lastSeason?.result).toBe('title')
    expect(after.titles).toBe(1)
    expect(after.tier).toBe(CHAMPIONSHIP)
  })

  it('sends you back to National if someone else wins it', () => {
    const after = recordEvent(withPoints, [field[0], YOU, ...field.slice(1), null])
    expect(after.lastSeason?.result).toBe('dropped')
    expect(after.titles).toBe(0)
    expect(after.tier).toBe(CHAMPIONSHIP - 1)
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
  it('starts a new career from anything unrecognisable', () => {
    expect(migrateCareer(null)).toEqual(newCareer())
    expect(migrateCareer({ version: 2 })).toEqual(newCareer())
  })

  it('clamps an out-of-range tier or event and fills in missing points', () => {
    const career = migrateCareer({ version: 1, tier: 9, eventIndex: 40, season: 3, titles: 2, points: { you: 12 } })
    expect(career.tier).toBe(0)
    expect(career.eventIndex).toBe(0)
    expect(career.season).toBe(3)
    expect(career.titles).toBe(2)
    expect(career.points).toEqual({ [YOU]: 12, pia: 0, tomas: 0, hal: 0, wes: 0 })
  })
})
