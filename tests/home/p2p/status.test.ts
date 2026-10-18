import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loopbackPair } from '../../../src/home/p2p/channel'
import { encodeSignal, signalFromSdp } from '../../../src/home/p2p/codec'
import { P2P_MESSAGES, type Invite, type NearbyHost } from '../../../src/home/p2p/contract'
import { lineOverChannel } from '../../../src/home/p2p/guest-line'
import { startNearbyGuest } from '../../../src/home/p2p/guest'
import { startNearbyHost } from '../../../src/home/p2p/host'
import { PROTOCOL } from '../../../src/home/room'
import { chromeAnswer } from './fixtures'
import { FakeNetwork } from './fake-peer'
import { CONFIG, depsFor, exchange, seatKeyOf, sit } from './helpers'

/** Let promises and queued microtasks run, and the fake clock move on by `ms`. */
const wait = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

let host: NearbyHost | undefined

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  host?.close()
  host = undefined
  vi.useRealTimers()
})

function setup() {
  const net = new FakeNetwork()
  const deps = depsFor(net)
  const nearby = startNearbyHost({ config: CONFIG, cards: 'real' }, deps)
  host = nearby
  const history: Invite['status'][][] = []
  nearby.onInvites((list) => history.push(list.map((i) => i.status)))
  return { net, deps, host: nearby, history }
}

