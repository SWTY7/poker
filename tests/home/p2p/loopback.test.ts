import { afterEach, describe, expect, it } from 'vitest'
import { decodeSignal } from '../../../src/home/p2p/codec'
import { startNearbyHost } from '../../../src/home/p2p/host'
import { startNearbyGuest } from '../../../src/home/p2p/guest'
import type { NearbyGuest, NearbyHost } from '../../../src/home/p2p/contract'
import { chipsInPlay, options } from '../../../src/home/table'
import { FakeNetwork } from './fake-peer'
import { CONFIG, depsFor, exchange, flush, sit, type Phone } from './helpers'

/** A host and its guests, all through the real codes and the real room, over fake WebRTC. */
const open: { host?: NearbyHost; guests: NearbyGuest[] } = { guests: [] }

afterEach(() => {
  open.host?.close()
  for (const guest of open.guests) guest.close()
  open.guests = []
})

async function table() {
  const net = new FakeNetwork()
  const deps = depsFor(net)
  const host = startNearbyHost({ config: CONFIG, cards: 'online' }, deps)
  open.host = host
  const hana = sit(host.connector, 'hana', 'Hana')
  const join = async (playerId: string, name?: string, seatKey?: string) => {
    const { guest } = await exchange(host, deps)
    open.guests.push(guest)
    await flush()
    const phone = sit(guest.connector, playerId, name, seatKey)
    await flush()
    return phone
  }
  return { net, deps, host, hana, join }
}

/** Everyone checks or calls until the hand is over. */
async function playOut(phones: Record<string, Phone>) {
  const watcher = Object.values(phones)[0]
  for (let step = 0; step < 100 && watcher.view().phase === 'betting'; step++) {
    const view = watcher.view()
    const actor = view.players[view.currentPlayerIndex].id
    const actions = options(view, actor)!.actions
    phones[actor].line.send({ type: 'act', playerId: actor, action: actions.includes('check') ? 'check' : 'call' })
    await flush()
  }
}

describe('a nearby table over fake WebRTC', () => {
  it('seats the host and two guests, who join through the real code strings', async () => {
    const { hana, join, host } = await table()
    const ann = await join('ann', 'Ann')
    const ben = await join('ben', 'Ben')
    expect(new Set(hana.statuses.map((s) => s.status))).toEqual(new Set(['connecting', 'open']))
    expect(ann.statuses.map((s) => s.status)).toContain('open')
    expect(ben.view().players.map((p) => p.name)).toEqual(['Hana', 'Ann', 'Ben'])
    expect(hana.view().you.isHost).toBe(true)
    expect(ann.view().you).toEqual({ playerId: 'ann', isHost: false })
    expect(hana.view().connected.sort()).toEqual(['ann', 'ben', 'hana'])
    expect(host.invites().map((i) => i.status)).toEqual(['connected', 'connected'])
  })

  it('plays an online-cards hand to a result, each phone seeing only its own hole cards', async () => {
    const { hana, join } = await table()
    const ann = await join('ann', 'Ann')
    const ben = await join('ben', 'Ben')
    hana.line.send({ type: 'startHand' })
    await flush()
    const phones = { hana, ann, ben }
    for (const [id, phone] of Object.entries(phones)) {
      for (const player of phone.view().players) expect(player.holeCards, `${id} sees ${player.id}`).toHaveLength(player.id === id ? 2 : 0)
      expect(phone.view().deck).toEqual([])
    }
    await playOut(phones)
    const done = ann.view()
    expect(done.phase).toBe('hand-over')
    expect(done.lastResults.length).toBeGreaterThan(0)
    expect(done.board).toHaveLength(5)
    expect(chipsInPlay(done)).toBe(3000)
    expect(hana.view().handNumber).toBe(1)
    expect(ben.view().players.map((p) => p.stack)).toEqual(done.players.map((p) => p.stack))
  })

  it('keeps a seat mid-hand when a phone drops and rejoins through a new invite', async () => {
    const { net, hana, join, host } = await table()
    const ann = await join('ann', 'Ann')
    const ben = await join('ben', 'Ben')
    hana.line.send({ type: 'startHand' })
    await flush()
    const hole = ben.view().players.find((p) => p.id === 'ben')!.holeCards
    expect(hole).toHaveLength(2)

    // Ben's connection dies: the last two peers made are his.
    net.peers.at(-2)!.drop()
    await flush()
    expect(ben.statuses.at(-1)).toMatchObject({ status: 'closed' })
    expect(ben.statuses.at(-1)!.detail).toContain('Lost the host')
    expect(hana.view().connected.sort()).toEqual(['ann', 'hana'])
    expect(host.invites()).toHaveLength(1)

    const again = await join('ben')
    expect(again.view().you.playerId).toBe('ben')
    expect(again.view().players.find((p) => p.id === 'ben')!.holeCards).toEqual(hole)
    expect(again.view().players).toHaveLength(3)
    expect(hana.view().connected.sort()).toEqual(['ann', 'ben', 'hana'])
    await playOut({ hana, ann, ben: again })
    expect(ann.view().phase).toBe('hand-over')
  })

  it('refuses a phone that claims a seat with the wrong key', async () => {
    const { join, hana } = await table()
    await join('ann', 'Ann')
    const thief = await join('ann', 'Ann', 'not-the-key-0123456789')
    expect(thief.errors).toEqual(['That seat belongs to another phone.'])
    expect(thief.views).toEqual([])
    expect(hana.view().players.filter((p) => p.id === 'ann')).toHaveLength(1)
  })

  it('lets only the host deal, even from a guest phone', async () => {
    const { join } = await table()
    const ann = await join('ann', 'Ann')
    ann.line.send({ type: 'startHand' })
    await flush()
    expect(ann.errors).toEqual(['Only the host can do that.'])
  })

  it('serves a second mount of the host line, as React strict mode does', async () => {
    const { host, join } = await table()
    const first = sit(host.connector, 'hana', 'Hana')
    first.line.close()
    const second = sit(host.connector, 'hana', 'Hana')
    const ann = await join('ann', 'Ann')
    await flush()
    expect(second.view().players.map((p) => p.name)).toEqual(['Hana', 'Ann'])
    expect(second.view().connected.sort()).toEqual(['ann', 'hana'])
    expect(ann.view().connected).toContain('hana')
  })

  it('serves a second mount of a guest line on the same connection', async () => {
    const { join } = await table()
    const ann = await join('ann', 'Ann')
    ann.line.close()
    expect(ann.statuses.at(-1)).toEqual({ status: 'closed', detail: undefined })
  })

  it('gives the guest the host’s code kind in its error when a reply is pasted as a host code', async () => {
    const { host, deps } = await table()
    const { reply } = await exchange(host, deps)
    await expect(startNearbyGuest(deps).answer(reply)).rejects.toMatchObject({ code: 'wrong-kind', message: "That's a reply code. Scan the host's code instead." })
    expect(decodeSignal(reply, 'answer').kind).toBe('answer')
  })
})
