import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { P2PError } from '../../../src/home/p2p/contract'
import { startNearbyHost } from '../../../src/home/p2p/host'
import { clearNearbyRoom, loadNearbyRoom, saveNearbyRoom } from '../../../src/home/p2p/saved'
import { nearbySupported } from '../../../src/home/p2p/peer'
import { qrMatrix, qrScanSupported, startQrScan } from '../../../src/home/p2p/qr'
import { newTable } from '../../../src/home/table'
import { FakeNetwork } from './fake-peer'
import { CONFIG, depsFor, exchange, flush, sit } from './helpers'

const KEY = 'poker.home.nearby'

let store: Map<string, string>

beforeEach(() => {
  store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the saved nearby table', () => {
  it('is written when the table is made and on every change', async () => {
    const net = new FakeNetwork()
    const host = startNearbyHost({ config: CONFIG, cards: 'online' }, depsFor(net, { now: () => 1234 }))
    expect(loadNearbyRoom()).toMatchObject({ v: 1, roomId: host.roomId, hostToken: host.hostToken, savedAt: 1234, keys: {} })
    const hana = sit(host.connector, 'hana', 'Hana')
    await flush()
    const saved = loadNearbyRoom()!
    expect(saved.state.players.map((p) => p.name)).toEqual(['Hana'])
    expect(Object.keys(saved.keys)).toEqual(['hana'])
    hana.line.send({ type: 'configure', config: { ...CONFIG, bigBlind: 20 } })
    await flush()
    expect(loadNearbyRoom()!.state.config.bigBlind).toBe(20)
    host.close()
    expect(loadNearbyRoom()).not.toBeNull()
  })

  it('brings back the same table, seats and keys after a reload, and each guest rejoins with a new invite', async () => {
    const net = new FakeNetwork()
    const deps = depsFor(net)
    const first = startNearbyHost({ config: CONFIG, cards: 'online' }, deps)
    const hana = sit(first.connector, 'hana', 'Hana')
    const { guest } = await exchange(first, deps)
    await flush()
    const ann = sit(guest.connector, 'ann', 'Ann')
    await flush()
    hana.line.send({ type: 'startHand' })
    await flush()
    const before = hana.view()
    first.close()

    const saved = loadNearbyRoom()!
    const second = startNearbyHost({ resume: saved }, deps)
    expect(second.roomId).toBe(first.roomId)
    expect(second.hostToken).toBe(first.hostToken)
    const hanaAgain = sit(second.connector, 'hana')
    await flush()
    const after = hanaAgain.view()
    expect(after.you.isHost).toBe(true)
    expect(after.players.map((p) => [p.id, p.stack, p.holeCards])).toEqual(before.players.map((p) => [p.id, p.stack, p.holeCards]))
    expect(after.phase).toBe(before.phase)
    expect(after.connected).toEqual(['hana'])

    const again = await exchange(second, deps)
    await flush()
    const annAgain = sit(again.guest.connector, 'ann')
    await flush()
    expect(annAgain.view().players.find((p) => p.id === 'ann')!.holeCards).toEqual(ann.view().players.find((p) => p.id === 'ann')!.holeCards)
    second.close()
  })

  it('is forgotten when the game ends', () => {
    startNearbyHost({ config: CONFIG, cards: 'real' }, depsFor(new FakeNetwork())).close()
    expect(loadNearbyRoom()).not.toBeNull()
    clearNearbyRoom()
    expect(loadNearbyRoom()).toBeNull()
  })

  it('reads nothing from a save that is missing, from another version or malformed', () => {
    expect(loadNearbyRoom()).toBeNull()
    const good = { v: 1, roomId: 'r', hostToken: 't', state: newTable(CONFIG), keys: { ann: 'k' }, savedAt: 1 }
    saveNearbyRoom(good)
    expect(loadNearbyRoom()).toEqual(JSON.parse(JSON.stringify(good)))
    const bad: unknown[] = [
      'text',
      [],
      { ...good, v: 2 },
      { ...good, roomId: 7 },
      { ...good, hostToken: undefined },
      { ...good, savedAt: 'now' },
      { ...good, state: null },
      { ...good, state: { players: 'none', config: {} } },
      { ...good, state: { players: [], config: null } },
      { ...good, keys: null },
      { ...good, keys: { ann: 5 } },
    ]
    for (const value of bad) {
      store.set(KEY, JSON.stringify(value))
      expect(loadNearbyRoom(), JSON.stringify(value)).toBeNull()
    }
    store.set(KEY, '{not json')
    expect(loadNearbyRoom()).toBeNull()
  })
})

describe('browser support', () => {
  it('knows when there is no WebRTC or no scanner (plain node has neither)', async () => {
    expect(nearbySupported()).toBe(false)
    expect(qrScanSupported()).toBe(false)
    await expect(startQrScan({} as HTMLVideoElement, () => {})).rejects.toBeInstanceOf(P2PError)
    await expect(startQrScan({} as HTMLVideoElement, () => {})).rejects.toMatchObject({ code: 'camera' })
    await expect(startNearbyHost({ config: CONFIG, cards: 'real' }).createInvite()).rejects.toMatchObject({ code: 'unsupported' })
  })
})

describe('QR codes', () => {
  it('draws a square matrix for a code, small enough for a phone screen', () => {
    const matrix = qrMatrix('P1H' + '0'.repeat(114))
    expect(matrix.length).toBeGreaterThanOrEqual(21)
    expect(matrix.every((row) => row.length === matrix.length)).toBe(true)
    // 117 characters in alphanumeric mode, level L, is QR version 5 (37 modules).
    expect(matrix).toHaveLength(37)
    expect(matrix[0][0]).toBe(true)
    expect(qrMatrix('P1H' + '0'.repeat(194))).toHaveLength(45)
  })
})
