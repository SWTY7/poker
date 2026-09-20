import { readJSON, writeJSON } from '../utils/storage'

/**
 * The one thing that survives closing the tab: how much money the player
 * has, and the record of how they got there.
 *
 * Everything else — the table you're sitting at, the cards in your hand — is
 * disposable. This is not, which is why it lives in its own module with its
 * own storage key, and why it is written as a chain of pure functions rather
 * than mutated in place the way `GameState` is. A hand of poker can afford to
 * be wrong for a frame; a bankroll cannot silently lose a write because two
 * updates raced.
 */

export const STORAGE_KEY = 'poker.profile'

/** What a fresh player starts with. */
export const STARTING_BANKROLL = 1_000

/** The free top-up granted once a day when the bankroll can't cover a table. */
export const DAILY_STAKE_AMOUNT = 200

/**
 * The floor a bankroll has to fall to (or below) before the daily stake is
 * offered. This is the smallest cash buy-in and the smallest tournament
 * buy-in the app offers — below it, there is nothing left to actually play,
 * which is the condition the stake exists to fix. It is not tied to zero:
 * $12 is not broke, but it is also not a seat at any table in the game.
 */
export const DAILY_STAKE_THRESHOLD = 20

export interface ProfileHistoryEntry {
  /** ISO timestamp, for sorting and for display. */
  at: string
  mode: 'cash' | 'tournament'
  buyIn: number
  /** Net chips: positive means the buy-in came back with more. */
  result: number
  /** Tournament-only: finishing position, the size of the field, and the prize. */
  finish?: number
  field?: number
  prize?: number
}

export interface ProfileLifetime {
  handsPlayed: number
  gamesPlayed: number
  biggestPot: number
  /** Best (lowest) tournament finish ever recorded, or null if none played. */
  bestFinish: number | null
}

export interface Profile {
  /**
   * Bumped whenever the saved shape changes. `migrateProfile` below is where
   * a version bump gets a upgrade step — see the comment there before adding
   * a field to this interface.
   */
  version: 1
  bankroll: number
  lifetime: ProfileLifetime
  /** Most recent last. Not pruned — see the comment on `MAX_HISTORY`. */
  history: ProfileHistoryEntry[]
  dailyStake: {
    /** Local calendar date (YYYY-MM-DD) the stake was last claimed, or null. */
    lastClaimedDate: string | null
  }
}

/** Kept so `localStorage` doesn't grow without bound over a long-lived profile. */
const MAX_HISTORY = 200

export function defaultProfile(): Profile {
  return {
    version: 1,
    bankroll: STARTING_BANKROLL,
    lifetime: { handsPlayed: 0, gamesPlayed: 0, biggestPot: 0, bestFinish: null },
    history: [],
    dailyStake: { lastClaimedDate: null },
  }
}

/**
 * Brings whatever was in storage up to the current shape.
 *
 * There is only one version today, so this is mostly a defensive read: a
 * missing field, a corrupted value, or storage from before any of this
 * existed all come back as a fresh profile rather than a half-populated one
 * that throws three renders later. When version 2 exists, the pattern is a
 * step per version rather than a rewrite of this function:
 *
 *   let profile = raw as PartialUnknown
 *   if (profile.version === undefined) profile = { ...defaultProfileV1(), ...profile, version: 1 }
 *   if (profile.version === 1) profile = upgradeV1ToV2(profile)
 *   return profile as ProfileV2
 *
 * each step assumes only the shape below it, so the chain stays correct no
 * matter how old the saved profile is.
 */
