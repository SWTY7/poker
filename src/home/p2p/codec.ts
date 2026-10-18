import { P2PError, P2P_MESSAGES, type CodeKind } from './contract'

/**
 * The code two phones swap to connect: a WebRTC offer or answer squeezed into
 * a few dozen characters someone can read out or type, and a QR code can hold.
 *
 * Only what a data channel needs is kept (ICE login, certificate fingerprint,
 * a few UDP addresses), packed into bytes and written in Crockford base32
 * (no 0/O or 1/I/L mix-ups, all of it inside the QR alphanumeric alphabet).
 * The other phone rebuilds a plain data-channel SDP from those fields. The
 * last two bytes are a CRC, so a typo is caught here instead of showing up as
 * a connection that never opens.
 *
 * Layout, in bytes: header (version 4 bits, kind 1, setup 2), offer id (4),
 * ICE ufrag and pwd (length, then 6 bits a character), fingerprint (algorithm,
 * hash), candidate count, candidates (family, address, port), CRC-16.
 */

export type FingerprintAlgo = 'sha-256' | 'sha-384' | 'sha-512'
export type Setup = 'actpass' | 'active' | 'passive'
export type CandidateFamily = 'v4' | 'v6' | 'mdns'

export interface Candidate {
  family: CandidateFamily
  /** Dotted IPv4, eight full groups of IPv6, or `<uuid>.local`; all lower case. */
  address: string
  port: number
}

/** What a connection offer or answer says, with everything else dropped. */
export interface Signal {
  kind: CodeKind
  /** Eight hex digits, chosen by the host, repeated in the answer so the host knows which invite it is for. */
  offerId: string
  setup: Setup
  ufrag: string
  pwd: string
  /** The hash as lower-case hex, no colons. */
  fingerprint: { algo: FingerprintAlgo; hash: string }
  candidates: Candidate[]
}

const VERSION = 1
const MAX_CANDIDATES = 6
/** The longest code worth typing or scanning (QR version 7, level L). Extra candidates are left out to stay inside it. */
export const CODE_BUDGET = 224
/** The most characters worth reading from a code box (a code is at most CODE_BUDGET plus spaces); also the inputs' maxLength. */
export const CODE_INPUT_MAX = 400
const ALGOS: FingerprintAlgo[] = ['sha-256', 'sha-384', 'sha-512']
const HASH_BYTES: Record<FingerprintAlgo, number> = { 'sha-256': 32, 'sha-384': 48, 'sha-512': 64 }
const SETUPS: Setup[] = ['actpass', 'active', 'passive']
const FAMILIES: CandidateFamily[] = ['v4', 'v6', 'mdns']
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
/** The characters ICE logins are made of (RFC 8839 allows only these). */
const ICE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const MDNS = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i
const PREFIX_LENGTH = 3

/** A fresh offer id. */
export function newOfferId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4))
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------- text ----------

/** Upper case, no spaces or dashes, and the look-alikes read the way Crockford says (O is 0; I and L are 1). */
function normalise(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
}

/** Which kind of code this looks like, from its first characters, or null if it doesn't look like one. */
export function peekKind(input: string): CodeKind | null {
  const match = /^P\d([HG])/.exec(normalise(input))
  return match ? (match[1] === 'H' ? 'offer' : 'answer') : null
}

/** The code in groups of four, to read and type. */
export function groupCode(code: string): string {
  return normalise(code).replace(/(.{4})(?=.)/g, '$1 ')
}

function toBase32(bytes: number[]): string {
  let out = ''
  let bits = 0
  let acc = 0
  for (const byte of bytes) {
    acc = (acc << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(acc >> (bits - 5)) & 31]
      bits -= 5
    }
    acc &= (1 << bits) - 1
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31]
  return out
}

