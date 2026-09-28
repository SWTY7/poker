import type { GameState } from '../poker/game-state'
import { CAST, randomizeProfile, type PsychProfile } from '../ai/psychology/profile'
import { STRUCTURES, type TournamentStructure } from './tournament'
import { ROSTER, WALK_IN_NAMES, rivalProfile, type Rival, type SeatPlan } from './rivals'
import { shuffle, type Rng } from '../utils/random'
import { readJSON, writeJSON } from '../utils/storage'

/**
 * Career seasons: four tiers, each a season of single-table tournaments
 * against a fixed field of rivals plus a walk-in. Points by finish decide the
 * season; the top two go up a tier, everyone else plays the tier again. The
 * top tier is one final, and winning it is a title.
 *
 * Harder tiers are harder for real: the same rivals, and walk-ins, sit down
 * with more discipline (closer to the solved strategy) and, from the
 * National tier, a level deeper of reasoning about you.
 */

export interface Tier {
  name: string
  buyIn: number
  /** The rivals who make up this tier's field, by id. */
  field: string[]
  /** Added to every seat's discipline, and to its reasoning depth. */
  discipline: number
  level: number
  /** One structure per event, in order. The last is the season's final. */
  events: TournamentStructure['id'][]
}

export const TIERS: readonly Tier[] = [
  {
    name: 'Local',
    buyIn: 50,
    field: ['pia', 'tomas', 'hal', 'wes'],
    discipline: 0,
    level: 0,
    events: ['sit-and-go', 'sit-and-go', 'standard', 'standard', 'deep'],
  },
  {
    name: 'Regional',
    buyIn: 100,
    field: ['lina', 'jax', 'mona', 'eli'],
    discipline: 0.1,
    level: 0,
    events: ['sit-and-go', 'sit-and-go', 'standard', 'standard', 'deep'],
  },
  {
    name: 'National',
    buyIn: 250,
    field: ['rosa', 'gus', 'jax', 'eli'],
    discipline: 0.2,
    level: 1,
    events: ['sit-and-go', 'sit-and-go', 'standard', 'standard', 'deep'],
  },
  {
    name: 'Championship',
    buyIn: 500,
    field: ['nadia', 'otto', 'rosa', 'gus'],
    discipline: 0.3,
    level: 1,
    events: ['deep'],
  },
]

export const CHAMPIONSHIP = TIERS.length - 1

/** Points for 1st through 6th. */
export const POINTS = [10, 6, 4, 3, 2, 1]

/** You, in the standings. */
export const YOU = 'you'

/** Seats at a career table: you, the tier's four rivals, and a walk-in. */
export const FIELD_SIZE = 6

export type SeasonResult = 'promoted' | 'repeat' | 'title' | 'dropped'

export interface SeasonOutcome {
  season: number
  tier: number
  /** Best first: you and the tier's rivals, by points. */
  standings: { id: string; points: number }[]
  place: number
  result: SeasonResult
}

export interface CareerData {
  version: 1
  tier: number
  season: number
  /** The next event to play, 0-based. */
  eventIndex: number
  /** This season's points, for you and the tier's rivals. */
  points: Record<string, number>
  /** Your finish in each event played this season, 1-based. */
  finishes: number[]
  titles: number
  /** The season that just ended, until it's been shown. */
  lastSeason: SeasonOutcome | null
}

export const CAREER_STORAGE_KEY = 'poker.career'

function freshPoints(tier: number): Record<string, number> {
  return Object.fromEntries([YOU, ...TIERS[tier].field].map((id) => [id, 0]))
}

export function newCareer(): CareerData {
  return { version: 1, tier: 0, season: 1, eventIndex: 0, points: freshPoints(0), finishes: [], titles: 0, lastSeason: null }
}

/** Anything unrecognisable starts a new career rather than crashing the lobby. */
export function migrateCareer(raw: unknown): CareerData {
  const fresh = newCareer()
  if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) return fresh
  const r = raw as Partial<CareerData>
  const tier = Number.isInteger(r.tier) && r.tier! >= 0 && r.tier! < TIERS.length ? r.tier! : 0
  const events = TIERS[tier].events.length
  const eventIndex = Number.isInteger(r.eventIndex) && r.eventIndex! >= 0 && r.eventIndex! < events ? r.eventIndex! : 0
  const points = freshPoints(tier)
  for (const id of Object.keys(points)) {
    const value = r.points?.[id]
    if (typeof value === 'number' && Number.isFinite(value)) points[id] = value
  }
  return {
    version: 1,
    tier,
    season: Number.isInteger(r.season) && r.season! >= 1 ? r.season! : 1,
    eventIndex,
    points,
    finishes: Array.isArray(r.finishes) ? r.finishes.filter((f) => Number.isInteger(f)).slice(0, eventIndex) : [],
    titles: Number.isInteger(r.titles) && r.titles! >= 0 ? r.titles! : 0,
    lastSeason: r.lastSeason && typeof r.lastSeason === 'object' ? r.lastSeason : null,
  }
}

export function loadCareer(): CareerData {
  return migrateCareer(readJSON<unknown>(CAREER_STORAGE_KEY, null))
}

