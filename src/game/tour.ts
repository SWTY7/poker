import { CAST, randomizeProfile, type PsychProfile } from '../ai/psychology/profile'
import { STRUCTURES, prizesForField, type TournamentStructure } from './tournament'
import { ROSTER, WALK_IN_NAMES, rivalProfile, type Rival, type SeatPlan } from './rivals'
import { shuffle, type Rng } from '../utils/random'
import { readJSON, writeJSON } from '../utils/storage'

/**
 * The World Tour: a ladder of casino cities, each a single six-handed
 * tournament with its own buy-in on the same scale as the cash game. The top
 * three are paid, 50/30/20 of a purse that is deliberately larger than the
 * money bought in (an "overlay", the room's guarantee), so that even a seat
 * finishing by pure chance comes out ahead and 1st is worth at least four
 * buy-ins. See docs/decisions/2026-10-21-world-tour.md.
 *
 * Harder cities are harder for real: the same rivals and the walk-in sit down
 * with more discipline (closer to the solved strategy) and a level deeper of
 * reasoning about you.
 */

/** Seats at a tour table: you, the city's four rivals, and a walk-in. */
export const FIELD_SIZE = 6

/** Paid places, and their shares of the purse in percent. */
export const PAYOUT_SHARES: readonly number[] = [50, 30, 20]

export interface City {
  id: string
  city: string
  /** A made-up room; no real casino brands. */
  room: string
  country: string
  buyIn: number
  /** Purse = buy-in x field x overlay, rounded to the nearest $50. */
  overlay: number
  structure: TournamentStructure['id']
  /** The rivals who sit here, by id (four; the sixth seat is a walk-in). */
  rivals: string[]
  /** Added to every seat's discipline, and to its reasoning depth. */
  discipline: number
  level: number
}

export const CITIES: readonly City[] = [
  { id: 'lisbon', city: 'Lisbon', room: 'Tagus Card Room', country: 'Portugal', buyIn: 100, overlay: 1.6, structure: 'sit-and-go', rivals: ['pia', 'tomas', 'hal', 'wes'], discipline: 0, level: 0 },
  { id: 'prague', city: 'Prague', room: 'Golden Lantern Club', country: 'Czechia', buyIn: 250, overlay: 1.55, structure: 'sit-and-go', rivals: ['lina', 'hal', 'pia', 'eli'], discipline: 0.05, level: 0 },
  { id: 'cape-town', city: 'Cape Town', room: 'Table Mountain Salon', country: 'South Africa', buyIn: 500, overlay: 1.5, structure: 'standard', rivals: ['jax', 'mona', 'eli', 'wes'], discipline: 0.1, level: 0 },
  { id: 'buenos-aires', city: 'Buenos Aires', room: 'Salón Pampa', country: 'Argentina', buyIn: 1_000, overlay: 1.5, structure: 'standard', rivals: ['lina', 'jax', 'mona', 'tomas'], discipline: 0.15, level: 0 },
  { id: 'macau', city: 'Macau', room: 'Jade Pearl Room', country: 'China', buyIn: 2_000, overlay: 1.45, structure: 'standard', rivals: ['rosa', 'gus', 'jax', 'eli'], discipline: 0.2, level: 1 },
  { id: 'monte-carlo', city: 'Monte Carlo', room: 'Salle Mirage', country: 'Monaco', buyIn: 3_500, overlay: 1.4, structure: 'deep', rivals: ['gus', 'mona', 'lina', 'otto'], discipline: 0.25, level: 1 },
  { id: 'singapore', city: 'Singapore', room: 'Merlion Gold Lounge', country: 'Singapore', buyIn: 5_000, overlay: 1.4, structure: 'deep', rivals: ['rosa', 'gus', 'otto', 'jax'], discipline: 0.3, level: 1 },
  { id: 'las-vegas', city: 'Las Vegas', room: 'Desert Crown Casino', country: 'United States', buyIn: 7_500, overlay: 1.35, structure: 'deep', rivals: ['nadia', 'rosa', 'gus', 'mona'], discipline: 0.35, level: 2 },
  { id: 'sydney', city: 'Sydney', room: 'Harbour Lights Room', country: 'Australia', buyIn: 10_000, overlay: 1.35, structure: 'deep', rivals: ['nadia', 'otto', 'rosa', 'gus'], discipline: 0.4, level: 2 },
]

