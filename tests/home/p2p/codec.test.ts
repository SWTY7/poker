import { describe, expect, it } from 'vitest'
import { CODE_BUDGET, decodeSignal, encodeSignal, groupCode, newOfferId, packCode, peekKind, signalFromSdp, signalToSdp, unpackCode, type Signal } from '../../../src/home/p2p/codec'
import { P2PError, type P2PErrorCode } from '../../../src/home/p2p/contract'
import { FIXTURES, chromeAnswer, chromeOffer, crowdedOffer, safariOffer } from './fixtures'

const ID = 'a1b2c3d4'
const signalOf = (f: { kind: 'offer' | 'answer'; sdp: string }, id = ID) => signalFromSdp(f.sdp, f.kind, id)

function codeOf(fn: () => unknown): P2PErrorCode | 'no error' {
  try {
    fn()
  } catch (error) {
    if (error instanceof P2PError) return error.code
    throw error
  }
  return 'no error'
}

describe('signal codec', () => {
  it('round-trips real-shaped offers and answers from Chrome, Safari and Firefox', () => {
    for (const fixture of FIXTURES) {
      const signal = signalOf(fixture)
      expect(signal.candidates.length, fixture.name).toBeGreaterThan(0)
      expect(decodeSignal(encodeSignal(signal), fixture.kind), fixture.name).toEqual(signal)
    }
  })

  it('rebuilds an SDP that parses back to the same fields', () => {
    for (const fixture of FIXTURES) {
      const signal = signalOf(fixture)
      const sdp = signalToSdp(signal)
      expect(signalFromSdp(sdp, signal.kind, signal.offerId), fixture.name).toEqual(signal)
      expect(sdp).toContain('m=application 9 UDP/DTLS/SCTP webrtc-datachannel')
      expect(sdp).toContain(`a=setup:${signal.setup}`)
    }
  })

  it('keeps every fixture inside the character budget', () => {
    const lengths = FIXTURES.map((f) => encodeSignal(signalOf(f)).length)
    expect(Math.max(...lengths)).toBeLessThanOrEqual(CODE_BUDGET)
    expect(CODE_BUDGET).toBe(224)
    // One Chrome IPv4 candidate: about 117 characters, short enough to type.
    const small = encodeSignal({ ...signalOf(FIXTURES[1]), candidates: [{ family: 'v4', address: '192.168.43.1', port: 40236 }] })
    expect(small.length).toBe(117)
  })

  it('catches any single changed character as a typo', () => {
    const code = encodeSignal(signalOf(FIXTURES[0]))
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
    for (let i = 3; i < code.length; i++) {
      const other = alphabet[(alphabet.indexOf(code[i]) + 7) % 32]
      expect(codeOf(() => decodeSignal(code.slice(0, i) + other + code.slice(i + 1), 'offer')), `char ${i}`).toBe('typo')
    }
    expect(codeOf(() => decodeSignal(code + '0', 'offer')), 'a stray extra character').toBe('typo')
    expect(codeOf(() => decodeSignal(code.slice(0, -1), 'offer')), 'a dropped character').toBe('typo')
    expect(codeOf(() => decodeSignal('hello', 'offer'))).toBe('typo')
    expect(codeOf(() => decodeSignal('', 'offer'))).toBe('typo')
  })

  it('reads a code however it was typed', () => {
    const signal = signalOf(FIXTURES[2])
    const code = encodeSignal(signal)
    const sloppy = [
      code.toLowerCase(),
      groupCode(code),
      groupCode(code).replace(/ /g, '-'),
      `  ${groupCode(code).replace(/ /g, '\n')}  `,
      code.replace(/0/g, 'O').replace(/1/g, 'l'),
      code.replace(/1/g, 'I').toLowerCase(),
    ]
    for (const text of sloppy) expect(decodeSignal(text, 'offer')).toEqual(signal)
  })

  it('tells a reply code from a host code', () => {
    const offer = encodeSignal(signalOf(FIXTURES[0]))
    const answer = encodeSignal(signalOf(FIXTURES[1]))
    expect(codeOf(() => decodeSignal(answer, 'offer'))).toBe('wrong-kind')
    expect(codeOf(() => decodeSignal(offer, 'answer'))).toBe('wrong-kind')
    expect(peekKind(offer)).toBe('offer')
    expect(peekKind(groupCode(answer).toLowerCase())).toBe('answer')
    expect(peekKind('hello there')).toBeNull()
  })

  it('refuses a code from another version', () => {
    const code = encodeSignal(signalOf(FIXTURES[0]))
    expect(codeOf(() => decodeSignal(code.replace(/^P1/, 'P2'), 'offer'))).toBe('version')
  })

  it('refuses to encode a description without a login or fingerprint', () => {
    const noFingerprint = chromeOffer.replace(/a=fingerprint:.*\r\n/, '')
    const noUfrag = chromeOffer.replace(/a=ice-ufrag:.*\r\n/, '')
    const sha1 = chromeOffer.replace('a=fingerprint:sha-256', 'a=fingerprint:sha-1')
    for (const sdp of [noFingerprint, noUfrag, sha1]) expect(codeOf(() => signalFromSdp(sdp, 'offer', ID))).toBe('unsupported')
    const signal = signalOf(FIXTURES[0])
    expect(codeOf(() => encodeSignal({ ...signal, ufrag: 'bad char!' }))).toBe('unsupported')
    expect(codeOf(() => encodeSignal({ ...signal, fingerprint: { algo: 'sha-256', hash: 'abcd' } }))).toBe('unsupported')
  })

  it('keeps at most six UDP host candidates, IPv4 first, and never TCP or link-local', () => {
    const signal = signalOf({ kind: 'offer', sdp: crowdedOffer })
    expect(signal.candidates).toHaveLength(6)
    expect(signal.candidates.map((c) => c.family)).toEqual(['v4', 'v4', 'v4', 'v4', 'mdns', 'v6'])
    expect(signal.candidates.map((c) => c.port)).toEqual([40005, 40006, 40007, 40009, 40003, 40001])
    expect(encodeSignal(signal).length).toBeLessThanOrEqual(CODE_BUDGET)

    const safari = signalOf({ kind: 'offer', sdp: safariOffer })
    expect(safari.candidates.map((c) => c.address)).toEqual(['172.20.10.4', '2001:0db8:3c4d:0015:6a2f:1bff:fe0c:7d21'])
  })

  it('drops candidates that would not fit, before it drops the connection details', () => {
    const many = Array.from({ length: 5 }, (_, i) => `a=candidate:${i} 1 udp 2113937151 7c18b9e7-7278-41cc-9f86-f8d354e1607${i}.local 4000${i} typ host`)
    const sdp = chromeOffer.replace(/a=candidate:.*\r\n/g, '').replace('a=ice-ufrag', `${many.join('\r\n')}\r\na=ice-ufrag`)
    const signal = signalFromSdp(sdp, 'offer', ID)
    expect(signal.candidates.length).toBeGreaterThanOrEqual(1)
    expect(signal.candidates.length).toBeLessThan(5)
    expect(encodeSignal(signal).length).toBeLessThanOrEqual(CODE_BUDGET)
  })

  it('rejects a fingerprint algorithm it does not know', () => {
    const code = encodeSignal(signalOf(FIXTURES[0]))
    const bytes = unpackCode(code, 'offer')
    // header, offer id, then the two logins (a length byte and 6 bits a character each), then the algorithm.
    const loginBytes = (at: number) => 1 + Math.ceil((bytes[at] * 6) / 8)
    const algoAt = 5 + loginBytes(5) + loginBytes(5 + loginBytes(5))
    expect(bytes[algoAt]).toBe(1)
    bytes[algoAt] = 9
    expect(codeOf(() => decodeSignal(packCode('offer', bytes), 'offer'))).toBe('version')
  })

  it('rejects absurdly long input as a typo', () => {
    const code = encodeSignal(signalOf(FIXTURES[0]))
    expect(codeOf(() => decodeSignal(code + '0'.repeat(500), 'offer'))).toBe('typo')
    expect(codeOf(() => decodeSignal(' '.repeat(5000) + code, 'offer'))).toBe('typo')
  })

  it('rejects non-zero padding bits at the end of a login', () => {
    const bytes = unpackCode(encodeSignal(signalOf(FIXTURES[0])), 'offer')
    const length = bytes[5]
    const used = length * 6
    const padding = Math.ceil(used / 8) * 8 - used
    if (padding === 0) return
    expect(codeOf(() => decodeSignal(packCode('offer', bytes), 'offer'))).toBe('no error')
    bytes[5 + Math.ceil(used / 8)] |= 1
    expect(codeOf(() => decodeSignal(packCode('offer', bytes), 'offer'))).toBe('typo')
  })

  it('carries the offer id from the host code into the reply', () => {
    const id = newOfferId()
    expect(id).toMatch(/^[0-9a-f]{8}$/)
    const offer = decodeSignal(encodeSignal(signalFromSdp(chromeOffer, 'offer', id)), 'offer')
    const reply: Signal = decodeSignal(encodeSignal(signalFromSdp(chromeAnswer, 'answer', offer.offerId)), 'answer')
    expect(reply.offerId).toBe(id)
  })
})