export function migrateProfile(raw: unknown): Profile {
  if (!isRecord(raw) || raw.version !== 1) return defaultProfile()

  const fallback = defaultProfile()
  const lifetime = isRecord(raw.lifetime) ? raw.lifetime : {}
  const dailyStake = isRecord(raw.dailyStake) ? raw.dailyStake : {}

  return {
    version: 1,
    bankroll: typeof raw.bankroll === 'number' && Number.isFinite(raw.bankroll) ? raw.bankroll : fallback.bankroll,
    lifetime: {
      handsPlayed: numberOr(lifetime.handsPlayed, fallback.lifetime.handsPlayed),
      gamesPlayed: numberOr(lifetime.gamesPlayed, fallback.lifetime.gamesPlayed),
      biggestPot: numberOr(lifetime.biggestPot, fallback.lifetime.biggestPot),
      bestFinish:
        typeof lifetime.bestFinish === 'number' && Number.isFinite(lifetime.bestFinish) ? lifetime.bestFinish : null,
    },
    history: Array.isArray(raw.history) ? raw.history.filter(isHistoryEntry).slice(-MAX_HISTORY) : [],
    dailyStake: {
      lastClaimedDate: typeof dailyStake.lastClaimedDate === 'string' ? dailyStake.lastClaimedDate : null,
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function isHistoryEntry(value: unknown): value is ProfileHistoryEntry {
  return isRecord(value) && typeof value.at === 'string' && typeof value.buyIn === 'number'
}

export function loadProfile(): Profile {
  return migrateProfile(readJSON<unknown>(STORAGE_KEY, null))
}

export function saveProfile(profile: Profile): void {
  writeJSON(STORAGE_KEY, profile)
}

// --- buy-in / cash-out ------------------------------------------------------

/**
 * Takes the bankroll figure directly rather than a whole `Profile` — every
 * caller so far only has the number (a lobby screen deciding which buy-in
 * tiers to grey out has no reason to hold a full profile), and a function
 * that only reads one field should only ask for that field.
 */
export function canAffordBuyIn(bankroll: number, amount: number): boolean {
  return amount > 0 && amount <= bankroll
}

/** Deducts a buy-in. Callers check `canAffordBuyIn` first; this does not re-check. */
export function applyBuyIn(profile: Profile, amount: number): Profile {
  return { ...profile, bankroll: profile.bankroll - amount }
}

function pushHistory(profile: Profile, entry: ProfileHistoryEntry): ProfileHistoryEntry[] {
  return [...profile.history, entry].slice(-MAX_HISTORY)
}

export interface CashSessionResult {
  buyIn: number
  finalStack: number
  handsPlayed: number
  biggestPot: number
}

/**
 * Settles a cash session: the buy-in already left the bankroll when the
 * table was joined, so this adds back whatever the player is leaving with.
 */
export function recordCashSession(profile: Profile, result: CashSessionResult): Profile {
  const net = result.finalStack - result.buyIn
  return {
    ...profile,
    bankroll: profile.bankroll + result.finalStack,
    lifetime: {
      ...profile.lifetime,
      handsPlayed: profile.lifetime.handsPlayed + result.handsPlayed,
      gamesPlayed: profile.lifetime.gamesPlayed + 1,
      biggestPot: Math.max(profile.lifetime.biggestPot, result.biggestPot),
    },
    history: pushHistory(profile, {
      at: new Date().toISOString(),
      mode: 'cash',
      buyIn: result.buyIn,
      result: net,
    }),
  }
}

export interface TournamentResultInput {
  buyIn: number
  finish: number
  field: number
  prize: number
  handsPlayed: number
  biggestPot: number
}

/** Settles a finished tournament: the buy-in already left the bankroll at entry; this adds the prize. */
export function recordTournamentResult(profile: Profile, result: TournamentResultInput): Profile {
  return {
    ...profile,
    bankroll: profile.bankroll + result.prize,
    lifetime: {
      ...profile.lifetime,
      handsPlayed: profile.lifetime.handsPlayed + result.handsPlayed,
      gamesPlayed: profile.lifetime.gamesPlayed + 1,
      biggestPot: Math.max(profile.lifetime.biggestPot, result.biggestPot),
      bestFinish: profile.lifetime.bestFinish === null ? result.finish : Math.min(profile.lifetime.bestFinish, result.finish),
    },
    history: pushHistory(profile, {
      at: new Date().toISOString(),
      mode: 'tournament',
      buyIn: result.buyIn,
      result: result.prize - result.buyIn,
      finish: result.finish,
      field: result.field,
      prize: result.prize,
    }),
  }
}

// --- the daily stake ---------------------------------------------------------

/** Local calendar date as YYYY-MM-DD — a day boundary a player actually experiences, not a UTC one. */
function localDateKey(now: Date): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function canClaimDailyStake(profile: Profile, now: Date = new Date()): boolean {
  if (profile.bankroll > DAILY_STAKE_THRESHOLD) return false
  return profile.dailyStake.lastClaimedDate !== localDateKey(now)
}

export function claimDailyStake(profile: Profile, now: Date = new Date()): Profile {
  return {
    ...profile,
    bankroll: profile.bankroll + DAILY_STAKE_AMOUNT,
    dailyStake: { lastClaimedDate: localDateKey(now) },
  }
}
