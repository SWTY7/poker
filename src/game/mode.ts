import { readEnum, writeString } from '../utils/storage'
import type { Profile } from './profile'
import { recordCashSession } from './profile'

/**
 * The two ways into the app. Quick Play is a practice table: pick a game and
 * play it, nothing is bought in and nothing is recorded. Career is the lobby
 * with a bankroll, cash games and tournaments, where every session counts.
 */
export type GameMode = 'quick' | 'career'

export const GAME_MODES: readonly GameMode[] = ['quick', 'career']

export const MODE_STORAGE_KEY = 'poker.mode'

/** Career is the default, so a returning player sees the lobby they already know. */
export function loadMode(): GameMode {
  return readEnum(MODE_STORAGE_KEY, GAME_MODES, 'career')
}

export function saveMode(mode: GameMode): void {
  writeString(MODE_STORAGE_KEY, mode)
}

export interface TableExit {
  finalStack: number
  handsPlayed: number
  biggestPot: number
}

/**
 * What leaving a non-tournament table does to the profile. A cash game settles
 * against the buy-in that was taken on the way in; a Quick Play table never
 * took one, so it hands the profile back untouched.
 */
export function profileAfterTableExit(
  profile: Profile,
  entry: { mode: 'cash' | 'quick'; buyIn: number },
  exit: TableExit,
): Profile {
  if (entry.mode === 'quick') return profile
  return recordCashSession(profile, { buyIn: entry.buyIn, ...exit })
}
