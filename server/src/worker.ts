import { DurableObject } from 'cloudflare:workers'
import { RoomCore, isRoomCode, roomCode, type SeatKeys, type ToPhone } from '../../src/home/room'
import { MAX_LEVEL_MINUTES, newTable, shuffledDeck, type CardMode, type HomeConfig, type HomeState } from '../../src/home/table'

/**
 * The home game's room server. One Durable Object per room number holds that
 * room's table (the only copy), runs every command through `RoomCore`, and
 * talks to each phone over a WebSocket. Because it's a server and not a phone,
 * any network that can load a web page can play, and with online cards it
 * holds the deck where no player, the host included, can see it.
 *
 *   POST /rooms             create a room: { config, cards } → { code, hostToken }
 *   GET  /rooms/:code       does it exist, and how many are seated?  → { exists, players }
 *   GET  /rooms/:code/ws    the WebSocket for a phone at that table
 */

interface Env {
  ROOMS: DurableObjectNamespace<Room>
}

/** Where the game itself lives, for anyone who opens this server's address in a browser. */
const GAME_URL = 'https://swty7.github.io/poker/'

/** A room nobody has touched for this long is deleted. */
const IDLE_MS = 12 * 60 * 60 * 1000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } })
}

/** Uniform in [0, 1), from the platform's cryptographic generator: the shuffle nobody can predict. */
function cryptoRandom(): number {
  const word = new Uint32Array(1)
  crypto.getRandomValues(word)
  return word[0] / 2 ** 32
}

interface Saved {
  state: HomeState
  hostToken: string
  keys?: SeatKeys
}

interface Attachment {
  linkId: string
  playerId?: string
  isHost: boolean
}

export class Room extends DurableObject<Env> {
  private core: RoomCore | null = null

  /** Makes this room, unless it already exists. Returns the host's token, or null if taken. */
  async create(config: HomeConfig, cards: CardMode): Promise<string | null> {
    if (await this.ctx.storage.get('room')) return null
    const hostToken = crypto.randomUUID()
    await this.ctx.storage.put('room', { state: newTable(config, cards), hostToken } satisfies Saved)
    await this.touch()
    return hostToken
  }

  async exists(): Promise<boolean> {
    return (await this.ctx.storage.get('room')) !== undefined
  }

  /** What the lobby shows beside a room you could reopen: whether it is still there, and how many are seated. */
  async status(): Promise<{ exists: boolean; players: number }> {
    const saved = await this.ctx.storage.get<Saved>('room')
    return { exists: saved !== undefined, players: saved?.state.players.length ?? 0 }
  }

  async fetch(_request: Request): Promise<Response> {
    const core = await this.load()
    if (!core) return new Response('No such room', { status: 404 })
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    const linkId = crypto.randomUUID()
    // Hibernation-aware: the room can sleep between messages without dropping anyone.
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ linkId, isHost: false } satisfies Attachment)
    core.open(linkId, sender(server))
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const core = await this.load()
    const attachment = ws.deserializeAttachment() as Attachment | null
    if (!core || !attachment || typeof message !== 'string') return
    let data: unknown
    try {
      data = JSON.parse(message)
    } catch {
      return
    }
    core.receive(attachment.linkId, data)
    const identity = core.identity(attachment.linkId) ?? { isHost: false }
    ws.serializeAttachment({ linkId: attachment.linkId, playerId: identity.playerId, isHost: identity.isHost } satisfies Attachment)
    await this.touch()
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.dropSocket(ws)
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.dropSocket(ws)
  }

  /** Deletes the room once it's been idle long enough. */
  async alarm(): Promise<void> {
    const lastActive = (await this.ctx.storage.get<number>('lastActive')) ?? 0
    if (Date.now() - lastActive < IDLE_MS) {
      await this.ctx.storage.setAlarm(lastActive + IDLE_MS)
      return
    }
    for (const ws of this.ctx.getWebSockets()) ws.close(1000, 'Room closed')
    this.core = null
    await this.ctx.storage.deleteAll()
  }

  private async dropSocket(ws: WebSocket): Promise<void> {
    const core = await this.load()
    const attachment = ws.deserializeAttachment() as Attachment | null
    if (core && attachment) core.close(attachment.linkId)
  }

  private async touch(): Promise<void> {
    await this.ctx.storage.put('lastActive', Date.now())
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + IDLE_MS)
  }

  /** The room's core, rebuilt from storage (and its sockets reattached) after a sleep. */
  private async load(): Promise<RoomCore | null> {
    if (this.core) return this.core
    const saved = await this.ctx.storage.get<Saved>('room')
    if (!saved) return null
    const core = new RoomCore(
      saved.state,
      saved.hostToken,
      () => shuffledDeck(cryptoRandom),
      (state, keys) => void this.ctx.storage.put('room', { state, hostToken: saved.hostToken, keys } satisfies Saved),
      saved.keys,
    )
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null
      if (attachment) core.reattach(attachment.linkId, sender(ws), attachment)
    }
    this.core = core
    return core
  }
}

