import type { CodeKind } from '../../../src/home/p2p/contract'

/**
 * Session descriptions of the shape each browser produces for a data-channel-
 * only connection with no ICE servers, in the order and wording the real ones
 * use. HAND-WRITTEN from knowledge of real offers and answers (the logins,
 * hashes, UUIDs and addresses are made up); none was captured from a device.
 * Chrome and Safari hide addresses behind `<uuid>.local` names unless the page
 * has camera or microphone permission; Firefox is the only one of the three
 * whose logins are hex and whose fingerprint is at session level.
 */

const sdp = (lines: string[]) => lines.join('\r\n') + '\r\n'

const CHROME_PRINT = '55:D8:3E:36:2C:54:6B:F9:12:30:19:3D:D9:4F:64:A6:C6:47:83:27:93:17:42:4E:38:13:EE:8D:72:16:8E:F2'

/** Chrome, no permission: addresses are `.local` names. */
export const chromeOffer = sdp([
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:2889427310 1 udp 2113937151 44db9a36-5ab1-45ee-8ac5-89ec53c1ba66.local 58617 typ host generation 0 network-cost 999',
  'a=candidate:3612091348 1 udp 2113939711 fd96bb94-ac65-4aa5-b984-faf73b65484b.local 51402 typ host generation 0 network-cost 999',
  'a=ice-ufrag:S/zl',
  'a=ice-pwd:QuxdmLjczjclzjwYj0LRijoW',
  'a=ice-options:trickle',
  `a=fingerprint:sha-256 ${CHROME_PRINT}`,
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
])

/** Chrome with camera permission: real addresses, IPv4 and IPv6. */
export const chromeAnswer = sdp([
  'v=0',
  'o=- 8127304448562099142 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:842163049 1 udp 2113937151 192.168.43.1 40236 typ host generation 0 network-cost 10',
  'a=candidate:1467250027 1 udp 2113939711 2001:db8:85a3:0:8a2e:370:7334:1f2 49876 typ host generation 0 network-cost 10',
  'a=ice-ufrag:EL+C',
  'a=ice-pwd:ix3ogF6ELkXS9QFr378irWWb',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 E2:EB:D8:10:28:9A:41:3B:2D:6C:81:9C:CE:33:23:8C:FC:47:88:44:9A:22:D3:FB:F8:F0:F5:D9:5E:E3:F9:87',
  'a=setup:active',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
])

/** Safari: IPv4, IPv6 (global and link-local), and the extra `network-id` field. */
export const safariOffer = sdp([
  'v=0',
  'o=- 3340219861207548412 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:3419183297 1 udp 2113937151 172.20.10.4 52044 typ host generation 0 network-id 1 network-cost 10',
  'a=candidate:1853887674 1 udp 2113939711 2001:db8:3c4d:15:6a2f:1bff:fe0c:7d21 55871 typ host generation 0 network-id 2 network-cost 10',
  'a=candidate:2380101764 1 udp 2113932031 fe80::1c4a:8dff:fe31:2a90 60912 typ host generation 0 network-id 3',
  'a=ice-ufrag:9QKn',
  'a=ice-pwd:0CJZmWNm6QCYg5qHgA/mXftZ',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 81:89:AC:C8:96:12:7C:EF:09:69:B3:C2:78:00:A6:BA:30:E9:2E:ED:78:91:15:79:8B:C8:5B:27:B6:E2:CB:8D',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
])

/** Safari answering: a `.local` name and an IPv4 address. */
export const safariAnswer = sdp([
  'v=0',
  'o=- 6018842277310642995 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:1129934521 1 udp 2113937151 7c18b9e7-7278-41cc-9f86-f8d354e16070.local 61133 typ host generation 0 network-id 1 network-cost 10',
  'a=candidate:3052981117 1 udp 2113936127 10.0.0.23 53012 typ host generation 0 network-id 2 network-cost 10',
  'a=ice-ufrag:lqgf',
  'a=ice-pwd:m6UavUmgcPEQt5HUzoDEwysH',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 82:1C:DB:AC:81:D1:92:15:0A:4A:05:65:FD:94:63:90:A1:CC:EC:2E:E0:2C:1A:49:49:FE:4B:5A:C9:00:B7:95',
  'a=setup:active',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
])

