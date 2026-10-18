import type { Hello, SeatKeys, TableView } from '../room'
import type { RoomStatus } from '../socket'
import type { CardMode, Command, HomeConfig, HomeState } from '../table'

/**
 * The shape of phone-hosted ("nearby") rooms: what the screens may rely on.
 * Everything here is built on `RoomCore` and WebRTC data channels, with no
 * server. See plans/w-p2p.md.
 */

export interface LineEvents {
  onStatus(s: RoomStatus, detail?: string): void
  onView(v: TableView): void
  onError(m: string): void
}
export interface RoomLine {
  send(command: Command): void
  close(): void
}
/** How a table screen reaches its room: a WebSocket line online, a data channel nearby. */
export type Connector = (hello: Omit<Hello, 'v' | 't'>, events: LineEvents) => RoomLine

export type P2PErrorCode = 'typo' | 'wrong-kind' | 'version' | 'no-network' | 'unreachable' | 'stale' | 'unsupported' | 'camera'

/** Something a person can fix; `message` can be shown as-is. */
export class P2PError extends Error {
  readonly code: P2PErrorCode
  constructor(code: P2PErrorCode, message?: string) {
    super(message ?? P2P_MESSAGES[code])
    this.code = code
  }
}

export const P2P_MESSAGES: Record<P2PErrorCode | 'hostLost' | 'mdnsOnly', string> = {
  typo: 'That code has a typo. Check it and try again.',
  'wrong-kind': "That's a reply code. Scan the host's code instead.",
  version: 'That code is from a different version of the app. Update both phones with internet first.',
  'no-network': "This phone isn't on any Wi-Fi. Join the host's hotspot, then try again.",
  unreachable: "The phones couldn't reach each other. Are both on the same hotspot? Plane Wi-Fi often blocks this.",
  stale: 'That reply is for an old code. Make a new one.',
  unsupported: "This browser can't connect phones directly.",
  camera: 'No camera access. Type the code instead.',
  hostLost: "Lost the host. When it's back, ask for a new code and tap Rejoin. Your seat and chips are kept.",
  mdnsOnly: 'Allow the camera so other phones can find this one.',
}

export type CodeKind = 'offer' | 'answer'
export function peekKind(_input: string): CodeKind | null {
  throw new Error('not implemented')
}
export function groupCode(_code: string): string {
  throw new Error('not implemented')
}
export function nearbySupported(): boolean {
  throw new Error('not implemented')
}

export interface Invite {
  id: string
  code: string
  status: 'waiting' | 'connecting' | 'connected' | 'failed'
  error?: P2PErrorCode
  mdnsOnly: boolean
}
export interface NearbyHost {
  readonly roomId: string
  readonly hostToken: string
  readonly connector: Connector
  /** Rejects P2PError no-network | unsupported. */
  createInvite(): Promise<Invite>
  /** Rejects P2PError typo | wrong-kind | version | stale. */
  acceptAnswer(code: string): Promise<void>
  cancelInvite(id: string): void
  invites(): Invite[]
  onInvites(cb: (list: Invite[]) => void): () => void
  close(): void
}
export interface NearbyRoomSaved {
  v: 1
  roomId: string
  hostToken: string
  state: HomeState
  keys: SeatKeys
  savedAt: number
}
export function startNearbyHost(_from: { config: HomeConfig; cards: CardMode } | { resume: NearbyRoomSaved }, _deps?: P2PDeps): NearbyHost {
  throw new Error('not implemented')
}
export function loadNearbyRoom(): NearbyRoomSaved | null {
  throw new Error('not implemented')
}
export function clearNearbyRoom(): void {
  throw new Error('not implemented')
}

export interface NearbyGuest {
  answer(offerCode: string): Promise<string>
  readonly connector: Connector
  close(): void
}
export function startNearbyGuest(_deps?: P2PDeps): NearbyGuest {
  throw new Error('not implemented')
}

export function qrMatrix(_text: string): boolean[][] {
  throw new Error('not implemented')
}
export function qrScanSupported(): boolean {
  throw new Error('not implemented')
}
/** Rejects P2PError camera. Resolves to a function that stops the scan and the camera. */
export function startQrScan(_video: HTMLVideoElement, _onCode: (text: string) => void): Promise<() => void> {
  throw new Error('not implemented')
}

/** A data channel, as much of `RTCDataChannel` as the transport uses. */
export interface DataChannelLike {
  readonly readyState: RTCDataChannelState
  readonly bufferedAmount: number
  send(data: string): void
  close(): void
  onopen: ((event: Event) => void) | null
  onclose: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent<unknown>) => void) | null
}
/** A peer connection, as much of `RTCPeerConnection` as the code uses (so tests can fake it). */
export interface PeerLike {
  readonly iceGatheringState: RTCIceGatheringState
  readonly connectionState: RTCPeerConnectionState
  readonly localDescription: { readonly sdp: string } | null
  onicegatheringstatechange: ((event: Event) => void) | null
  onconnectionstatechange: ((event: Event) => void) | null
  createDataChannel(label: string, init?: RTCDataChannelInit): DataChannelLike
  createOffer(): Promise<RTCSessionDescriptionInit>
  createAnswer(): Promise<RTCSessionDescriptionInit>
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>
  close(): void
}
export interface P2PDeps {
  createPeer?: () => PeerLike
  now?: () => number
  /** How long to wait for ICE candidates before using what there is. Default 2500. */
  gatherMs?: number
  /** How long after the reply the channel may take to open. Default 15000. */
  connectMs?: number
}
