import { dataChannelTransport, type Channel } from './channel'
import { decodeSignal, encodeSignal, signalFromSdp, signalToSdp } from './codec'
import { P2PError, P2P_MESSAGES, type Connector, type NearbyGuest, type P2PDeps } from './contract'
import { lineOverChannel } from './guest-line'
import { gatheredSdp, openRoomChannel, settingsFrom, watchConnection } from './peer'

/**
 * This phone joining someone else's room: it takes the host's code, makes a
 * reply code, and once the host has entered the reply the data channel opens
 * and the table line runs over it. One NearbyGuest is one connection; to
 * rejoin after a drop, start a new one (the seat comes back with the same
 * player id and seat key).
 */
/** The host has to scan or type the reply code, which takes a person a while; the channel can't open before that. */
const REPLY_WAIT_MS = 120000

export function startNearbyGuest(deps: P2PDeps = {}): NearbyGuest {
  const settings = settingsFrom(deps)
  let channel: Channel | null = null
  let connectTimer: ReturnType<typeof setTimeout> | null = null
  let closed = false
  let mdnsOnly = false

  const connector: Connector = (hello, events) => {
    // The screens make the reply code before the table, so this is only a guard.
    if (!channel) {
      events.onStatus('closed', P2P_MESSAGES.unreachable)
      return { send: () => {}, close: () => {} }
    }
    return lineOverChannel(channel, hello, events)
  }

  return {
    connector,

    get mdnsOnly() {
      return mdnsOnly
    },

    async answer(offerCode) {
      const offer = decodeSignal(offerCode, 'offer')
      if (closed) throw new P2PError('unreachable')
      channel?.close()
      const pc = settings.createPeer()
      // The screen may leave while the browser is still working; a peer made after that is dropped at once.
      const alive = () => {
        if (closed) throw new P2PError('unreachable')
      }
      try {
        const dc = openRoomChannel(pc)
        await pc.setRemoteDescription({ type: 'offer', sdp: signalToSdp(offer) })
        alive()
        await pc.setLocalDescription(await pc.createAnswer())
        alive()
        const signal = signalFromSdp(await gatheredSdp(pc, settings.gatherMs), 'answer', offer.offerId)
        alive()
        if (signal.candidates.length === 0) throw new P2PError('no-network')
        mdnsOnly = signal.candidates.every((c) => c.family === 'mdns')
        const line = dataChannelTransport(dc, pc, settings.now)
        channel = line
        connectTimer = setTimeout(() => {
          if (line.status === 'connecting') line.close(P2P_MESSAGES.unreachable)
        }, REPLY_WAIT_MS)
        watchConnection(pc, () => line.close())
        return encodeSignal(signal)
      } catch (error) {
        pc.close()
        throw error instanceof P2PError ? error : new P2PError('unsupported')
      }
    },

    close() {
      closed = true
      if (connectTimer) clearTimeout(connectTimer)
      channel?.close()
    },
  }
}
