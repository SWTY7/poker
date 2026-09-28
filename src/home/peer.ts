import Peer, { type DataConnection } from 'peerjs'
import { HostCore, PROTOCOL, roomCode, type TableView, type ToHost, type ToJoiner } from './room'
import type { Command, HomeState } from './table'

/**
 * The home game over PeerJS: WebRTC between phones, introduced to each other
 * by PeerJS's free public signalling server. The host's peer id is the room
 * number with a prefix, so a joiner needs nothing but the four digits.
 *
 * Known limits (said in the UI too): the host's tab has to stay open, and a
 * direct connection can fail on some strict networks. Phones on the same
 * Wi-Fi is the case this is built for.
 */

const PREFIX = 'swty7-poker-'
const HEARTBEAT_MS = 4000
const RETRY_MS = 2000
/** An attempt that has neither opened nor failed by now is given up and tried again. */
const OPEN_TIMEOUT_MS = 8000

export type RoomStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface HostHandle {
  code: string
  core: HostCore
  close: () => void
}

/**
 * Opens a room as host. With `code`, reclaims that room (after a reload the
 * signalling server can hold the old id for a few seconds, so it keeps
 * trying); without, draws a fresh number until a free one comes up.
 */
export function hostRoom(
  state: HomeState,
  onChange: (state: HomeState) => void,
  events: { onStatus: (status: RoomStatus, detail?: string) => void; onCode: (code: string) => void },
  code?: string,
): HostHandle {
  const core = new HostCore(state, onChange)
  let peer: Peer | null = null
  let closed = false
  let current = code ?? roomCode()
  let attempts = 0
  const handle: HostHandle = {
    get code() {
      return current
    },
    core,
    close: () => {
      closed = true
      peer?.destroy()
      events.onStatus('closed')
    },
  }

  const start = () => {
    if (closed) return
    events.onStatus('connecting')
    peer = new Peer(PREFIX + current)
    peer.on('open', () => {
      attempts = 0
      events.onCode(current)
      events.onStatus('open')
    })
    peer.on('connection', (conn: DataConnection) => {
      const linkId = conn.connectionId
      conn.on('open', () => core.open(linkId, (message: ToJoiner) => conn.open && conn.send(message)))
      conn.on('data', (data: unknown) => core.receive(linkId, data))
      conn.on('close', () => core.close(linkId))
      conn.on('error', () => core.close(linkId))
    })
    peer.on('disconnected', () => {
      // Lost the signalling server only; live connections carry on. Reconnect so new joiners can find us.
      if (!closed) peer?.reconnect()
    })
    peer.on('error', (error: { type?: string }) => {
      if (error.type === 'unavailable-id') {
        peer?.destroy()
        attempts++
        // Our own room after a reload: wait for the old id to be let go. A fresh room: just draw another number.
        if (code !== undefined && attempts < 15) setTimeout(start, RETRY_MS)
        else {
          current = roomCode()
          start()
        }
        return
      }
      if (error.type === 'network' || error.type === 'server-error' || error.type === 'socket-error') {
        events.onStatus('reconnecting', 'Can’t reach the room server. Retrying…')
        peer?.destroy()
        setTimeout(start, RETRY_MS)
      }
    })
  }
  start()
  return handle
}

export interface JoinHandle {
  send: (command: Command) => void
  close: () => void
}

/**
 * Joins room `code` as `playerId`, and keeps rejoining until closed: a dropped
 * connection or a host reload puts this phone back in the same seat.
 */
export function joinRoom(
  code: string,
  playerId: string,
  name: string,
  events: {
    onStatus: (status: RoomStatus, detail?: string) => void
    onView: (view: TableView) => void
    onError: (message: string) => void
  },
): JoinHandle {
  let peer: Peer | null = null
  let conn: DataConnection | null = null
  let closed = false
  let reqId = 0
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let lastPong = Date.now()
  // Each connection attempt's handlers check this, so a stale connection's
  // late close can't start a second reconnect alongside the first.
  let generation = 0
  let pending: ReturnType<typeof setTimeout> | null = null

  const send = (message: ToHost) => {
    if (conn?.open) conn.send(message)
  }

  const retry = (detail: string) => {
    if (closed || pending) return
    generation++
    events.onStatus('reconnecting', detail)
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
    conn?.close()
    conn = null
    pending = setTimeout(() => {
      pending = null
      connect()
    }, RETRY_MS)
  }

  const connect = () => {
    if (closed || !peer || peer.destroyed) return
    if (peer.disconnected) peer.reconnect()
    const mine = ++generation
    const live = () => mine === generation
    conn = peer.connect(PREFIX + code, { reliable: true })
    // PeerJS can leave an attempt hanging with no open and no error (a host
    // that came back mid-attempt, a signalling reconnect): don't wait forever.
    const opening = setTimeout(() => {
      if (live() && !conn?.open) retry(`Can’t reach room ${code}. Retrying…`)
    }, OPEN_TIMEOUT_MS)
    conn.on('open', () => {
      clearTimeout(opening)
      if (!live()) return
      lastPong = Date.now()
      send({ v: PROTOCOL, t: 'hello', playerId, name })
      heartbeat = setInterval(() => {
        // No answer for three beats: the host's tab closed or slept.
        if (Date.now() - lastPong > HEARTBEAT_MS * 3) retry('Lost the host. Reconnecting…')
        else send({ v: PROTOCOL, t: 'ping' })
      }, HEARTBEAT_MS)
    })
    conn.on('data', (data: unknown) => {
      if (!live()) return
      const message = data as ToJoiner
      if (!message || message.v !== PROTOCOL) return
      lastPong = Date.now()
      if (message.t === 'welcome') events.onStatus('open')
      else if (message.t === 'state') events.onView(message.view)
      else if (message.t === 'error') events.onError(message.message)
    })
    conn.on('close', () => live() && retry('Lost the host. Reconnecting…'))
    conn.on('error', () => live() && retry('Lost the host. Reconnecting…'))
  }

  events.onStatus('connecting')
  peer = new Peer()
  // Also fires when the peer re-registers with the signalling server; only
  // start an attempt if none is live or already scheduled.
  peer.on('open', () => {
    if (!conn && !pending) connect()
  })
  peer.on('error', (error: { type?: string }) => {
    if (error.type === 'peer-unavailable') retry(`No room ${code} yet. Is the host’s screen open?`)
    else if (error.type === 'network' || error.type === 'server-error' || error.type === 'socket-error') {
      events.onStatus('reconnecting', 'Can’t reach the room server. Retrying…')
    }
  })
  peer.on('disconnected', () => {
    if (!closed) peer?.reconnect()
  })

  return {
    send: (command) => send({ v: PROTOCOL, t: 'command', command, reqId: ++reqId }),
    close: () => {
      closed = true
      if (heartbeat) clearInterval(heartbeat)
      if (pending) clearTimeout(pending)
      peer?.destroy()
      events.onStatus('closed')
    },
  }
}
