import { HomeTableError, reduce, type Command, type HomeState } from './table'

/**
 * A home game room, without the network: what the host does with messages
 * from joiners, and what a joiner sees. `peer.ts` wires this to PeerJS; tests
 * wire it to an in-memory fake.
 *
 * The host's device holds the only real table. A joiner sends a command, the
 * host runs it through the reducer, and everyone (the sender included) gets
 * the new table back. Nothing is applied on a joiner's phone first, so no two
 * phones can disagree about the pot.
 */

export const PROTOCOL = 1

/** The table as every phone sees it: the whole state, less the undo history. */
export interface TableView extends Omit<HomeState, 'undo'> {
  canUndo: boolean
  /** Player ids with a phone connected right now. */
  connected: string[]
}

export type ToHost =
  | { v: typeof PROTOCOL; t: 'hello'; playerId: string; name: string }
  | { v: typeof PROTOCOL; t: 'command'; command: Command; reqId: number }
  | { v: typeof PROTOCOL; t: 'ping' }

export type ToJoiner =
  | { v: typeof PROTOCOL; t: 'state'; view: TableView }
  | { v: typeof PROTOCOL; t: 'welcome'; playerId: string }
  | { v: typeof PROTOCOL; t: 'error'; message: string; reqId?: number }
  | { v: typeof PROTOCOL; t: 'pong' }

export function viewOf(state: HomeState, connected: string[]): TableView {
  const { undo, ...table } = state
  return { ...table, canUndo: undo.length > 0, connected }
}

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

interface Link {
  send: (message: ToJoiner) => void
  playerId?: string
}

function isMessage(raw: unknown): raw is ToHost {
  if (!raw || typeof raw !== 'object') return false
  const m = raw as { v?: unknown; t?: unknown }
  return m.v === PROTOCOL && (m.t === 'hello' || m.t === 'command' || m.t === 'ping')
}

/**
 * The host's side. Joiners may only act for themselves; the host (through
 * `command`) may do anything, including act for a player whose phone died.
 */
export class HostCore {
  private table: HomeState
  private links = new Map<string, Link>()
  private readonly onChange: (state: HomeState) => void

  constructor(state: HomeState, onChange: (state: HomeState) => void = () => {}) {
    this.table = state
    this.onChange = onChange
  }

  get state(): HomeState {
    return this.table
  }

  /** Player ids with at least one live connection. */
  connected(): string[] {
    return [...new Set([...this.links.values()].map((l) => l.playerId).filter((id): id is string => id !== undefined))]
  }

  view(): TableView {
    return viewOf(this.table, this.connected())
  }

  open(linkId: string, send: (message: ToJoiner) => void): void {
    this.links.set(linkId, { send })
  }

  close(linkId: string): void {
    const link = this.links.get(linkId)
    this.links.delete(linkId)
    if (link?.playerId) this.broadcast()
  }

  /** A message from a joiner's phone. Anything malformed is ignored. */
  receive(linkId: string, raw: unknown): void {
    const link = this.links.get(linkId)
    if (!link || !isMessage(raw)) return
    const message = raw
    switch (message.t) {
      case 'ping':
        link.send({ v: PROTOCOL, t: 'pong' })
        return
      case 'hello': {
        if (typeof message.playerId !== 'string' || !/^[\w-]{1,40}$/.test(message.playerId) || typeof message.name !== 'string') return
        try {
          this.apply({ type: 'join', id: message.playerId, name: message.name })
        } catch (error) {
          link.send({ v: PROTOCOL, t: 'error', message: errorText(error) })
          return
        }
        link.playerId = message.playerId
        link.send({ v: PROTOCOL, t: 'welcome', playerId: message.playerId })
        this.broadcast()
        return
      }
      case 'command': {
        const command = message.command
        const allowed = link.playerId !== undefined && command?.type === 'act' && command.playerId === link.playerId
        if (!allowed) {
          link.send({ v: PROTOCOL, t: 'error', message: 'Only the host can do that.', reqId: message.reqId })
          return
        }
        try {
          this.apply(command)
        } catch (error) {
          link.send({ v: PROTOCOL, t: 'error', message: errorText(error), reqId: message.reqId })
          return
        }
        this.broadcast()
        return
      }
    }
  }

  /** The host's own command. Throws `HomeTableError` for the host's screen to show. */
  command(command: Command): void {
    this.apply(command)
    this.broadcast()
  }

  private apply(command: Command): void {
    this.table = reduce(this.table, command)
    this.onChange(this.table)
  }

  private broadcast(): void {
    const message: ToJoiner = { v: PROTOCOL, t: 'state', view: this.view() }
    for (const link of this.links.values()) {
      if (link.playerId) link.send(message)
    }
  }
}

function errorText(error: unknown): string {
  if (error instanceof HomeTableError) return error.message
  return 'Something went wrong.'
}
