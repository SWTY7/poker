import { afterEach, describe, expect, it } from 'vitest'
import { startNearbyGuest } from '../../../src/home/p2p/guest'
import { startNearbyHost } from '../../../src/home/p2p/host'
import type { NearbyGuest, NearbyHost } from '../../../src/home/p2p/contract'
import { FakeNetwork } from './fake-peer'
import { CONFIG, depsFor, exchange, flush, sit } from './helpers'

const open: { host?: NearbyHost; guests: NearbyGuest[] } = { guests: [] }

afterEach(() => {
  open.host?.close()
  for (const guest of open.guests) guest.close()
  open.guests = []
})

describe('lines that fail', () => {
  it('a send that throws closes that line only; the other guests still get the update', async () => {
    const net = new FakeNetwork()
    const deps = depsFor(net)
    const host = startNearbyHost({ config: CONFIG, cards: 'online' }, deps)
    open.host = host
    const hana = sit(host.connector, 'hana', 'Hana')
    const phones = []
    for (const id of ['ann', 'ben']) {
      const { guest } = await exchange(host, deps)
      open.guests.push(guest)
      await flush()
      phones.push(sit(guest.connector, id, id))
      await flush()
    }
    const [ann, ben] = phones
    // Peers are made host, guest, host, guest: the host's end of ann's line is the first one.
    const annHostEnd = net.peers[0]
    annHostEnd.channel!.send = () => {
      throw new DOMException('closing', 'InvalidStateError')
    }
    const before = ben.views.length
    hana.line.send({ type: 'startHand' })
    await flush()
    expect(ben.views.length).toBeGreaterThan(before)
    expect(ben.view().handNumber).toBe(1)
    expect(annHostEnd.closed).toBe(true)
    expect(host.invites().map((i) => i.status)).toEqual(['connected'])
    expect(ann.view().handNumber).toBe(0)
  })

  it('a guest that leaves while its reply is being made leaves no peer behind', async () => {
    const net = new FakeNetwork()
    const deps = depsFor(net)
    const host = startNearbyHost({ config: CONFIG, cards: 'online' }, deps)
    open.host = host
    const invite = await host.createInvite()
    const guest = startNearbyGuest(deps)
    const pending = guest.answer(invite.code)
    guest.close()
    await expect(pending).rejects.toMatchObject({ code: 'unreachable' })
    expect(net.peers[1].closed).toBe(true)
  })

  it('says whether the reply holds only .local names', async () => {
    const net = new FakeNetwork()
    net.addresses = 'mdns'
    const deps = depsFor(net)
    const host = startNearbyHost({ config: CONFIG, cards: 'online' }, deps)
    open.host = host
    const invite = await host.createInvite()
    const guest = startNearbyGuest(deps)
    open.guests.push(guest)
    expect(guest.mdnsOnly).toBe(false)
    await guest.answer(invite.code)
    expect(guest.mdnsOnly).toBe(true)
  })
})
