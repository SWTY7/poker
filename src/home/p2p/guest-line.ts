import { PROTOCOL, type Hello, type ToPhone, type ToRoom } from '../room'
import type { Channel } from './channel'
import { P2P_MESSAGES, type LineEvents, type RoomLine } from './contract'
import { PING_MS, SILENCE_MS } from './peer'

/**
 * A phone's line to a room over a Channel: `connectRoom` in `socket.ts` with
 * the WebSocket swapped for a data channel. It never reconnects by itself: a
 * dead channel stays dead, and the phone makes a new one (a new invite).
 *
 * Closing the line leaves the channel open (the screen may mount the line
 * again, as React's strict mode does); whoever made the channel closes it.
 */

export function lineOverChannel(channel: Channel, hello: Omit<Hello, 'v' | 't'>, events: LineEvents): RoomLine {
  let closed = false
  let reqId = 0
  let lastHeard = Date.now()
  let ping: ReturnType<typeof setInterval> | null = null

  const send = (message: ToRoom) => {
    if (channel.status === 'open') channel.send(JSON.stringify(message))
  }

  const stopPing = () => {
    if (ping) clearInterval(ping)
    ping = null
  }

  const lose = (why?: string) => {
    if (closed) return
    closed = true
    stopPing()
    events.onStatus('closed', why ?? P2P_MESSAGES.hostLost)
  }

  const start = () => {
    lastHeard = Date.now()
    send({ v: PROTOCOL, t: 'hello', ...hello })
    stopPing()
    ping = setInterval(() => {
      if (Date.now() - lastHeard > SILENCE_MS) channel.close()
      else send({ v: PROTOCOL, t: 'ping' })
    }, PING_MS)
  }

  channel.onMessage((text) => {
    if (closed) return
    lastHeard = Date.now()
    let message: ToPhone
    try {
      message = JSON.parse(text) as ToPhone
    } catch {
      return
    }
    if (message.v !== PROTOCOL) return
    if (message.t === 'state') {
      events.onStatus('open')
      events.onView(message.view)
    } else if (message.t === 'error') events.onError(message.message)
  })
  channel.onStatus((status, why) => {
    if (closed) return
    if (status === 'open') start()
    else if (status === 'closed') lose(why)
  })

  events.onStatus('connecting')
  if (channel.status === 'open') start()
  else if (channel.status === 'closed') lose()

  return {
    send: (command) => send({ v: PROTOCOL, t: 'command', command, reqId: ++reqId }),
    close: () => {
      if (closed) return
      closed = true
      stopPing()
      events.onStatus('closed')
    },
  }
}
