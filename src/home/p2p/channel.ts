import type { DataChannelLike, PeerLike } from './contract'
import { Reassembler, toFrames } from './frame'

/**
 * One reliable, ordered line of text messages between two phones. The room
 * logic only ever sees this, so a test can run it over a pair of in-memory
 * ends instead of a WebRTC data channel.
 */

export type ChannelStatus = 'connecting' | 'open' | 'closed'

export interface Channel {
  readonly status: ChannelStatus
  send(text: string): void
  /** One listener; a new one replaces the last. */
  onMessage(listener: (text: string) => void): void
  /** One listener; a new one replaces the last. `why` is a sentence a person can read, if there is one. */
  onStatus(listener: (status: ChannelStatus, why?: string) => void): void
  /** Closes both ends. Safe to call twice. */
  close(why?: string): void
}

/** More than this waiting to go out means the other end isn't taking it: treat the line as dead. */
const BUFFER_MAX = 1_000_000

/** A Channel over a data channel. `pc` is closed with it. */
export function dataChannelTransport(dc: DataChannelLike, pc: PeerLike, now: () => number = Date.now): Channel {
  const reassembler = new Reassembler(now)
  let status: ChannelStatus = dc.readyState === 'open' ? 'open' : dc.readyState === 'connecting' ? 'connecting' : 'closed'
  let message: (text: string) => void = () => {}
  let statusListener: (status: ChannelStatus, why?: string) => void = () => {}
  let sent = 0

  const finish = (why?: string) => {
    if (status === 'closed') return
    status = 'closed'
    dc.onopen = dc.onclose = dc.onmessage = null
    dc.close()
    pc.close()
    statusListener('closed', why)
  }

  dc.onopen = () => {
    if (status !== 'connecting') return
    status = 'open'
    statusListener('open')
  }
  dc.onclose = () => finish()
  dc.onmessage = (event) => {
    if (typeof event.data !== 'string') return
    const text = reassembler.push(event.data)
    if (text !== null) message(text)
  }

  return {
    get status() {
      return status
    },
    send: (text) => {
      if (status !== 'open') return
      if (dc.bufferedAmount > BUFFER_MAX) {
        finish()
        return
      }
      for (const frame of toFrames(text, (sent++).toString(36))) dc.send(frame)
    },
    onMessage: (listener) => {
      message = listener
    },
    onStatus: (listener) => {
      statusListener = listener
    },
    close: finish,
  }
}

/**
 * Two connected ends in one page: what one end sends the other receives, a
 * moment later. For tests, and for the host's own seat.
 */
export function loopbackPair(): [Channel, Channel] {
  const make = () => {
    let status: ChannelStatus = 'open'
    let message: (text: string) => void = () => {}
    let statusListener: (status: ChannelStatus, why?: string) => void = () => {}
    return {
      get status() {
        return status
      },
      deliver: (text: string) => {
        if (status === 'open') message(text)
      },
      end: (why?: string) => {
        if (status === 'closed') return
        status = 'closed'
        statusListener('closed', why)
      },
      onMessage: (listener: (text: string) => void) => {
        message = listener
      },
      onStatus: (listener: (status: ChannelStatus, why?: string) => void) => {
        statusListener = listener
      },
    }
  }
  const a = make()
  const b = make()
  const channel = (self: ReturnType<typeof make>, other: ReturnType<typeof make>): Channel => ({
    get status() {
      return self.status
    },
    send: (text) => {
      if (self.status === 'open') queueMicrotask(() => other.deliver(text))
    },
    onMessage: self.onMessage,
    onStatus: self.onStatus,
    close: (why) => {
      if (self.status === 'closed') return
      self.end()
      queueMicrotask(() => other.end(why))
    },
  })
  return [channel(a, b), channel(b, a)]
}
