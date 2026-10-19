import { describe, expect, it } from 'vitest'
import { dataChannelTransport, loopbackPair } from '../../../src/home/p2p/channel'
import { FRAME_MAX, MESSAGE_MAX, REASSEMBLE_MS, Reassembler, toFrames } from '../../../src/home/p2p/frame'
import { FakeNetwork } from './fake-peer'

const message = (size: number, fill = 'x') => JSON.stringify({ v: 2, t: 'state', pad: fill.repeat(size) })

describe('framing', () => {
  it('sends a short message as one frame, untouched', () => {
    const text = message(100)
    expect(toFrames(text, 'a')).toEqual([text])
    expect(new Reassembler().push(text)).toBe(text)
  })

  it('splits a 40 KB message into frames that fit, and puts it back', () => {
    const text = message(40000, 'ab')
    const frames = toFrames(text, 'k1')
    expect(frames.length).toBeGreaterThan(5)
    for (const frame of frames) expect(frame.length).toBeLessThanOrEqual(FRAME_MAX)
    const reassembler = new Reassembler()
    const results = frames.map((f) => reassembler.push(f))
    expect(results.slice(0, -1).every((r) => r === null)).toBe(true)
    expect(results.at(-1)).toBe(text)
  })

  it('keeps two long messages apart when their frames are interleaved', () => {
    const first = message(20000, 'a')
    const second = message(30000, 'b')
    const a = toFrames(first, 'one')
    const b = toFrames(second, 'two')
    const reassembler = new Reassembler()
    const done: string[] = []
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      for (const frames of [a, b]) {
        const out = i < frames.length ? reassembler.push(frames[i]) : null
        if (out) done.push(out)
      }
    }
    expect(done.sort()).toEqual([first, second].sort())
  })

  it('takes frames out of order, and ignores a repeated one', () => {
    const text = message(25000)
    const frames = toFrames(text, 'z')
    const reassembler = new Reassembler()
    const shuffled = [frames[2], frames[0], frames[0], ...frames.slice(3), frames[1]]
    const results = shuffled.map((f) => reassembler.push(f))
    expect(results.filter((r) => r !== null)).toEqual([text])
  })

  it('does not cut an emoji in half', () => {
    const text = JSON.stringify({ name: '🂡'.repeat(9000) })
    const frames = toFrames(text, 'e')
    for (const frame of frames) expect(frame).not.toMatch(/[\ud800-\udbff]$/)
    const reassembler = new Reassembler()
    expect(frames.map((f) => reassembler.push(f)).at(-1)).toBe(text)
  })

  it('drops a message whose missing frame never comes', () => {
    let now = 0
    const reassembler = new Reassembler(() => now)
    const frames = toFrames(message(30000), 'late')
    for (const frame of frames.slice(0, -1)) reassembler.push(frame)
    now = REASSEMBLE_MS + 1
    expect(reassembler.push(frames.at(-1)!)).toBeNull()
    // The same message sent again whole is fine.
    expect(toFrames(message(30000), 'again').map((f) => reassembler.push(f)).at(-1)).toBe(message(30000))
  })

  it('refuses a message over 1 MB', () => {
    const reassembler = new Reassembler()
    expect(reassembler.push(message(MESSAGE_MAX))).toBeNull()
    const frames = toFrames(message(MESSAGE_MAX - 100), 'big')
    expect(frames.map((f) => reassembler.push(f)).at(-1)).toBe(message(MESSAGE_MAX - 100))
    const tooBig = toFrames('{' + 'x'.repeat(MESSAGE_MAX + 5000), 'huge')
    expect(tooBig.map((f) => reassembler.push(f)).every((r) => r === null)).toBe(true)
  })

  it('ignores anything that is not a message or a chunk', () => {
    const reassembler = new Reassembler()
    for (const junk of ['', 'hello', '~', '~a.0.1:x', '~a.5.3:x', '~a.b.c:x', '~toolongid1.0.2:x']) expect(reassembler.push(junk)).toBeNull()
  })
})

describe('channels', () => {
  it('carries long messages over a data channel in frames', async () => {
    const net = new FakeNetwork()
    const a = net.createPeer()
    const b = net.createPeer()
    const ca = dataChannelTransport(a.createDataChannel('room'), a)
    const cb = dataChannelTransport(b.createDataChannel('room'), b)
    const got: string[] = []
    cb.onMessage((t) => got.push(t))
    await a.setRemoteDescription({ type: 'answer', sdp: `a=ice-ufrag:${b.ufrag}` })
    await b.setRemoteDescription({ type: 'offer', sdp: `a=ice-ufrag:${a.ufrag}` })
    await Promise.resolve()
    expect(ca.status).toBe('open')
    const text = message(30000)
    ca.send(text)
    ca.send(message(10))
    await new Promise((r) => setTimeout(r, 0))
    expect(got).toEqual([text, message(10)])
    expect(a.channel!.sent.every((f) => f.length <= FRAME_MAX)).toBe(true)
  })

  it('treats a channel that cannot send fast enough as dead', async () => {
    const net = new FakeNetwork()
    const a = net.createPeer()
    const b = net.createPeer()
    const channel = dataChannelTransport(a.createDataChannel('room'), a)
    b.createDataChannel('room')
    await a.setRemoteDescription({ type: 'answer', sdp: `a=ice-ufrag:${b.ufrag}` })
    await b.setRemoteDescription({ type: 'offer', sdp: `a=ice-ufrag:${a.ufrag}` })
    await Promise.resolve()
    const states: string[] = []
    channel.onStatus((s) => states.push(s))
    a.channel!.bufferedAmount = 2_000_000
    channel.send('{}')
    expect(states).toEqual(['closed'])
    expect(a.closed).toBe(true)
  })

  it('loops back a pair, and closing one end closes both', async () => {
    const [a, b] = loopbackPair()
    const got: string[] = []
    const states: string[] = []
    b.onMessage((t) => got.push(t))
    b.onStatus((s, why) => states.push(`${s}:${why ?? ''}`))
    a.send('one')
    a.send('two')
    expect(got).toEqual([])
    await Promise.resolve()
    expect(got).toEqual(['one', 'two'])
    a.close('bye')
    await Promise.resolve()
    expect(a.status).toBe('closed')
    expect(b.status).toBe('closed')
    expect(states).toEqual(['closed:bye'])
  })
})
