import type { Card } from '../poker/card'
import { HomeTableError, reduce, viewFor, type Command, type HomeState, type TableSnapshot } from './table'

/**
 * A home game room, without the network: what the room server does with
 * messages from phones, and what each phone is sent back. The Cloudflare
 * Durable Object (`server/src/worker.ts`) wires it to WebSockets; tests wire
 * it to an in-memory fake.
 *
 * The server holds the only real table. A phone sends a command, the room
 * runs it through the reducer, and every phone (the sender included) gets the
 * new table back, each seeing only what its seat may see. Nothing is applied
 * on a phone first, so no two phones can disagree about the pot.
 *
 * Who may do what:
 *   - anyone connected may take a seat, and act for that seat. A seat is
 *     claimed with a private seat key that only that phone holds, so knowing
 *     someone's player id (every phone does) isn't enough to take their seat
 *     or see their cards
 *   - whoever holds the room's host token (the phone that created it) may run
 *     the dealer's commands, and act for anyone whose phone isn't there
 * With online cards the deck for every hand is shuffled here, whatever the
 * host's phone sends, so nobody can deal themselves a stacked deck.
 */

export const PROTOCOL = 2

/** The table as one phone sees it. */
export interface TableView extends TableSnapshot {
  canUndo: boolean
  /** Player ids with a phone connected right now. */
  connected: string[]
  /** This phone's seat (null if it only deals or watches), and whether it's the host. */
  you: { playerId: string | null; isHost: boolean }
}

export interface Hello {
  v: typeof PROTOCOL
  t: 'hello'
  /** This phone's player id, kept across reloads so it gets its seat back. Public: every phone sees it. */
  playerId: string
  /** This phone's private key for that seat. Never sent to any other phone. */
  seatKey: string
  /** To sit down. Leave out to only deal (the host) or watch. */
  name?: string
  hostToken?: string
}

export type ToRoom = Hello | { v: typeof PROTOCOL; t: 'command'; command: Command; reqId: number } | { v: typeof PROTOCOL; t: 'ping' }

export type ToPhone =
  | { v: typeof PROTOCOL; t: 'state'; view: TableView }
  | { v: typeof PROTOCOL; t: 'error'; message: string; reqId?: number }
  | { v: typeof PROTOCOL; t: 'pong' }

/** A 4-digit room number, 1000–9999, so it never starts with a zero someone drops. */
export function roomCode(rng: () => number = Math.random): string {
  return String(1000 + Math.floor(rng() * 9000))
}

export function isRoomCode(code: string): boolean {
  return /^[1-9]\d{3}$/.test(code)
}

/** A player id for this phone, kept so a reload or dropped connection rejoins the same seat. */
export function newPlayerId(rng: () => number = Math.random): string {
  return `p-${Math.floor(rng() * 36 ** 8).toString(36)}`
}

const ID = /^[\w-]{1,40}$/

interface Link {
  send: (message: ToPhone) => void
  playerId?: string
  isHost: boolean
}

function isMessage(raw: unknown): raw is ToRoom {
  if (!raw || typeof raw !== 'object') return false
  const m = raw as { v?: unknown; t?: unknown }
  return m.v === PROTOCOL && (m.t === 'hello' || m.t === 'command' || m.t === 'ping')
}

/** Seat keys by player id: who may sit in which seat. Kept by the server beside the table, never sent to a phone. */
export type SeatKeys = Record<string, string>

export class RoomCore {
  private table: HomeState
  private keys: SeatKeys
  private links = new Map<string, Link>()
  private readonly hostToken: string
  private readonly shuffle: () => Card[]
  private readonly onChange: (state: HomeState, keys: SeatKeys) => void

  /**
   * `shuffle` hands back a freshly shuffled 52-card deck (crypto-random on
   * the server). `onChange` is told every new state (and the seat keys), to save.
   */
  constructor(
    state: HomeState,
    hostToken: string,
    shuffle: () => Card[],
    onChange: (state: HomeState, keys: SeatKeys) => void = () => {},
    keys: SeatKeys = {},
  ) {
    this.table = state
    this.hostToken = hostToken
    this.shuffle = shuffle
    this.onChange = onChange
    this.keys = { ...keys }
  }

  get seatKeys(): SeatKeys {
    return this.keys
  }

  get state(): HomeState {
    return this.table
  }

