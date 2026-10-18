import { RoomCore, type SeatKeys } from '../room'
import { newTable, shuffledDeck, type HomeState } from '../table'
import { dataChannelTransport, loopbackPair, type Channel } from './channel'
import { decodeSignal, encodeSignal, newOfferId, signalFromSdp, signalToSdp } from './codec'
import { P2PError, type Connector, type Invite, type NearbyHost, type NearbyStart, type P2PDeps, type PeerLike } from './contract'
import { lineOverChannel } from './guest-line'
import { SILENCE_MS, gatheredSdp, openRoomChannel, settingsFrom, watchConnection } from './peer'
import { saveNearbyRoom } from './saved'

/**
 * A room hosted on this phone. The deck, everyone's cards and the rules live
 * in one `RoomCore` here, the same one the room server runs. Each other phone
 * is one invite: a peer connection and a data channel the host hands out a
 * code for and takes a reply code back from. The host's own seat is a link
 * like any other, over an in-memory pair of channels.
 */

/** Uniform in [0, 1), from the platform's cryptographic generator: the shuffle nobody can predict. */
function cryptoRandom(): number {
  const word = new Uint32Array(1)
  crypto.getRandomValues(word)
  return word[0] / 2 ** 32
}

const CLOSED = 'This nearby table is closed.'

interface Link {
  invite: Invite
  pc: PeerLike
  channel: Channel
  /** Set once the link is torn down, so late events from its peer are ignored. */
  done: boolean
  stopWatch: () => void
  connectTimer: ReturnType<typeof setTimeout> | null
  silenceTimer: ReturnType<typeof setTimeout> | null
}

export function startNearbyHost(from: NearbyStart, deps: P2PDeps = {}): NearbyHost {
  const settings = settingsFrom(deps)
  const resume = 'resume' in from ? from.resume : null
  const roomId = resume?.roomId ?? crypto.randomUUID()
  const hostToken = resume?.hostToken ?? crypto.randomUUID()
  const save = (state: HomeState, keys: SeatKeys) => saveNearbyRoom({ v: 1, roomId, hostToken, state, keys, savedAt: settings.now() })
  const core = new RoomCore(
    'resume' in from ? from.resume.state : newTable(from.config, from.cards),
    hostToken,
    () => shuffledDeck(cryptoRandom),
    save,
    resume?.keys,
    settings.now,
  )
  if (!resume) save(core.state, core.seatKeys)

  const links = new Map<string, Link>()
  const listeners = new Set<(list: Invite[]) => void>()
  let closed = false
  let selfLines = 0

  const notify = () => {
    const list = [...links.values()].map((l) => ({ ...l.invite }))
    for (const listener of listeners) listener(list)
  }

  /** Ends the connection and frees the seat's link; the invite itself stays until `drop` or `fail`. */
  const teardown = (link: Link) => {
    if (link.done) return
    link.done = true
    if (link.connectTimer) clearTimeout(link.connectTimer)
    if (link.silenceTimer) clearTimeout(link.silenceTimer)
    link.stopWatch()
    core.close(link.invite.id)
    link.channel.close()
  }

  /** The connection is gone: a guest who had joined leaves the list (they rejoin with a new invite); one who never got through shows why. */
  const lose = (link: Link) => {
    if (link.done) return
    const connected = link.invite.status === 'connected'
    teardown(link)
    if (connected) links.delete(link.invite.id)
    else link.invite = { ...link.invite, status: 'failed', error: 'unreachable' }
    notify()
  }

  const armSilence = (link: Link) => {
    if (link.silenceTimer) clearTimeout(link.silenceTimer)
    link.silenceTimer = setTimeout(() => lose(link), SILENCE_MS)
  }

  const connector: Connector = (hello, events) => {
    const [phone, seat] = loopbackPair()
    const linkId = `self-${selfLines++}`
    core.open(linkId, (message) => seat.send(JSON.stringify(message)))
    seat.onMessage((text) => core.receive(linkId, JSON.parse(text)))
    seat.onStatus((status) => status === 'closed' && core.close(linkId))
    const line = lineOverChannel(phone, { ...hello, hostToken }, events)
    return {
      send: line.send,
      close: () => {
        line.close()
        phone.close()
      },
    }
  }

  return {
    roomId,
    hostToken,
    connector,

    async createInvite() {
      if (closed) throw new P2PError('unsupported', CLOSED)
      const pc = settings.createPeer()
      try {
        const dc = openRoomChannel(pc)
        const id = newOfferId()
        await pc.setLocalDescription(await pc.createOffer())
        const signal = signalFromSdp(await gatheredSdp(pc, settings.gatherMs), 'offer', id)
        if (signal.candidates.length === 0) throw new P2PError('no-network')
        if (closed) throw new P2PError('unsupported', CLOSED)
        const link: Link = {
          invite: { id, code: encodeSignal(signal), status: 'waiting', mdnsOnly: signal.candidates.every((c) => c.family === 'mdns') },
          pc,
          channel: dataChannelTransport(dc, pc, settings.now),
          done: false,
          stopWatch: () => {},
          connectTimer: null,
          silenceTimer: null,
        }
        link.stopWatch = watchConnection(pc, () => lose(link))
        link.channel.onStatus((status) => {
          if (link.done) return
          if (status === 'open') {
            if (link.connectTimer) clearTimeout(link.connectTimer)
            link.invite = { ...link.invite, status: 'connected' }
            core.open(id, (message) => link.channel.send(JSON.stringify(message)))
            armSilence(link)
            notify()
          } else if (status === 'closed') lose(link)
        })
        link.channel.onMessage((text) => {
          if (link.done || link.invite.status !== 'connected') return
          armSilence(link)
          try {
            core.receive(id, JSON.parse(text))
          } catch {
            // Not JSON: ignore it, like the room server does.
          }
        })
        links.set(id, link)
        notify()
        return { ...link.invite }
      } catch (error) {
        pc.close()
        throw error instanceof P2PError ? error : new P2PError('unsupported')
      }
    },

    async acceptAnswer(code) {
      const signal = decodeSignal(code, 'answer')
      const link = links.get(signal.offerId)
      if (!link || link.done || link.invite.status !== 'waiting') throw new P2PError('stale')
      link.invite = { ...link.invite, status: 'connecting' }
      link.connectTimer = setTimeout(() => lose(link), settings.connectMs)
      notify()
      try {
        await link.pc.setRemoteDescription({ type: 'answer', sdp: signalToSdp(signal) })
      } catch {
        if (link.connectTimer) clearTimeout(link.connectTimer)
        link.invite = { ...link.invite, status: 'waiting' }
        notify()
        throw new P2PError('typo')
      }
    },

    cancelInvite(id) {
      const link = links.get(id)
      if (!link) return
      teardown(link)
      links.delete(id)
      notify()
    },

    invites: () => [...links.values()].map((l) => ({ ...l.invite })),

    onInvites(cb) {
      listeners.add(cb)
      return () => void listeners.delete(cb)
    },

    close() {
      closed = true
      for (const link of links.values()) teardown(link)
      links.clear()
      listeners.clear()
    },
  }
}