/** Null if a character isn't in the alphabet or the padding bits aren't zero (a typo can't hide there). */
function fromBase32(text: string): number[] | null {
  const bytes: number[] = []
  let bits = 0
  let acc = 0
  for (const char of text) {
    const value = ALPHABET.indexOf(char)
    if (value < 0) return null
    acc = (acc << 5) | value
    bits += 5
    if (bits >= 8) {
      bytes.push((acc >> (bits - 8)) & 255)
      bits -= 8
    }
    acc &= (1 << bits) - 1
  }
  return bits < 5 && acc === 0 ? bytes : null
}

/** CRC-16/CCITT-FALSE. */
function crc16(bytes: number[]): number {
  let crc = 0xffff
  for (const byte of bytes) {
    crc ^= byte << 8
    for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc
}

/** Bytes to a code with its prefix and checksum. Exported for the codec tests. */
export function packCode(kind: CodeKind, payload: number[]): string {
  const crc = crc16(payload)
  return `P${VERSION}${kind === 'offer' ? 'H' : 'G'}${toBase32([...payload, crc >> 8, crc & 255])}`
}

/** The payload of a code, after the prefix, spelling and checksum are checked. Exported for the codec tests. */
export function unpackCode(input: string, expected: CodeKind): number[] {
  if (input.length > CODE_INPUT_MAX * 2) throw new P2PError('typo')
  const normal = normalise(input)
  if (normal.length > CODE_INPUT_MAX) throw new P2PError('typo')
  const match = /^P(\d)([HG])(.*)$/.exec(normal)
  if (!match) throw new P2PError('typo')
  if (match[1] !== String(VERSION)) throw new P2PError('version')
  const kind = match[2] === 'H' ? 'offer' : 'answer'
  if (kind !== expected) throw new P2PError('wrong-kind', expected === 'offer' ? P2P_MESSAGES['wrong-kind'] : "That's the host's code. Scan the guest's reply instead.")
  const bytes = fromBase32(match[3])
  if (!bytes || bytes.length < 3) throw new P2PError('typo')
  const payload = bytes.slice(0, -2)
  const crc = crc16(payload)
  if (bytes.at(-2) !== crc >> 8 || bytes.at(-1) !== (crc & 255)) throw new P2PError('typo')
  return payload
}

// ---------- fields to bytes ----------

function hexToBytes(hex: string): number[] {
  return (hex.match(/../g) ?? []).map((pair) => parseInt(pair, 16))
}

function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
}

function packIce(text: string): number[] {
  if (text.length < 1 || text.length > 255) throw new P2PError('unsupported')
  const out = [text.length]
  let bits = 0
  let acc = 0
  for (const char of text) {
    const value = ICE_CHARS.indexOf(char)
    if (value < 0) throw new P2PError('unsupported')
    acc = (acc << 6) | value
    bits += 6
    while (bits >= 8) {
      out.push((acc >> (bits - 8)) & 255)
      bits -= 8
    }
    acc &= (1 << bits) - 1
  }
  if (bits > 0) out.push((acc << (8 - bits)) & 255)
  return out
}

function ipv4Bytes(address: string): number[] {
  return address.split('.').map(Number)
}

/** Sixteen bytes from an IPv6 address, or null if it isn't a plain one. */
function ipv6Bytes(address: string): number[] | null {
  const halves = address.split('::')
  if (halves.length > 2 || !/^[0-9a-f:]+$/i.test(address)) return null
  const groups = (part: string) => (part === '' ? [] : part.split(':'))
  const head = groups(halves[0])
  const tail = halves.length === 2 ? groups(halves[1]) : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const all = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  if (all.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null
  return all.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 255])
}

function ipv6Text(bytes: number[]): string {
  const groups: string[] = []
  for (let i = 0; i < 16; i += 2) groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16).padStart(4, '0'))
  return groups.join(':')
}

function packCandidate(candidate: Candidate): number[] {
  const family = FAMILIES.indexOf(candidate.family)
  const address =
    candidate.family === 'v4'
      ? ipv4Bytes(candidate.address)
      : candidate.family === 'v6'
        ? ipv6Bytes(candidate.address)!
        : hexToBytes(candidate.address.replace(/\.local$/, '').replace(/-/g, ''))
  return [family, ...address, candidate.port >> 8, candidate.port & 255]
}

