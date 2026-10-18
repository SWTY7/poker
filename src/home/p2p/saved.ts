import { readJSON, writeJSON } from '../../utils/storage'
import type { NearbyRoomSaved } from './contract'

/**
 * The table a phone is hosting, kept so a reload (or a dead battery and a
 * borrowed charger) doesn't end the game: stacks, seats and the blind clock
 * come back. Connections don't: each guest is given a new invite and rejoins.
 */

const KEY = 'poker.home.nearby'

export function saveNearbyRoom(saved: NearbyRoomSaved): void {
  writeJSON(KEY, saved)
}

/** The saved table, or null if there is none or it isn't one this version can read. */
export function loadNearbyRoom(): NearbyRoomSaved | null {
  const saved = readJSON<Partial<NearbyRoomSaved> | null>(KEY, null)
  if (!saved || saved.v !== 1) return null
  if (typeof saved.roomId !== 'string' || typeof saved.hostToken !== 'string' || typeof saved.savedAt !== 'number') return null
  const { state, keys } = saved
  if (!state || typeof state !== 'object' || !Array.isArray(state.players) || typeof state.config !== 'object' || state.config === null) return null
  if (!keys || typeof keys !== 'object' || Object.values(keys).some((key) => typeof key !== 'string')) return null
  return { v: 1, roomId: saved.roomId, hostToken: saved.hostToken, state, keys, savedAt: saved.savedAt }
}

/** Forget the table: the host ended the game. */
export function clearNearbyRoom(): void {
  writeJSON(KEY, null)
}