/** Firefox: upper-case UDP/TCP, TCP candidates, hex logins, session-level fingerprint, candidates before the logins. */
export const firefoxOffer = sdp([
  'v=0',
  'o=mozilla...THIS_IS_SDPARTA-99.0 6123547895415142342 0 IN IP4 0.0.0.0',
  's=-',
  't=0 0',
  'a=fingerprint:sha-256 84:B5:D4:7A:71:17:81:4C:B3:6F:3E:C5:7C:D0:74:0A:42:EF:75:15:81:FF:99:11:5D:6C:08:11:66:BA:8E:DA',
  'a=group:BUNDLE 0',
  'a=ice-options:trickle',
  'a=msid-semantic:WMS *',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:0 1 UDP 2122252543 192.168.1.37 49152 typ host',
  'a=candidate:1 1 TCP 2105524479 192.168.1.37 9 typ host tcptype active',
  'a=candidate:2 1 UDP 2122187007 2001:db8:77:1:a1b2:c3ff:fed4:e5f6 51834 typ host',
  'a=sendrecv',
  'a=end-of-candidates',
  'a=ice-pwd:3b383349d4d2f8fa375b653ba00e24eb',
  'a=ice-ufrag:d0278a0d',
  'a=mid:0',
  'a=setup:actpass',
  'a=sctp-port:5000',
  'a=max-message-size:1073741823',
])

/** Firefox answering, with the fingerprint in upper case and a single IPv4 address. */
export const firefoxAnswer = sdp([
  'v=0',
  'o=mozilla...THIS_IS_SDPARTA-99.0 2519364087120934617 0 IN IP4 0.0.0.0',
  's=-',
  't=0 0',
  'a=fingerprint:sha-256 07:45:BC:14:42:31:F3:1A:B0:8E:9C:E2:04:15:B0:EA:85:1C:FF:5F:DF:B8:66:37:FF:EE:4E:F4:65:2A:D6:1B',
  'a=group:BUNDLE 0',
  'a=ice-options:trickle',
  'a=msid-semantic:WMS *',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:0 1 UDP 2122252543 192.168.1.52 58770 typ host',
  'a=sendrecv',
  'a=end-of-candidates',
  'a=ice-pwd:a11ea50a3de79f5468a419f207340197',
  'a=ice-ufrag:84e02fcb',
  'a=mid:0',
  'a=setup:active',
  'a=sctp-port:5000',
  'a=max-message-size:1073741823',
])

/** A phone on many networks (Chrome with permission): nine UDP host candidates, two TCP, mixed families. */
export const crowdedOffer = sdp([
  'v=0',
  'o=- 5472917300111845021 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:1 1 udp 2113937151 2001:db8:1::10 40001 typ host generation 0',
  'a=candidate:2 1 udp 2113937150 2001:db8:2::10 40002 typ host generation 0',
  'a=candidate:3 1 udp 2113937149 ea886925-df02-4042-9d1f-856c7491c43b.local 40003 typ host generation 0',
  'a=candidate:4 1 tcp 1518280447 192.168.0.9 9 typ host tcptype active generation 0',
  'a=candidate:5 1 udp 2113937148 192.168.0.9 40005 typ host generation 0',
  'a=candidate:6 1 udp 2113937147 10.1.2.3 40006 typ host generation 0',
  'a=candidate:7 1 udp 2113937146 172.16.0.8 40007 typ host generation 0',
  'a=candidate:8 1 udp 2113937145 2001:db8:3::10 40008 typ host generation 0',
  'a=candidate:9 1 udp 2113937144 192.168.100.4 40009 typ host generation 0',
  'a=candidate:10 1 tcp 1518280446 10.1.2.3 9 typ host tcptype active generation 0',
  'a=candidate:11 1 udp 2113937143 2001:db8:4::10 40011 typ host generation 0',
  'a=ice-ufrag:fuIx',
  'a=ice-pwd:ZVIm+S0le8JF+PQd5YELKoPz',
  'a=ice-options:trickle',
  'a=fingerprint:sha-256 2B:9A:44:E1:0F:73:C5:18:D2:6E:A0:57:B3:8C:F4:21:19:7D:E6:30:AB:55:C8:02:9E:4F:61:D7:3A:B8:0C:F5',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  'a=max-message-size:262144',
])

export interface Fixture {
  name: string
  kind: CodeKind
  sdp: string
}

export const FIXTURES: Fixture[] = [
  { name: 'Chrome offer (.local names)', kind: 'offer', sdp: chromeOffer },
  { name: 'Chrome answer (IPv4 and IPv6)', kind: 'answer', sdp: chromeAnswer },
  { name: 'Safari offer (IPv4, IPv6, link-local)', kind: 'offer', sdp: safariOffer },
  { name: 'Safari answer (.local and IPv4)', kind: 'answer', sdp: safariAnswer },
  { name: 'Firefox offer (TCP, IPv6)', kind: 'offer', sdp: firefoxOffer },
  { name: 'Firefox answer', kind: 'answer', sdp: firefoxAnswer },
  { name: 'crowded phone', kind: 'offer', sdp: crowdedOffer },
]