function packSignal(signal: Signal): number[] {
  const algo = ALGOS.indexOf(signal.fingerprint.algo)
  if (algo < 0 || signal.fingerprint.hash.length !== HASH_BYTES[signal.fingerprint.algo] * 2) throw new P2PError('unsupported')
  if (signal.candidates.length > MAX_CANDIDATES) throw new P2PError('unsupported')
  return [
    (VERSION << 4) | (signal.kind === 'answer' ? 8 : 0) | (SETUPS.indexOf(signal.setup) << 1),
    ...hexToBytes(signal.offerId),
    ...packIce(signal.ufrag),
    ...packIce(signal.pwd),
    algo + 1,
    ...hexToBytes(signal.fingerprint.hash),
    signal.candidates.length,
    ...signal.candidates.flatMap(packCandidate),
  ]
}

/** The text of a code for this signal. Throws P2PError unsupported for a login or fingerprint this format can't hold. */
export function encodeSignal(signal: Signal): string {
  return packCode(signal.kind, packSignal(signal))
}

// ---------- bytes to fields ----------

class Reader {
  private readonly bytes: number[]
  private at = 0

  constructor(bytes: number[]) {
    this.bytes = bytes
  }

  take(count: number): number[] {
    if (this.at + count > this.bytes.length) throw new P2PError('typo')
    const out = this.bytes.slice(this.at, this.at + count)
    this.at += count
    return out
  }

  byte(): number {
    return this.take(1)[0]
  }

  get done(): boolean {
    return this.at === this.bytes.length
  }
}

function unpackIce(reader: Reader): string {
  const length = reader.byte()
  if (length < 1) throw new P2PError('typo')
  const bytes = reader.take(Math.ceil((length * 6) / 8))
  let text = ''
  let bits = 0
  let acc = 0
  for (const byte of bytes) {
    acc = (acc << 8) | byte
    bits += 8
    while (bits >= 6 && text.length < length) {
      text += ICE_CHARS[(acc >> (bits - 6)) & 63]
      bits -= 6
    }
    acc &= (1 << bits) - 1
  }
  // What is left over is padding; a typo can't hide in it.
  if (acc !== 0) throw new P2PError('typo')
  return text
}