export function cityById(id: string): City | undefined {
  return CITIES.find((c) => c.id === id)
}

/** Total money paid out at this city. */
export function purseFor(city: City): number {
  return Math.round((city.buyIn * FIELD_SIZE * city.overlay) / 50) * 50
}

/** Prize for 1st, 2nd and 3rd; sums exactly to the purse. */
export function prizesFor(city: City): number[] {
  return prizesForField(purseFor(city), FIELD_SIZE)
}

/** Prize for a 1-based finish; zero outside the top three. */
export function prizeFor(city: City, place: number): number {
  return prizesFor(city)[place - 1] ?? 0
}

/** Expected profit per dollar bought in for a seat finishing each place with chance 1/field. */
export function roiAtChance(city: City): number {
  const prizes = prizesFor(city)
  const expected = prizes.reduce((sum, p) => sum + p, 0) / FIELD_SIZE
  return (expected - city.buyIn) / city.buyIn
}

// ---------- saved progress ----------

export interface CityRecord {
  /** Times you sat down here. */
  plays: number
  /** Best finish, 1-based, or null if never played. */
  best: number | null
  wins: number
  top3: number
}

export interface TourResult {
  cityId: string
  place: number
  prize: number
  buyIn: number
}

export interface TourData {
  version: 1
  cities: Record<string, CityRecord>
  /** Prize money won on the tour, gross. */
  winnings: number
  /** Prize money minus buy-ins, over every tour table. */
  net: number
  last: TourResult | null
}

export const TOUR_STORAGE_KEY = 'poker.tour'
export const LEGACY_CAREER_KEY = 'poker.career'

function emptyRecord(): CityRecord {
  return { plays: 0, best: null, wins: 0, top3: 0 }
}

export function newTour(): TourData {
  return { version: 1, cities: {}, winnings: 0, net: 0, last: null }
}

const nonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0

/** Anything unrecognisable starts a new tour rather than crashing the lobby. Unknown cities are dropped. */
export function migrateTour(raw: unknown): TourData {
  const fresh = newTour()
  if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) return fresh
  const r = raw as Partial<TourData>
  const cities: Record<string, CityRecord> = {}
  for (const city of CITIES) {
    const c = r.cities?.[city.id] as Partial<CityRecord> | undefined
    if (!c || typeof c !== 'object') continue
    const best = Number.isInteger(c.best) && c.best! >= 1 && c.best! <= FIELD_SIZE ? c.best! : null
    const plays = nonNegInt(c.plays) ? c.plays : 0
    cities[city.id] = {
      plays: Math.max(plays, best === null ? 0 : 1),
      best,
      wins: nonNegInt(c.wins) ? c.wins : 0,
      top3: nonNegInt(c.top3) ? c.top3 : 0,
    }
  }
  const last = r.last
  const validLast =
    last &&
    typeof last === 'object' &&
    typeof last.cityId === 'string' &&
    cityById(last.cityId) &&
    Number.isInteger(last.place) &&
    last.place >= 1 &&
    last.place <= FIELD_SIZE &&
    nonNegInt(last.prize) &&
    nonNegInt(last.buyIn)
  return {
    version: 1,
    cities,
    winnings: typeof r.winnings === 'number' && Number.isFinite(r.winnings) && r.winnings >= 0 ? r.winnings : 0,
    net: typeof r.net === 'number' && Number.isFinite(r.net) ? r.net : 0,
    last: validLast ? { cityId: last.cityId, place: last.place, prize: last.prize, buyIn: last.buyIn } : null,
  }
}

/** The old season system is gone; its save is deleted, not converted. */
export function dropLegacyCareer(): void {
  try {
    localStorage.removeItem(LEGACY_CAREER_KEY)
  } catch {
    // ignore
  }
}