function sender(ws: WebSocket): (message: ToPhone) => void {
  return (message) => {
    try {
      ws.send(JSON.stringify(message))
    } catch {
      // Already closed; its close event tidies up.
    }
  }
}

function validConfig(raw: unknown): HomeConfig | null {
  if (!raw || typeof raw !== 'object') return null
  const { startingStack, smallBlind, bigBlind, ante, levelMinutes = 0 } = raw as Record<string, unknown>
  const whole = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 1e9
  if (!whole(startingStack) || !whole(smallBlind) || !whole(bigBlind) || !whole(ante)) return null
  if (smallBlind < 1 || bigBlind < smallBlind || startingStack <= bigBlind) return null
  if (!whole(levelMinutes) || levelMinutes > MAX_LEVEL_MINUTES) return null
  return { startingStack, smallBlind, bigBlind, ante, levelMinutes }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS })
    const path = new URL(request.url).pathname.split('/').filter(Boolean)

    // Someone opening the server's own address in a browser: say what it is, and where the game is.
    if (request.method === 'GET' && path.length === 0) {
      return new Response(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Poker rooms</title>' +
          '<body style="font-family:system-ui;background:#111;color:#eee;display:grid;place-items:center;min-height:90vh;text-align:center">' +
          '<div><h1>Poker room server</h1><p>It’s running. This address is for the app to talk to, not a page to play on.</p>' +
          `<p><a style="color:#d9b36c" href="${GAME_URL}">Play at ${GAME_URL}</a></p></div>`,
        { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
      )
    }

    if (request.method === 'POST' && path.length === 1 && path[0] === 'rooms') {
      let body: { config?: unknown; cards?: unknown }
      try {
        body = await request.json()
      } catch {
        return json({ error: 'Bad request' }, 400)
      }
      const config = validConfig(body.config)
      const cards: CardMode | null = body.cards === 'online' || body.cards === 'real' ? body.cards : null
      if (!config || !cards) return json({ error: 'Those stakes don’t add up.' }, 400)
      // Draw room numbers until a free one comes up.
      for (let attempt = 0; attempt < 30; attempt++) {
        const code = roomCode(cryptoRandom)
        const hostToken = await env.ROOMS.get(env.ROOMS.idFromName(code)).create(config, cards)
        if (hostToken) return json({ code, hostToken })
      }
      return json({ error: 'No free room numbers right now. Try again.' }, 503)
    }

    if (request.method === 'GET' && path[0] === 'rooms' && path.length >= 2 && isRoomCode(path[1])) {
      const room = env.ROOMS.get(env.ROOMS.idFromName(path[1]))
      if (path.length === 2) return json(await room.status())
      if (path.length === 3 && path[2] === 'ws') {
        if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 })
        return room.fetch(request)
      }
    }

    return json({ error: 'Not found' }, 404)
  },
} satisfies ExportedHandler<Env>