function unpackCandidate(reader: Reader): Candidate {
  const family = FAMILIES[reader.byte()]
  if (!family) throw new P2PError('typo')
  const raw = reader.take(family === 'v4' ? 4 : 16)
  const port = (reader.byte() << 8) | reader.byte()
  if (family === 'v4') return { family, address: raw.join('.'), port }
  if (family === 'v6') return { family, address: ipv6Text(raw), port }
  const hex = bytesToHex(raw)
  return { family, address: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}.local`, port }
}

/** Reads a code of the `expected` kind. Throws P2PError typo | wrong-kind | version. */
export function decodeSignal(input: string, expected: CodeKind): Signal {
  const reader = new Reader(unpackCode(input, expected))
  const header = reader.byte()
  const setup = SETUPS[(header >> 1) & 3]
  const kind = header & 8 ? 'answer' : 'offer'
  if (header >> 4 !== VERSION || kind !== expected || !setup || header & 1) throw new P2PError('typo')
  const offerId = bytesToHex(reader.take(4))
  const ufrag = unpackIce(reader)
  const pwd = unpackIce(reader)
  const algo = ALGOS[reader.byte() - 1]
  if (!algo) throw new P2PError('version')
  const hash = bytesToHex(reader.take(HASH_BYTES[algo]))
  const count = reader.byte()
  if (count > MAX_CANDIDATES) throw new P2PError('typo')
  const candidates = Array.from({ length: count }, () => unpackCandidate(reader))
  if (!reader.done) throw new P2PError('typo')
  return { kind, offerId, setup, ufrag, pwd, fingerprint: { algo, hash }, candidates }
}

// ---------- SDP ----------

function attribute(lines: string[], name: string): string | undefined {
  const prefix = `a=${name}:`
  return lines.find((line) => line.startsWith(prefix))?.slice(prefix.length).trim()
}

/** A usable address for another phone, in the form the code keeps, or null. */
function candidateOf(address: string, port: number): Candidate | null {
  if (!(port > 0 && port < 65536)) return null
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) {
    const parts = ipv4Bytes(address)
    if (parts.some((p) => p > 255) || parts[0] === 127 || parts.every((p) => p === 0)) return null
    return { family: 'v4', address: parts.join('.'), port }
  }
  if (MDNS.test(address)) return { family: 'mdns', address: address.toLowerCase(), port }
  const bytes = ipv6Bytes(address)
  // Link-local (fe80::/10) can't be reached without a zone id, which a code can't carry.
  if (!bytes || bytes.every((b, i) => b === (i === 15 ? 1 : 0)) || bytes.every((b) => b === 0) || (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80)) return null
  return { family: 'v6', address: ipv6Text(bytes), port }
}

/**
 * The fields of a browser's SDP that the code keeps. Only UDP host candidates
 * are kept, IPv4 first, then `.local` names, then IPv6, up to six and as many
 * as fit the code budget. Throws P2PError unsupported if the SDP lacks a login,
 * fingerprint or setup role this format knows.
 */
export function signalFromSdp(sdp: string, kind: CodeKind, offerId: string): Signal {
  const lines = sdp.split(/\r?\n/)
  const ufrag = attribute(lines, 'ice-ufrag')
  const pwd = attribute(lines, 'ice-pwd')
  const setup = SETUPS.find((s) => s === attribute(lines, 'setup'))
  const fingerprints = lines.filter((line) => line.startsWith('a=fingerprint:')).map((line) => /^a=fingerprint:(\S+) (\S+)/.exec(line))
  const found = fingerprints.find((m) => m && ALGOS.includes(m[1].toLowerCase() as FingerprintAlgo))
  if (!ufrag || !pwd || !setup || !found) throw new P2PError('unsupported')
  const fingerprint = { algo: found[1].toLowerCase() as FingerprintAlgo, hash: found[2].replace(/:/g, '').toLowerCase() }

  const all: Candidate[] = []
  for (const line of lines) {
    const match = /^a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ host\b/i.exec(line)
    const candidate = match && candidateOf(match[1], Number(match[2]))
    if (candidate && !all.some((c) => c.address === candidate.address && c.port === candidate.port)) all.push(candidate)
  }
  const ordered = (['v4', 'mdns', 'v6'] as const).flatMap((family) => all.filter((c) => c.family === family))
  const base: Signal = { kind, offerId, setup, ufrag, pwd, fingerprint, candidates: [] }
  const candidates: Candidate[] = []
  for (const candidate of ordered) {
    if (candidates.length === MAX_CANDIDATES) break
    const trial = { ...base, candidates: [...candidates, candidate] }
    const length = PREFIX_LENGTH + Math.ceil(((packSignal(trial).length + 2) * 8) / 5)
    if (candidates.length === 0 || length <= CODE_BUDGET) candidates.push(candidate)
  }
  return { ...base, candidates }
}

/** A plain data-channel SDP for the other phone to set as its remote description. */
export function signalToSdp(signal: Signal): string {
  const hash = (signal.fingerprint.hash.toUpperCase().match(/../g) ?? []).join(':')
  const candidates = signal.candidates.map((c, i) => `a=candidate:${i + 1} 1 udp ${2130706431 - i} ${c.address} ${c.port} typ host`)
  return [
    'v=0',
    `o=- ${parseInt(signal.offerId, 16)} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    `a=ice-ufrag:${signal.ufrag}`,
    `a=ice-pwd:${signal.pwd}`,
    `a=fingerprint:${signal.fingerprint.algo} ${hash}`,
    `a=setup:${signal.setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:65536',
    ...candidates,
    'a=end-of-candidates',
    '',
  ].join('\r\n')
}
