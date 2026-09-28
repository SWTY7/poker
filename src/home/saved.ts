import { readJSON, writeJSON } from '../utils/storage'
import { isRoomCode, newPlayerId } from './room'
import type { HomeState } from './table'

/**
 * What a phone remembers between visits, so a reload (or a dead battery and a
 * borrowed charger) puts everyone back where they were.
 */

const HOST_KEY = 'poker.home.host'
const ME_KEY = 'poker.home.me'

/** The host's live room: its number and the whole table. */
export interface SavedHost {
  code: string
  state: HomeState
  /** The host's own seat, if the host plays too. */
  hostPlayerId: string | null
}

export function loadHost(): SavedHost | null {
  const saved = readJSON<Partial<SavedHost> | null>(HOST_KEY, null)
  if (!saved || typeof saved.code !== 'string' || !isRoomCode(saved.code)) return null
  if (!saved.state || saved.state.version !== 1 || !Array.isArray(saved.state.players)) return null
  return { code: saved.code, state: saved.state, hostPlayerId: typeof saved.hostPlayerId === 'string' ? saved.hostPlayerId : null }
}

export function saveHost(saved: SavedHost | null): void {
  writeJSON(HOST_KEY, saved)
}

/** This phone as a player: one id for good, and the last name and room used. */
export interface Me {
  playerId: string
  name: string
  code: string
}

export function loadMe(): Me {
  const saved = readJSON<Partial<Me> | null>(ME_KEY, null)
  const me: Me = {
    playerId: typeof saved?.playerId === 'string' ? saved.playerId : newPlayerId(),
    name: typeof saved?.name === 'string' ? saved.name : '',
    code: typeof saved?.code === 'string' ? saved.code : '',
  }
  if (saved?.playerId !== me.playerId) saveMe(me)
  return me
}

export function saveMe(me: Me): void {
  writeJSON(ME_KEY, me)
}
