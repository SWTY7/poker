import type { DataChannelLike, PeerLike } from '../../../src/home/p2p/contract'

/**
 * A pretend WebRTC stack for tests, which run in plain node. Peers made by one
 * FakeNetwork find each other the way real ones do: when each has been given
 * the other's ICE login (ufrag), their data channels open and what one sends
 * the other receives, a moment later. The switches on the network make the
 * things that go wrong on real phones happen on purpose.
 */

export class FakeDataChannel implements DataChannelLike {
  readyState: RTCDataChannelState = 'connecting'
  bufferedAmount = 0
  onopen: ((event: Event) => void) | null = null
  onclose: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null
  /** Every frame this end sent, for tests that look at the wire. */
  readonly sent: string[] = []
  other: FakeDataChannel | null = null

  send(data: string): void {
    if (this.readyState !== 'open') throw new Error('channel is not open')
    this.sent.push(data)
    const other = this.other
    queueMicrotask(() => {
      if (other?.readyState === 'open') other.onmessage?.(new MessageEvent('message', { data }))
    })
  }

  close(): void {
    this.end()
    const other = this.other
    queueMicrotask(() => other?.end())
  }

  open(): void {
    this.readyState = 'open'
    this.onopen?.(new Event('open'))
  }

  end(): void {
    if (this.readyState === 'closed') return
    this.readyState = 'closed'
    this.onclose?.(new Event('close'))
  }
}

const ICE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export class FakePeer implements PeerLike {
  iceGatheringState: RTCIceGatheringState = 'new'
  connectionState: RTCPeerConnectionState = 'new'
  onicegatheringstatechange: ((event: Event) => void) | null = null
  onconnectionstatechange: ((event: Event) => void) | null = null
  channel: FakeDataChannel | null = null
  closed = false
  readonly ufrag: string
  readonly pwd: string
  private local: RTCSessionDescriptionInit | null = null
  private remoteUfrag: string | null = null

  private readonly network: FakeNetwork
  readonly index: number

  constructor(network: FakeNetwork, index: number) {
    this.network = network
    this.index = index
    this.ufrag = `${ICE[index % 64]}${ICE[(index * 7) % 64]}fk`
    this.pwd = `fakepassword${String(index).padStart(4, '0')}abcdefgh`.slice(0, 24)
  }

  get localDescription(): { sdp: string } | null {
    return this.local && { sdp: this.sdp(this.local.type === 'offer' ? 'actpass' : 'active', this.iceGatheringState === 'complete') }
  }

  createDataChannel(_label: string, _init?: RTCDataChannelInit): FakeDataChannel {
    this.channel = new FakeDataChannel()
    return this.channel
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: this.sdp('actpass', false) }
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: this.sdp('active', false) }
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.local = description
    this.iceGatheringState = 'gathering'
    queueMicrotask(() => {
      if (!this.network.gathers || this.closed) return
      this.iceGatheringState = 'complete'
      this.onicegatheringstatechange?.(new Event('icegatheringstatechange'))
    })
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    const ufrag = /a=ice-ufrag:(\S+)/.exec(description.sdp ?? '')?.[1]
    if (!ufrag) throw new Error('no ice-ufrag in the remote description')
    this.remoteUfrag = ufrag
    this.network.link(this)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.connectionState = 'closed'
    this.channel?.close()
  }

  /** Connects this peer and `other`: both sides connected, both channels open. */
  connectTo(other: FakePeer): void {
    for (const peer of [this, other]) peer.setState('connected')
    if (this.channel && other.channel) {
      this.channel.other = other.channel
      other.channel.other = this.channel
      queueMicrotask(() => {
        this.channel?.open()
        other.channel?.open()
      })
    }
  }

  /** Moves the connection to `state` and tells whoever is watching, as the browser does. */
  setState(state: RTCPeerConnectionState): void {
    this.connectionState = state
    this.onconnectionstatechange?.(new Event('connectionstatechange'))
  }

  /** The network under both phones dies: failed connections, closed channels. */
  drop(): void {
    const other = this.network.peers.find((p) => p.channel === this.channel?.other)
    for (const peer of [this, other]) {
      peer?.setState('failed')
      peer?.channel?.end()
    }
  }

  knows(other: FakePeer): boolean {
    return this.remoteUfrag === other.ufrag
  }

  private sdp(setup: string, withCandidates: boolean): string {
    const candidates = withCandidates ? this.network.candidateLines(this.index) : []
    return [
      'v=0',
      'o=- 1 2 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'a=group:BUNDLE 0',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
      ...candidates,
      `a=ice-ufrag:${this.ufrag}`,
      `a=ice-pwd:${this.pwd}`,
      `a=fingerprint:sha-256 ${Array.from({ length: 32 }, (_, i) => ((this.index * 31 + i * 7) % 256).toString(16).toUpperCase().padStart(2, '0')).join(':')}`,
      `a=setup:${setup}`,
      'a=mid:0',
      'a=sctp-port:5000',
      '',
    ].join('\r\n')
  }
}

export class FakeNetwork {
  readonly peers: FakePeer[] = []
  /** What a peer offers as addresses: none (no Wi-Fi), an IPv4 address, or only a `.local` name. */
  addresses: 'none' | 'ipv4' | 'mdns' = 'ipv4'
  /** False: ICE never says it is done, so the code has to use the timeout. */
  gathers = true
  /** False: the peers never reach each other (client isolation on the hotspot, say). */
  connects = true

  readonly createPeer = (): FakePeer => {
    const peer = new FakePeer(this, this.peers.length + 1)
    this.peers.push(peer)
    return peer
  }

  candidateLines(index: number): string[] {
    if (this.addresses === 'none') return []
    const address = this.addresses === 'ipv4' ? `192.168.43.${index}` : `00000000-0000-4000-8000-${String(index).padStart(12, '0')}.local`
    return [`a=candidate:${index} 1 udp 2113937151 ${address} ${40000 + index} typ host generation 0`]
  }

  /** Called when a peer has a remote description: connects it to the peer that knows it back. */
  link(peer: FakePeer): void {
    if (!this.connects) return
    const other = this.peers.find((p) => p !== peer && !p.closed && peer.knows(p) && p.knows(peer))
    if (other) peer.connectTo(other)
  }
}
