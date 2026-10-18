# Plan: "Nearby (no internet)" phone-hosted rooms over WebRTC

Written by the Phase 3 planner (Opus, read-only) on 2026-10-19, saved by the integrator. Nodes: w2 (src/home/p2p/**), w3 (UI). Decisions in RUN.md apply.

## 0. Can two phones in airplane mode find each other? (known vs unverified)
They need a shared IP network. WebRTC with `iceServers: []` gathers only host candidates; airplane mode still allows Wi-Fi.
- Known: iPhone Personal Hotspot needs cellular, so an iPhone can join a hotspot but not provide one in airplane mode.
- Known: Wi-Fi Direct, Bluetooth, AirDrop cannot be reached from a web page.
- Known: iOS suspends a page within seconds of screen lock/background, dropping data channels.
- Known in principle: browsers hide host IPs behind `<uuid>.local` mDNS names unless camera/mic permission was granted. ICE needs only one side to expose a reachable address.
- Known: plain text cannot be copied between an iPhone and an Android phone offline, so the code is mostly TYPED: it must be short and typo-tolerant.
- Unverified: Android hotspot in airplane mode (varies by maker), client isolation on hotspots, plane Wi-Fi peer traffic (usually blocked), `.local` resolution on hotspots, Safari IP exposure, wake lock in iOS home-screen apps.
- Design consequence: an Android phone hosts and runs the hotspot; ask the host for camera access before creating an offer; show a "what you need" checklist; report specific failures (no network, mDNS-only, unreachable). Never claim it works on real phones.

## 1. Design
- `Connector = (hello, events) => RoomLine` is the shape `useRoom` already needs. Online: `(h,e) => connectRoom(code,h,e)` (socket.ts unchanged). `useRoom` gets one optional last parameter `connector?`.
- `Channel` (p2p/channel.ts): `send(text)`, `onMessage`, `onStatus('connecting'|'open'|'closed', why?)`, `close()`. Implementations: `dataChannelTransport(dc, pc)` and `loopbackPair()` (tests and the host's own seat).
- Guest line (p2p/guest-line.ts): `lineOverChannel(channel, hello, events)` mirrors socket.ts: hello on open, ping every 10 s, close after 30 s silence, ignore `v !== PROTOCOL`, 'open' on first state, errors to onError, never reconnects itself; on close emits `onStatus('closed', P2P_MESSAGES.hostLost)`.
- Host (p2p/host.ts, `NearbyHost`) owns one `RoomCore`: shuffle `shuffledDeck(cryptoRandom)` (copy cryptoRandom from server/src/worker.ts), hostToken/roomId from `crypto.randomUUID()`, `onChange` saves to localStorage. The host's own phone is a loopback link (`core.open('self', ...)`, delivery via `queueMicrotask`, hello with hostToken).
  - `createInvite()`: `new RTCPeerConnection({iceServers: []})`, `createDataChannel('room', {negotiated: true, id: 0})`, createOffer, setLocalDescription, wait for `iceGatheringState === 'complete'` or 2.5 s; reject `no-network` if zero candidates; return `Invite {id, code, status:'waiting', mdnsOnly}`.
  - `acceptAnswer(code)`: decode, match `offerId` to a pending invite (`stale` otherwise), rebuild SDP, setRemoteDescription; status connecting, then connected on `dc.onopen`; not open after 15 s -> failed/`unreachable`.
  - Link lifetime: on open `core.open(inviteId, m => chan.send(JSON.stringify(m)))`, incoming frames to `core.receive`. `disconnected` gets a 15 s grace; `failed`/`closed`/grace expiry/30 s without ping -> `core.close(id)` and drop the invite. Rejoin = a new invite (guest hello carries the same playerId+seatKey; RoomCore re-seats). `close()` closes all peers, keeps the saved room.
- Guest (p2p/guest.ts, `NearbyGuest`): `answer(offerCode)` decodes, validates kind+version, same negotiated channel, rebuilds SDP, creates+sets the answer, waits for gathering (0 candidates -> `no-network`), returns the answer code. Same 15 s timeout. Rejoin = a new NearbyGuest.
- Framing (p2p/frame.ts): one JSON string per message; <= 8000 chars sent as is (starts with `{`); longer split into `~<msgId>.<i>.<n>:<slice>` chunks <= 8000 UTF-16 chars; reassemble, drop incomplete after 10 s, cap 1 MB; `bufferedAmount` > 1 MB means dead channel. Keepalive reuses ping/pong.

## 2. Signalling codec (p2p/codec.ts)
Strip the SDP to what WebRTC needs, pack binary, rebuild a canonical data-channel SDP on the other side (deflating the whole SDP is rejected: too long to type).
- Binary payload: `hdr` (version 4 bits = 1, kind offer/answer, setup actpass/active/passive); `offerId` (4 bytes); ufrag and pwd (length byte + 6-bit packed); fingerprint (algo byte 1=sha-256, 2=sha-384, 3=sha-512 + raw hash); candidate count (max 6, IPv4 first); each UDP host candidate: flags (v4/v6/mdns), address (4 or 16 bytes, or 16-byte UUID for `.local`), u16 port; TCP dropped; CRC-16/CCITT over everything.
- Text: prefix `P1H` (host) or `P1G` (guest) + Crockford base32 upper case; decode tolerant (O->0, I/L->1, spaces/dashes ignored); display grouped in fours; charset fits QR alphanumeric mode.
- Size: one IPv4 candidate about 117 chars (QR v5-L, 154); three mDNS about 197 chars (v7-L, 224). Hard budget 224 characters.
- Rebuilt SDP template: `v=0 / o=- <offerId> 2 IN IP4 127.0.0.1 / s=- / t=0 0 / a=group:BUNDLE 0 / m=application 9 UDP/DTLS/SCTP webrtc-datachannel / c=IN IP4 0.0.0.0 / a=ice-ufrag / a=ice-pwd / a=fingerprint / a=setup / a=mid:0 / a=sctp-port:5000 / a=max-message-size:65536 / a=candidate:<i> 1 udp <2130706431-i> <addr> <port> typ host / a=end-of-candidates`.
- Unit tests: (1) real SDP fixtures (Chrome, Safari, Firefox; offer and answer; IPv4, IPv6, mDNS) round-trip; (2) rebuilt SDP parses back to the same fields; (3) every fixture within budget, worst case <= 224 chars; (4) any single changed char fails CRC (`typo`); (5) O/0, I/1, lower-case, spaces/dashes decode; (6) wrong kind -> `wrong-kind`; (7) version 2 -> `version`; (8) missing fingerprint/ufrag throws on encode; (9) > 6 candidates capped, IPv4 first, TCP dropped; (10) unknown fingerprint algo rejected; (11) `offerId` survives offer -> answer.

## 3. QR
- Generate: `uqr` (unjs, MIT, ESM, no deps), fallback `qrcode-generator` (MIT). w2 checks `npm view <pkg> license dist.unpackedSize` first, writes a decision record, wraps as `qrMatrix(text): boolean[][]` (ECC L, alphanumeric). Hand-written encoder rejected. w3 renders an SVG of dark modules on an always-white tile with a 4-module quiet zone in both themes.
- Scan: `BarcodeDetector({formats:['qr_code']})` exists in Chrome on Android; iOS Safari and Firefox do not have it. Flow: `getUserMedia({video:{facingMode:'environment'}})` in a click handler, detect on `<video playsinline muted>` every ~200 ms, stop tracks on success/cancel, denied -> "No camera access. Type the code instead." On iPhone the fallback is typing about 120 characters. A pure-JS decoder for iOS (jsQR, Apache-2.0, ~40 KB gz) is NOT added now (owner decision, listed in NEXT.md). Recommend an Android host.

## 4. Persistence (p2p/saved.ts)
localStorage key `poker.home.nearby` via `utils/storage` readJSON/writeJSON: `{v:1, roomId, hostToken, state, keys, savedAt}`, written on every RoomCore `onChange`; `loadNearbyRoom()` checks shape (null on mismatch); `clearNearbyRoom()` on End game. A refresh keeps stacks, seats, clock; peer connections die with the page, each guest gets a new invite and taps Rejoin. Lobby shows "Reopen nearby table" when a room is saved.

## 5. UI (w3)
- Doors: "Nearby (no internet)" in the home-game doors of Lobby.tsx (classic) and RoomLobby.tsx (realistic), plus "Reopen nearby table". Line: "Play on a plane or anywhere offline. One phone hosts, the others join over a hotspot."
- `NearbyIntro` checklist: every phone opened the app once with internet and has the same version; one shared network (Android hotspot usually works in airplane mode: turn on airplane mode, then the hotspot; iPhone Personal Hotspot needs mobile data so iPhones join someone else's hotspot; plane Wi-Fi usually blocks phones from seeing each other); join that network before opening the room; keep the host's screen on and the app open. Trust notice (also on host setup and join): "The host's phone holds the deck and everyone's cards. Play nearby only with people you trust." Buttons: Host nearby, Join nearby.
- Host: `HostEntry` gains an optional `nearby` prop (subtitle/button, skips fetch); `NearbyHostScreen` shows `HomeTable` (`code={null}`, share-link line hidden when null) and an "Add a player" sheet: QR, grouped code, "Have them scan this, or type it.", "Scan their reply" / "Type their reply" (monospace textarea, `autoCapitalize="characters"`, `autoComplete="off"`), per-invite status (waiting/connecting/connected/failed+reason); mDNS-only hint "Allow the camera so other phones can find this one."
- Guest `NearbyJoin`: name, "Scan host code" or type; shows reply QR + code "Show this to the host."; "Connecting...", then table; host lost panel: "Lost the host. When it's back, ask for a new code and tap Rejoin. Your seat and chips are kept."
- Error copy (`P2P_MESSAGES`, owned by w2): typo "That code has a typo. Check it and try again."; wrong-kind "That's a reply code. Scan the host's code instead." (or the reverse); version "That code is from a different version of the app. Update both phones with internet first."; no-network "This phone isn't on any Wi-Fi. Join the host's hotspot, then try again."; unreachable "The phones couldn't reach each other. Are both on the same hotspot? Plane Wi-Fi often blocks this."; stale "That reply is for an old code. Make a new one."; unsupported "This browser can't connect phones directly."
- Keep awake: `useWakeLock()` requests `navigator.wakeLock.request('screen')` on nearby table screens, re-requests on `visibilitychange`; where missing, note "Set auto-lock to Never while you play."
- Styling: existing menu/btn classes plus new rules in room-lobby.css using theme tokens (both themes).

## 6. Tests
Codec 1-11 (tests/home/p2p/codec.test.ts); framing (single, 40 KB split+reassemble, interleaved, expiry, cap); fake peers (`FakePeerConnection` pair satisfying `PeerLike`: createOffer/Answer fixture SDP, gathering events, connect on matching ufrag, switches for zero candidates / never connects / drops later); loopback (host + two guests through the real code strings, online-cards hand played, each phone sees only its own hole cards, stacks add up, drop + new invite + rejoin keeps seat mid-hand, wrong seatKey refused); host/guest status transitions with fake timers (waiting -> connecting -> connected, 15 s -> failed/unreachable, zero candidates -> no-network, stale offerId, guest open -> closed with hostLost after 30 s silence, disconnected-then-recovered within grace keeps the link); persistence (onChange writes, resume rebuilds the same view, malformed saves null); UI via `renderToString` (intro copy + trust notice, invite sheet QR SVG on a white tile, error copy per code, doors include "Nearby (no internet)"; CSS test: QR tile `#fff` in both themes). Gate: `bash scripts/check.sh`.
Manual two-tab check (integrator, browser pane): `npm run dev`; tab A Nearby -> Host -> "Just dealing" -> Add a player; copy the code to tab B: Nearby -> Join -> name -> paste; copy the reply back to A; both reach the table; deal a hand with online cards; reload A, room survives, rejoin B with a new invite; Wi-Fi off -> no-network message. Host must "just deal": both tabs share localStorage, hence the same playerId/seatKey.

## 7. Split and contract
- w2: `src/home/p2p/**`, `tests/home/p2p/**`, package.json/lockfile (QR library), a decision record. room.ts unchanged. w2 commits `src/home/p2p/contract.ts` FIRST (types plus throwing stubs), then implements.
- w3: `src/ui/home/**`, `src/ui/RoomLobby.tsx`, `src/ui/Lobby.tsx` (additive, one door), `src/styles/room-lobby.css`, `src/App.tsx` (screens `nearby-intro`, `nearby-host-setup`, `nearby-host {resume?, setup?}`, `nearby-join`), `tests/ui/**`. `NearbyHostScreen` creates the `NearbyHost` in a ref with a StrictMode guard and closes it on unmount. `useRoom` gets the extra `connector?` parameter in its effect dependencies (stable identity: a property of the host/guest instance).

```ts
import type { Hello, SeatKeys, TableView } from '../room'
import type { RoomStatus } from '../socket'
import type { CardMode, Command, HomeConfig, HomeState } from '../table'
export interface LineEvents { onStatus(s: RoomStatus, detail?: string): void; onView(v: TableView): void; onError(m: string): void }
export interface RoomLine { send(command: Command): void; close(): void }
export type Connector = (hello: Omit<Hello, 'v' | 't'>, events: LineEvents) => RoomLine
export type P2PErrorCode = 'typo' | 'wrong-kind' | 'version' | 'no-network' | 'unreachable' | 'stale' | 'unsupported' | 'camera'
export class P2PError extends Error { constructor(readonly code: P2PErrorCode, message?: string) }
export const P2P_MESSAGES: Record<P2PErrorCode | 'hostLost' | 'mdnsOnly', string>
export type CodeKind = 'offer' | 'answer'
export function peekKind(input: string): CodeKind | null
export function groupCode(code: string): string
export function nearbySupported(): boolean
export interface Invite { id: string; code: string; status: 'waiting' | 'connecting' | 'connected' | 'failed'; error?: P2PErrorCode; mdnsOnly: boolean }
export interface NearbyHost {
  readonly roomId: string; readonly hostToken: string; readonly connector: Connector
  createInvite(): Promise<Invite>          // rejects P2PError no-network | unsupported
  acceptAnswer(code: string): Promise<void> // rejects typo | wrong-kind | version | stale
  cancelInvite(id: string): void
  invites(): Invite[]; onInvites(cb: (list: Invite[]) => void): () => void
  close(): void
}
export interface NearbyRoomSaved { v: 1; roomId: string; hostToken: string; state: HomeState; keys: SeatKeys; savedAt: number }
export function startNearbyHost(from: { config: HomeConfig; cards: CardMode } | { resume: NearbyRoomSaved }, deps?: P2PDeps): NearbyHost
export function loadNearbyRoom(): NearbyRoomSaved | null
export function clearNearbyRoom(): void
export interface NearbyGuest { answer(offerCode: string): Promise<string>; readonly connector: Connector; close(): void }
export function startNearbyGuest(deps?: P2PDeps): NearbyGuest
export function qrMatrix(text: string): boolean[][]
export function qrScanSupported(): boolean
export function startQrScan(video: HTMLVideoElement, onCode: (text: string) => void): Promise<() => void> // rejects P2PError camera
export interface PeerLike { /* subset of RTCPeerConnection used */ }
export interface P2PDeps { createPeer?: () => PeerLike; now?: () => number; gatherMs?: number; connectMs?: number }
```

## 8. Risks / unverified
Every real-phone claim in section 0. The rebuilt SDP is checked only in desktop Chrome (two-tab test); Safari/iOS/Firefox acceptance unverified, so keep their SDP fixtures in the codec tests. iOS cannot scan without a JS decoder (owner decision); typing ~120 characters per iPhone guest is slow but works. Leaving the app or locking the screen on the host ends the game for everyone; wake lock reduces but does not prevent. Trust: with online cards the host's memory and localStorage hold the deck and every hand; the blind clock trusts the host's clock (covered by the notice). Android may show a "Wi-Fi has no internet" prompt and leave the network; camera permission may re-prompt each launch of an iOS home-screen app. Version skew: the code's version prefix plus `PROTOCOL` catch it. Two-tab check is limited to one seated tab (shared localStorage).