  /** Player ids with at least one live connection. */
  connected(): string[] {
    return [...new Set([...this.links.values()].map((l) => l.playerId).filter((id): id is string => id !== undefined))]
  }

  /** What one phone sees. */
  viewFor(playerId: string | null, isHost: boolean): TableView {
    const { undo, ...table } = this.table
    return { ...viewFor(table, playerId), canUndo: undo.length > 0, connected: this.connected(), you: { playerId, isHost } }
  }

  open(linkId: string, send: (message: ToPhone) => void): void {
    this.links.set(linkId, { send, isHost: false })
  }

  close(linkId: string): void {
    const link = this.links.get(linkId)
    this.links.delete(linkId)
    if (link?.playerId) this.broadcast()
  }

  /**
   * Reattaches a connection the server already knew, after it slept and woke
   * without its memory (WebSocket hibernation): same seat, same rights.
   */
  reattach(linkId: string, send: (message: ToPhone) => void, identity: { playerId?: string; isHost: boolean }): void {
    this.links.set(linkId, { send, playerId: identity.playerId, isHost: identity.isHost })
  }

  /** Who a connection is, for the server to remember across a sleep. */
  identity(linkId: string): { playerId?: string; isHost: boolean } | undefined {
    const link = this.links.get(linkId)
    return link && { playerId: link.playerId, isHost: link.isHost }
  }

  /** A message from a phone. Anything malformed is ignored. */
  receive(linkId: string, raw: unknown): void {
    const link = this.links.get(linkId)
    if (!link || !isMessage(raw)) return
    const message = raw
    switch (message.t) {
      case 'ping':
        link.send({ v: PROTOCOL, t: 'pong' })
        return
      case 'hello': {
        if (typeof message.playerId !== 'string' || !ID.test(message.playerId)) return
        if (typeof message.seatKey !== 'string' || message.seatKey.length < 16 || message.seatKey.length > 100) return
        if (message.name !== undefined && typeof message.name !== 'string') return
        link.isHost = typeof message.hostToken === 'string' && message.hostToken === this.hostToken
        const seated = this.table.players.some((p) => p.id === message.playerId)
        const known = this.keys[message.playerId]
        if (known !== undefined && known !== message.seatKey) {
          link.send({ v: PROTOCOL, t: 'error', message: 'That seat belongs to another phone.' })
          return
        }
        if (message.name !== undefined || seated) {
          try {
            // Rejoining an existing seat keeps its name unless a new one is given.
            const name = message.name ?? this.table.players.find((p) => p.id === message.playerId)!.name
            if (known === undefined) this.keys[message.playerId] = message.seatKey
            this.apply({ type: 'join', id: message.playerId, name })
          } catch (error) {
            if (known === undefined) delete this.keys[message.playerId]
            link.send({ v: PROTOCOL, t: 'error', message: errorText(error) })
            return
          }
          link.playerId = message.playerId
        }
        this.broadcast()
        return
      }
      case 'command': {
        const command = message.command
        if (!command || typeof command !== 'object') return
        const ownMove = link.playerId !== undefined && command.type === 'act' && command.playerId === link.playerId
        if (!ownMove && !link.isHost) {
          link.send({ v: PROTOCOL, t: 'error', message: 'Only the host can do that.', reqId: message.reqId })
          return
        }
        try {
          this.apply(command.type === 'startHand' ? { type: 'startHand', deck: this.table.cards === 'online' ? this.shuffle() : undefined } : command)
        } catch (error) {
          link.send({ v: PROTOCOL, t: 'error', message: errorText(error), reqId: message.reqId })
          return
        }
        this.broadcast()
        return
      }
    }
  }

  private apply(command: Command): void {
    this.table = reduce(this.table, command)
    // A seat the host removed can be claimed afresh.
    for (const id of Object.keys(this.keys)) if (!this.table.players.some((p) => p.id === id)) delete this.keys[id]
    this.onChange(this.table, this.keys)
  }

  private broadcast(): void {
    for (const link of this.links.values()) {
      if (link.playerId === undefined && !link.isHost) continue
      link.send({ v: PROTOCOL, t: 'state', view: this.viewFor(link.playerId ?? null, link.isHost) })
    }
  }
}

function errorText(error: unknown): string {
  if (error instanceof HomeTableError) return error.message
  return 'Something went wrong.'
}
