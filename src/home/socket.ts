import { PROTOCOL, type Hello, type TableView, type ToPhone, type ToRoom } from './room'
import type { CardMode, Command, HomeConfig } from './table'

/**
 * A phone's line to the room server (`server/src/worker.ts`): an ordinary
 * WebSocket over HTTPS, so it works on any network that can load a web page,
 * a phone's hotspot included. It rejoins by itself when the line drops.
 */

/** The room server's address. Set VITE_ROOM_SERVER for a deployed build; locally it's `npm run server:dev`. */
export function roomServer(): string {
  return (import.meta.env.VITE_ROOM_SERVER as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:8787'
}

export type RoomStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

const PING_MS = 10000
/** No word from the server for this long: the line is dead even if the browser hasn't noticed. */
const SILENCE_MS = 30000
const MAX_BACKOFF_MS = 10000

/** Makes a room on the server. Throws an Error whose message can be shown as-is. */
export async function createRoom(config: HomeConfig, cards: CardMode): Promise<{ code: string; hostToken: string }> {
  let response: Response
  try {
    response = await fetch(`${roomServer()}/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config, cards }),
    })
  } catch {
    throw new Error('Can’t reach the room server. Check the connection and try again.')
  }
  const body = (await response.json().catch(() => ({}))) as { code?: string; hostToken?: string; error?: string }
  if (!response.ok || !body.code || !body.hostToken) throw new Error(body.error ?? 'Couldn’t open a room. Try again.')
  return { code: body.code, hostToken: body.hostToken }
}

/** True or false if the server answered; null if it couldn't be reached. */
export async function roomExists(code: string): Promise<boolean | null> {
  try {
    const response = await fetch(`${roomServer()}/rooms/${code}`)
    const body = (await response.json()) as { exists?: boolean }
    return body.exists === true
  } catch {
    return null
  }
}

/** A room as the lobby shows it: still there or not, and how many are seated. Null if the server can't be reached. */
export interface RoomInfo {
  exists: boolean
  players: number
}

export async function roomStatus(code: string): Promise<RoomInfo | null> {
  try {
    const response = await fetch(`${roomServer()}/rooms/${code}`)
    const body = (await response.json()) as { exists?: boolean; players?: number }
    return { exists: body.exists === true, players: typeof body.players === 'number' ? body.players : 0 }
  } catch {
    return null
  }
}

export interface RoomLine {
  send: (command: Command) => void
  close: () => void
}

/** Opens (and keeps open) this phone's line to room `code`. */
export function connectRoom(
  code: string,
  hello: Omit<Hello, 'v' | 't'>,
  events: {
    onStatus: (status: RoomStatus, detail?: string) => void
    onView: (view: TableView) => void
    onError: (message: string) => void
  },
): RoomLine {
  let socket: WebSocket | null = null
  let closed = false
  let attempts = 0
  let reqId = 0
  let lastHeard = Date.now()
  let ping: ReturnType<typeof setInterval> | null = null
  let retry: ReturnType<typeof setTimeout> | null = null

  const send = (message: ToRoom) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message))
  }

  const stopPing = () => {
    if (ping) clearInterval(ping)
    ping = null
  }

  const scheduleRetry = async () => {
    if (closed || retry) return
    stopPing()
    // Before trying again, make sure there's still a room to go back to.
    const exists = await roomExists(code)
    if (closed) return
    if (exists === false) {
      closed = true
      events.onStatus('closed', `Room ${code} doesn’t exist, or has closed.`)
      return
    }
    events.onStatus('reconnecting', exists === null ? 'Can’t reach the room server. Retrying…' : 'Reconnecting…')
    const delay = Math.min(1000 * 2 ** attempts, MAX_BACKOFF_MS)
    attempts++
    retry = setTimeout(() => {
      retry = null
      open()
    }, delay)
  }

  const open = () => {
    if (closed) return
    const url = `${roomServer().replace(/^http/, 'ws')}/rooms/${code}/ws`
    const ws = new WebSocket(url)
    socket = ws
    ws.onopen = () => {
      attempts = 0
      lastHeard = Date.now()
      send({ v: PROTOCOL, t: 'hello', ...hello })
      stopPing()
      ping = setInterval(() => {
        if (Date.now() - lastHeard > SILENCE_MS) ws.close()
        else send({ v: PROTOCOL, t: 'ping' })
      }, PING_MS)
    }
    ws.onmessage = (event) => {
      lastHeard = Date.now()
      let message: ToPhone
      try {
        message = JSON.parse(String(event.data)) as ToPhone
      } catch {
        return
      }
      if (message.v !== PROTOCOL) return
      if (message.t === 'state') {
        events.onStatus('open')
        events.onView(message.view)
      } else if (message.t === 'error') events.onError(message.message)
    }
    ws.onclose = () => {
      if (socket === ws) void scheduleRetry()
    }
  }

  events.onStatus('connecting')
  open()

  return {
    send: (command) => send({ v: PROTOCOL, t: 'command', command, reqId: ++reqId }),
    close: () => {
      closed = true
      stopPing()
      if (retry) clearTimeout(retry)
      socket?.close()
      events.onStatus('closed')
    },
  }
}