export function loadTour(): TourData {
  dropLegacyCareer()
  return migrateTour(readJSON<unknown>(TOUR_STORAGE_KEY, null))
}

export function saveTour(data: TourData): void {
  writeJSON(TOUR_STORAGE_KEY, data)
}

export function recordOf(data: TourData, cityId: string): CityRecord {
  return data.cities[cityId] ?? emptyRecord()
}

/** Books one finished tour table. `place` is 1-based. The prize is the city's, by place. */
export function recordTourResult(data: TourData, cityId: string, place: number): TourData {
  const city = cityById(cityId)
  if (!city) throw new Error(`No city ${cityId}`)
  const p = Math.min(Math.max(Math.round(place), 1), FIELD_SIZE)
  const prize = prizeFor(city, p)
  const old = recordOf(data, cityId)
  return {
    ...data,
    cities: {
      ...data.cities,
      [cityId]: {
        plays: old.plays + 1,
        best: old.best === null ? p : Math.min(old.best, p),
        wins: old.wins + (p === 1 ? 1 : 0),
        top3: old.top3 + (p <= PAYOUT_SHARES.length ? 1 : 0),
      },
    },
    winnings: data.winnings + prize,
    net: data.net + prize - city.buyIn,
    last: { cityId, place: p, prize, buyIn: city.buyIn },
  }
}

// ---------- unlocking ----------

export interface CityStatus {
  city: City
  index: number
  /** Progress rule met: the first city, or a top-3 in the previous one. */
  unlocked: boolean
  /** Bankroll covers the buy-in. */
  affordable: boolean
  /** Both. */
  playable: boolean
  reason: string
}

const money = (n: number) => `$${n.toLocaleString('en-US')}`

/**
 * Where every city stands. A city opens when you have finished top 3 in the
 * one before it (once earned, it stays open); you can sit down when it is open
 * and the bankroll covers its buy-in. Simple on purpose: money alone would let
 * a lucky cash run skip the ladder, a top 3 alone would let you sit down broke.
 */
export function tourStatus(data: TourData, bankroll: number): CityStatus[] {
  return CITIES.map((city, index) => {
    const prev = index > 0 ? CITIES[index - 1] : null
    const unlocked = prev === null || recordOf(data, prev.id).top3 > 0
    const affordable = bankroll >= city.buyIn
    let reason: string
    if (!unlocked) reason = `Finish in the top 3 in ${prev!.city} to unlock`
    else if (!affordable) reason = `Needs a ${money(city.buyIn)} bankroll (${money(city.buyIn - bankroll)} short)`
    else reason = 'Ready'
    return { city, index, unlocked, affordable, playable: unlocked && affordable, reason }
  })
}

// ---------- seating ----------

function boosted(profile: PsychProfile, city: City): PsychProfile {
  return {
    ...profile,
    discipline: Math.min(profile.discipline + city.discipline, 1),
    level: profile.level + city.level,
  }
}

function rivalById(id: string): Rival {
  const rival = ROSTER.find((r) => r.id === id)
  if (!rival) throw new Error(`No rival ${id}`)
  return rival
}

/** The city's four rivals plus one walk-in, all at the city's strength, in a shuffled seat order. */
export function planEvent(cityId: string, rng: Rng): SeatPlan[] {
  const city = cityById(cityId)
  if (!city) throw new Error(`No city ${cityId}`)
  const seats: SeatPlan[] = city.rivals.map((id) => {
    const rival = rivalById(id)
    return { kind: 'rival', rival, profile: boosted(rivalProfile(rival), city), name: rival.name }
  })
  const archetype = CAST[Math.floor(rng() * CAST.length)]
  const name = WALK_IN_NAMES[Math.floor(rng() * WALK_IN_NAMES.length)]
  seats.push({ kind: 'walk-in', profile: boosted(randomizeProfile(archetype, rng), city), name })
  shuffle(seats, rng)
  return seats
}

/** The tournament structure at a city. */
export function structureFor(city: City): TournamentStructure {
  return STRUCTURES[city.structure]
}
