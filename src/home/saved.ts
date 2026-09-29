import { readJSON, writeJSON } from '../utils/storage'
import { isRoomCode, newPlayerId } from './room'

/**
 * What a phone remembers between visits, so a reload (or a dead battery and a
 * borrowed charger) puts everyone back where they were. The table itself
 * lives on the room server; a phone only keeps who it is.
 */

const HOST_KEY = 'poker.home.host'
const ME_KEY = 'poker.home.me'

/** The room this phone created, the token that makes it the host there, and the seat it took. */
export interface SavedHost {
  code: string
  hostToken: string
  playerId: string
  seatKey: string
}

export function loadHost(): SavedHost | null {
  const saved = readJSON<Partial<SavedHost> | null>(HOST_KEY, null)
  if (!saved || typeof saved.code !== 'string' || !isRoomCode(saved.code) || typeof saved.hostToken !== 'string') return null
  if (typeof saved.playerId !== 'string' || typeof saved.seatKey !== 'string') return null
  return { code: saved.code, hostToken: saved.hostToken, playerId: saved.playerId, seatKey: saved.seatKey }
}

export function saveHost(saved: SavedHost | null): void {
  writeJSON(HOST_KEY, saved)
}

/** This phone as a player: one id for good (public), its private seat key, and the last name and room used. */
export interface Me {
  playerId: string
  seatKey: string
  name: string
  code: string
}

function newSeatKey(): string {
  return crypto.randomUUID()
}

export function loadMe(): Me {
  const saved = readJSON<Partial<Me> | null>(ME_KEY, null)
  const me: Me = {
    playerId: typeof saved?.playerId === 'string' ? saved.playerId : newPlayerId(),
    seatKey: typeof saved?.seatKey === 'string' && saved.seatKey.length >= 16 ? saved.seatKey : newSeatKey(),
    name: typeof saved?.name === 'string' ? saved.name : '',
    code: typeof saved?.code === 'string' ? saved.code : '',
  }
  if (saved?.playerId !== me.playerId || saved?.seatKey !== me.seatKey) saveMe(me)
  return me
}

export function saveMe(me: Me): void {
  writeJSON(ME_KEY, me)
}