export function saveCareer(data: CareerData): void {
  writeJSON(CAREER_STORAGE_KEY, data)
}

export function nextEvent(data: CareerData): { tier: Tier; structure: TournamentStructure; number: number; of: number; isFinal: boolean } {
  const tier = TIERS[data.tier]
  const structure = STRUCTURES[tier.events[data.eventIndex]]
  return {
    tier,
    structure,
    number: data.eventIndex + 1,
    of: tier.events.length,
    isFinal: data.eventIndex === tier.events.length - 1,
  }
}

/** Best first. Ties go to whoever finished better in the final, then to the rival (you don't win a tie on points you didn't earn). */
export function seasonStandings(data: CareerData, lastEvent: (string | null)[] = []): { id: string; points: number }[] {
  const finalRank = (id: string) => {
    const i = lastEvent.indexOf(id)
    return i < 0 ? Number.POSITIVE_INFINITY : i
  }
  return Object.entries(data.points)
    .map(([id, points]) => ({ id, points }))
    .sort((a, b) => {
      if (a.points !== b.points) return b.points - a.points
      const ra = finalRank(a.id)
      const rb = finalRank(b.id)
      if (ra !== rb) return ra < rb ? -1 : 1
      return a.id === YOU ? 1 : b.id === YOU ? -1 : 0
    })
}

// ---------- seating an event ----------

function boosted(profile: PsychProfile, tier: Tier): PsychProfile {
  return {
    ...profile,
    discipline: Math.min(profile.discipline + tier.discipline, 1),
    level: profile.level + tier.level,
  }
}

function rivalById(id: string): Rival {
  const rival = ROSTER.find((r) => r.id === id)
  if (!rival) throw new Error(`No rival ${id}`)
  return rival
}

/** The tier's four rivals plus one walk-in, all at the tier's strength, in a shuffled seat order. */
export function planEvent(data: CareerData, rng: Rng): SeatPlan[] {
  const tier = TIERS[data.tier]
  const seats: SeatPlan[] = tier.field.map((id) => {
    const rival = rivalById(id)
    return { kind: 'rival', rival, profile: boosted(rivalProfile(rival), tier), name: rival.name }
  })
  const archetype = CAST[Math.floor(rng() * CAST.length)]
  const name = WALK_IN_NAMES[Math.floor(rng() * WALK_IN_NAMES.length)]
  seats.push({ kind: 'walk-in', profile: boosted(randomizeProfile(archetype, rng), tier), name })
  shuffle(seats, rng)
  return seats
}

/**
 * Everyone's finishing order, best first, as player ids. Busted players are
 * placed by when they busted. If the event was left early, the players still
 * in are placed by chip count, except that you finish behind all of them:
 * the same place a quit is paid for.
 */
export function finishingOrder(state: GameState, humanId: string, forfeited: boolean): string[] {
  const busted = [...state.eliminationOrder].reverse()
  const alive = state.players
    .filter((p) => !p.isEliminated && !busted.includes(p.id))
    .sort((a, b) => b.stack - a.stack)
    .map((p) => p.id)
  if (forfeited && alive.includes(humanId)) {
    return [...alive.filter((id) => id !== humanId), humanId, ...busted]
  }
  return [...alive, ...busted]
}

// ---------- after an event ----------

/**
 * Books one event: points to you and the tier's rivals by where they
 * finished (`order` is best first, by entrant id; a walk-in is null), and
 * closes the season after its last event.
 */
export function recordEvent(data: CareerData, order: (string | null)[]): CareerData {
  const points = { ...data.points }
  order.forEach((id, i) => {
    if (id !== null && id in points) points[id] += POINTS[i] ?? 0
  })
  const yourFinish = order.indexOf(YOU) + 1 || order.length
  const played: CareerData = {
    ...data,
    points,
    finishes: [...data.finishes, yourFinish],
    eventIndex: data.eventIndex + 1,
    lastSeason: null,
  }
  if (played.eventIndex < TIERS[data.tier].events.length) return played
  return closeSeason(played, order)
}

function closeSeason(data: CareerData, lastEvent: (string | null)[]): CareerData {
  const standings = seasonStandings(data, lastEvent)
  const place = standings.findIndex((s) => s.id === YOU) + 1
  let result: SeasonResult
  let tier = data.tier
  let titles = data.titles
  if (data.tier === CHAMPIONSHIP) {
    // One final. Win it and you defend the title next season; otherwise it's back to National to qualify again.
    if (place === 1) {
      result = 'title'
      titles++
    } else {
      result = 'dropped'
      tier = CHAMPIONSHIP - 1
    }
  } else if (place <= 2) {
    result = 'promoted'
    tier++
  } else {
    result = 'repeat'
  }
  return {
    version: 1,
    tier,
    season: data.season + 1,
    eventIndex: 0,
    points: freshPoints(tier),
    finishes: [],
    titles,
    lastSeason: { season: data.season, tier: data.tier, standings, place, result },
  }
}

/** A name for anyone in the standings. */
export function entrantName(id: string): string {
  return id === YOU ? 'You' : (ROSTER.find((r) => r.id === id)?.name ?? id)
}
