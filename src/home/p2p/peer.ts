import { P2PError, type DataChannelLike, type P2PDeps, type PeerLike } from './contract'

/** What host and guest both need from a peer connection. */

export const GATHER_MS = 2500
export const CONNECT_MS = 15000
/** A connection that says "disconnected" may come back (a Wi-Fi blip); this long is allowed before giving up. */
export const GRACE_MS = 15000
/** How often a phone pings the host, and how long without any word counts as a dead line. */
export const PING_MS = 10000
export const SILENCE_MS = 30000

export interface Settings {
  createPeer: () => PeerLike
  now: () => number
  gatherMs: number
  connectMs: number
}

export function nearbySupported(): boolean {
  return typeof RTCPeerConnection !== 'undefined'
}

/** No ICE servers: the phones are on one network, so host addresses are all there is and all that's needed. */
function createRealPeer(): PeerLike {
  if (!nearbySupported()) throw new P2PError('unsupported')
  return new RTCPeerConnection({ iceServers: [] })
}

export function settingsFrom(deps: P2PDeps): Settings {
  return {
    createPeer: deps.createPeer ?? createRealPeer,
    now: deps.now ?? Date.now,
    gatherMs: deps.gatherMs ?? GATHER_MS,
    connectMs: deps.connectMs ?? CONNECT_MS,
  }
}

/** Both phones make the same channel, so no offer has to describe it. */
export function openRoomChannel(pc: PeerLike): DataChannelLike {
  return pc.createDataChannel('room', { negotiated: true, id: 0 })
}

/** The local SDP once ICE has found its addresses, or after `ms` with whatever it found. */
export async function gatheredSdp(pc: PeerLike, ms: number): Promise<string> {
  await new Promise<void>((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve()
    const done = () => {
      clearTimeout(timer)
      pc.onicegatheringstatechange = null
      resolve()
    }
    const timer = setTimeout(done, ms)
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') done()
    }
  })
  return pc.localDescription?.sdp ?? ''
}

/**
 * Calls `onLost` when the connection has failed or closed, or has stayed
 * "disconnected" for the grace period. Returns a function that stops watching.
 */
export function watchConnection(pc: PeerLike, onLost: () => void): () => void {
  let grace: ReturnType<typeof setTimeout> | null = null
  const clear = () => {
    if (grace) clearTimeout(grace)
    grace = null
  }
  pc.onconnectionstatechange = () => {
    const state = pc.connectionState
    if (state === 'disconnected') grace ??= setTimeout(onLost, GRACE_MS)
    else if (state === 'failed' || state === 'closed') {
      clear()
      onLost()
    } else clear()
  }
  return () => {
    clear()
    pc.onconnectionstatechange = null
  }
}
