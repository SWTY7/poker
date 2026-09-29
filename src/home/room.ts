import type { Card } from '../poker/card'
import { HOST, HomeTableError, canUndo, reduce, viewFor, type Command, type HomeState, type TableSnapshot } from './table'

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
 * Who may do what. Everyone bets from their own phone, and nobody else can
 * touch their seat, the host included:
 *   - anyone connected may take a seat, act for it, and rebuy it when busted.
 *     A seat is claimed with a private seat key that only that phone holds,
 *     so knowing someone's player id (every phone does) isn't enough to take
 *     their seat or see their cards
 *   - whoever holds the room's host token (the phone that created it) runs
 *     the game's flow: deals each hand, and with real cards turns the streets
 *     and picks each pot's winner. Between hands it also keeps the table in
 *     order: seat order, removing someone who left, the blinds
 *   - only whoever took the last step can undo it
 *   - nobody may set a stack: chips move only by playing, or by a rebuy
 * With online cards the deck for every hand is shuffled here, whatever the
 * host's phone sends, so nobody can deal themselves a stacked deck.
 */

export const PROTOCOL = 2

/** The table as one phone sees it. */
export interface TableView extends TableSnapshot {
  /** Player ids with a phone connected right now. */
  connected: string[]
  /** What this phone may take back, if it took the last step: its own move, or (the host) the last deal or payout. */
  canUndo: 'move' | 'dealer' | null
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
    const { undo: _undo, ...table } = this.table
    const mayUndo = playerId !== null && canUndo(this.table, playerId) ? 'move' : isHost && canUndo(this.table, HOST) ? 'dealer' : null
    return { ...viewFor(table, playerId), canUndo: mayUndo, connected: this.connected(), you: { playerId, isHost } }
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
            this.apply({ type: 'join', id: message.playerId, name }, message.playerId)
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
        const by = this.authorise(link, command)
        if (typeof by !== 'string') {
          link.send({ v: PROTOCOL, t: 'error', message: by.refused, reqId: message.reqId })
          return
        }
        try {
          this.apply(command.type === 'startHand' ? { type: 'startHand', deck: this.table.cards === 'online' ? this.shuffle() : undefined } : command, by)
        } catch (error) {
          link.send({ v: PROTOCOL, t: 'error', message: errorText(error), reqId: message.reqId })
          return
        }
        this.broadcast()
        return
      }
    }
  }

  /**
   * Who a command is from, if this phone may send it: its own seat's id, or
   * the host. Otherwise the reason it can't.
   */
  private authorise(link: Link, command: Command): string | { refused: string } {
    const mine = (id: unknown) => link.playerId !== undefined && id === link.playerId
    switch (command.type) {
      case 'act':
        return mine(command.playerId) ? link.playerId! : { refused: 'You can only act for your own seat.' }
      case 'rebuy':
        return mine(command.id) ? link.playerId! : { refused: 'You can only rebuy your own seat.' }
      case 'undo':
        if (link.playerId !== undefined && canUndo(this.table, link.playerId)) return link.playerId
        if (link.isHost && canUndo(this.table, HOST)) return HOST
        return { refused: 'Only whoever made the last move can take it back.' }
      case 'startHand':
      case 'advanceStreet':
      case 'award':
      case 'move':
      case 'remove':
      case 'configure':
        return link.isHost ? HOST : { refused: 'Only the host can do that.' }
      default:
        return { refused: 'Stacks only change by playing, or by a rebuy.' }
    }
  }

  private apply(command: Command, by: string): void {
    this.table = reduce(this.table, command, by)
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