describe('host invites', () => {
  it('goes waiting, connecting, connected', async () => {
    const { deps, host, history } = setup()
    const invite = await host.createInvite()
    expect(invite).toMatchObject({ status: 'waiting', mdnsOnly: false })
    expect(invite.code).toMatch(/^P1H[0-9A-Z]+$/)
    const guest = startNearbyGuest(deps)
    const reply = await guest.answer(invite.code)
    expect(reply).toMatch(/^P1G/)
    await host.acceptAnswer(reply)
    await wait()
    expect(host.invites()).toEqual([{ ...invite, status: 'connected' }])
    expect(history).toEqual([['waiting'], ['connecting'], ['connected']])
  })

  it('marks an invite failed, unreachable, when the channel has not opened in 15 seconds', async () => {
    const { net, deps, host } = setup()
    net.connects = false
    const { invite } = await exchange(host, deps)
    await wait(14999)
    expect(host.invites()[0].status).toBe('connecting')
    await wait(1)
    expect(host.invites()).toEqual([{ ...invite, status: 'failed', error: 'unreachable' }])
    expect(net.peers[0].closed).toBe(true)
  })

  it('does not hold a failed invite against a new one', async () => {
    const { net, deps, host } = setup()
    net.connects = false
    await exchange(host, deps)
    await wait(15000)
    net.connects = true
    await exchange(host, deps)
    await wait()
    expect(host.invites().map((i) => i.status)).toEqual(['failed', 'connected'])
  })

  it('reports no network when the phone offers no addresses', async () => {
    const { net, host } = setup()
    net.addresses = 'none'
    await expect(host.createInvite()).rejects.toMatchObject({ code: 'no-network', message: P2P_MESSAGES['no-network'] })
    expect(net.peers[0].closed).toBe(true)
    expect(host.invites()).toEqual([])
  })

  it('stops waiting for ICE after the gather timeout and uses what it has', async () => {
    const { net, host } = setup()
    net.gathers = false
    const pending = host.createInvite()
    const result = expect(pending).rejects.toMatchObject({ code: 'no-network' })
    await wait(2499)
    expect(net.peers[0].closed).toBe(false)
    await wait(1)
    await result
  })

  it('says when every address is a .local name', async () => {
    const { net, host } = setup()
    net.addresses = 'mdns'
    expect((await host.createInvite()).mdnsOnly).toBe(true)
  })

  it('refuses a reply for an old, used or cancelled invite', async () => {
    const { deps, host } = setup()
    const other = startNearbyHost({ config: CONFIG, cards: 'real' }, deps)
    const strangerReply = await startNearbyGuest(deps).answer((await other.createInvite()).code)
    other.close()
    await expect(host.acceptAnswer(strangerReply)).rejects.toMatchObject({ code: 'stale', message: P2P_MESSAGES.stale })

    const { invite, reply } = await exchange(host, deps)
    await expect(host.acceptAnswer(reply)).rejects.toMatchObject({ code: 'stale' })
    host.cancelInvite(invite.id)
    expect(host.invites()).toEqual([])
    await expect(host.acceptAnswer(reply)).rejects.toMatchObject({ code: 'stale' })
  })

  it('refuses a mistyped reply, a host code, and a code from another version, leaving the invite waiting', async () => {
    const { deps, host } = setup()
    const invite = await host.createInvite()
    const reply = await startNearbyGuest(deps).answer(invite.code)
    const wrong = reply.slice(0, 20) + (reply[20] === '0' ? '1' : '0') + reply.slice(21)
    await expect(host.acceptAnswer(wrong)).rejects.toMatchObject({ code: 'typo' })
    await expect(host.acceptAnswer(invite.code)).rejects.toMatchObject({ code: 'wrong-kind' })
    await expect(host.acceptAnswer(reply.replace(/^P1/, 'P2'))).rejects.toMatchObject({ code: 'version' })
    expect(host.invites()[0].status).toBe('waiting')
    await host.acceptAnswer(reply)
    await wait()
    expect(host.invites()[0].status).toBe('connected')
  })

  it('closes a connected guest that goes silent for 30 seconds, and frees its seat', async () => {
    const { deps, host } = setup()
    const hana = sit(host.connector, 'hana', 'Hana')
    const { guest } = await exchange(host, deps)
    await wait()
    // This guest never starts a line, so it never says hello or pings.
    expect(host.invites()[0].status).toBe('connected')
    await wait(29999)
    expect(host.invites()).toHaveLength(1)
    await wait(1)
    expect(host.invites()).toEqual([])
    expect(hana.view().connected).toEqual(['hana'])
    guest.close()
  })

  it('keeps a guest whose line keeps pinging', async () => {
    const { deps, host } = setup()
    const { guest } = await exchange(host, deps)
    await wait()
    const ann = sit(guest.connector, 'ann', 'Ann')
    await wait(120000)
    expect(host.invites()[0].status).toBe('connected')
    expect(ann.view().connected).toEqual(['ann'])
  })

  it('keeps the link when a disconnected connection recovers inside the grace period', async () => {
    const { net, deps, host } = setup()
    const { guest } = await exchange(host, deps)
    await wait()
    sit(guest.connector, 'ann', 'Ann')
    net.peers[0].setState('disconnected')
    await wait(14000)
    net.peers[0].setState('connected')
    await wait(60000)
    expect(host.invites()[0].status).toBe('connected')
  })

  it('drops a connection that stays disconnected past the grace period', async () => {
    const { net, deps, host } = setup()
    const { guest } = await exchange(host, deps)
    await wait()
    const ann = sit(guest.connector, 'ann', 'Ann')
    await wait()
    net.peers[0].setState('disconnected')
    await wait(14999)
    expect(host.invites()).toHaveLength(1)
    await wait(1)
    expect(host.invites()).toEqual([])
    await wait()
    expect(ann.statuses.at(-1)).toEqual({ status: 'closed', detail: P2P_MESSAGES.hostLost })
  })

  it('stops hearing from an invite once the host closes', async () => {
    const { deps, host, history } = setup()
    await exchange(host, deps)
    host.close()
    const seen = history.length
    await wait(60000)
    expect(history).toHaveLength(seen)
    await expect(host.createInvite()).rejects.toMatchObject({ code: 'unsupported' })
  })
})

describe('guest', () => {
  it('turns away codes it cannot use', async () => {
    const { deps, host } = setup()
    const invite = await host.createInvite()
    const guest = startNearbyGuest(deps)
    await expect(guest.answer('P1H1234')).rejects.toMatchObject({ code: 'typo' })
    await expect(guest.answer(encodeSignal(signalFromSdp(chromeAnswer, 'answer', '0badc0de')))).rejects.toMatchObject({
      code: 'wrong-kind',
      message: P2P_MESSAGES['wrong-kind'],
    })
    await expect(guest.answer(invite.code.replace(/^P1/, 'P3'))).rejects.toMatchObject({ code: 'version' })
  })

  it('reports no network when it has no addresses to give', async () => {
    const { net, deps, host } = setup()
    const invite = await host.createInvite()
    net.addresses = 'none'
    await expect(startNearbyGuest(deps).answer(invite.code)).rejects.toMatchObject({ code: 'no-network' })
  })

  it('gives up with the unreachable message if the host never enters the reply', async () => {
    const { deps, host } = setup()
    const guest = startNearbyGuest(deps)
    await guest.answer((await host.createInvite()).code)
    const ann = sit(guest.connector, 'ann', 'Ann')
    expect(ann.statuses.map((s) => s.status)).toEqual(['connecting'])
    await wait(119999)
    expect(ann.statuses).toHaveLength(1)
    await wait(1)
    expect(ann.statuses.at(-1)).toEqual({ status: 'closed', detail: P2P_MESSAGES.unreachable })
  })

  it('does not close a connected channel when the reply timeout passes', async () => {
    const { deps, host } = setup()
    const { guest } = await exchange(host, deps)
    await wait(1000)
    const ann = sit(guest.connector, 'ann', 'Ann')
    await wait(200000)
    expect(ann.statuses.at(-1)?.status).toBe('open')
  })

  it('answers a connector asked for before there is a reply', () => {
    const ann = sit(startNearbyGuest(depsFor(new FakeNetwork())).connector, 'ann', 'Ann')
    expect(ann.statuses).toEqual([{ status: 'closed', detail: P2P_MESSAGES.unreachable }])
  })
})

describe('guest line', () => {
  it('hellos on open, pings every 10 seconds, and closes with hostLost after 30 seconds of silence', async () => {
    const [phone, silent] = loopbackPair()
    const got: unknown[] = []
    silent.onMessage((text) => got.push(JSON.parse(text)))
    const statuses: string[] = []
    lineOverChannel(phone, { playerId: 'ann', seatKey: seatKeyOf('ann'), name: 'Ann' }, {
      onStatus: (s, detail) => statuses.push(detail ? `${s}:${detail}` : s),
      onView: () => {},
      onError: () => {},
    })
    await wait()
    expect(got).toEqual([{ v: PROTOCOL, t: 'hello', playerId: 'ann', seatKey: seatKeyOf('ann'), name: 'Ann' }])
    await wait(30000)
    expect(got.filter((m) => (m as { t: string }).t === 'ping')).toHaveLength(3)
    expect(statuses).toEqual(['connecting'])
    await wait(10000)
    expect(statuses).toEqual(['connecting', `closed:${P2P_MESSAGES.hostLost}`])
    expect(phone.status).toBe('closed')
  })

  it('ignores messages from another protocol version and ones that are not JSON', async () => {
    const [phone, hostEnd] = loopbackPair()
    const views: unknown[] = []
    const statuses: string[] = []
    lineOverChannel(phone, { playerId: 'ann', seatKey: seatKeyOf('ann') }, { onStatus: (s) => statuses.push(s), onView: (v) => views.push(v), onError: () => {} })
    hostEnd.send(JSON.stringify({ v: PROTOCOL - 1, t: 'state', view: {} }))
    hostEnd.send('not json')
    hostEnd.send(JSON.stringify({ v: PROTOCOL, t: 'state', view: { ok: true } }))
    await wait()
    expect(views).toEqual([{ ok: true }])
    expect(statuses).toEqual(['connecting', 'open'])
  })
})
