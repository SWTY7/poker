import { describe, expect, it } from 'vitest'
import { HostCore, PROTOCOL, isRoomCode, newPlayerId, roomCode, type ToJoiner } from '../../src/home/room'
import { HomeTableError, newTable, type HomeState } from '../../src/home/table'
import { createRng } from '../../src/utils/random'

const CONFIG = { startingStack: 1000, smallBlind: 5, bigBlind: 10, ante: 0 }

/** One joiner's phone: everything the host has sent it. */
function phone(host: HostCore, linkId: string) {
  const inbox: ToJoiner[] = []
  host.open(linkId, (m) => inbox.push(structuredClone(m)))
  return {
    inbox,
    send: (message: unknown) => host.receive(linkId, message),
    hello: (playerId: string, name: string) => host.receive(linkId, { v: PROTOCOL, t: 'hello', playerId, name }),
    act: (playerId: string, action: string, amount?: number) =>
      host.receive(linkId, { v: PROTOCOL, t: 'command', reqId: 1, command: { type: 'act', playerId, action, amount } }),
    last: () => inbox.at(-1),
    lastView: () => [...inbox].reverse().find((m) => m.t === 'state'),
  }
}

describe('room numbers and ids', () => {
  it('are four digits that never start with a zero', () => {
    const rng = createRng(3)
    for (let i = 0; i < 200; i++) expect(isRoomCode(roomCode(rng))).toBe(true)
    expect(isRoomCode('0123')).toBe(false)
    expect(isRoomCode('12345')).toBe(false)
    expect(newPlayerId(createRng(1))).toMatch(/^p-[a-z0-9]+$/)
  })
})

describe('joining', () => {
  it('seats a joiner, welcomes them, and shows everyone the new table', () => {
    const host = new HostCore(newTable(CONFIG))
    const ann = phone(host, 'a')
    const ben = phone(host, 'b')
    ann.hello('ann', 'Ann')
    expect(ann.inbox.map((m) => m.t)).toEqual(['welcome', 'state'])
    ben.hello('ben', 'Ben')
    const view = ann.lastView()
    expect(view?.t === 'state' && view.view.players.map((p) => p.name)).toEqual(['Ann', 'Ben'])
    expect(view?.t === 'state' && view.view.connected.sort()).toEqual(['ann', 'ben'])
  })

  it('tells a joiner why they can’t sit, and sends them no table', () => {
    const host = new HostCore(newTable(CONFIG))
    phone(host, 'a').hello('ann', 'Ann')
    const imposter = phone(host, 'x')
    imposter.hello('someone-else', 'ANN')
    expect(imposter.inbox).toEqual([{ v: PROTOCOL, t: 'error', message: 'Someone is already called ANN.' }])
  })

  it('puts a reconnecting phone back in its own seat', () => {
    const host = new HostCore(newTable(CONFIG))
    phone(host, 'a').hello('ann', 'Ann')
    phone(host, 'b').hello('ben', 'Ben')
    host.command({ type: 'startHand' })
    host.close('a')
    expect(host.connected()).toEqual(['ben'])
    const again = phone(host, 'a2')
    again.hello('ann', 'Ann')
    expect(host.state.players).toHaveLength(2)
    expect(host.connected().sort()).toEqual(['ann', 'ben'])
    expect(host.state.phase).toBe('betting')
  })

  it('ignores anything that isn’t a message it knows', () => {
    const host = new HostCore(newTable(CONFIG))
    const junk = phone(host, 'j')
    junk.send('hello')
    junk.send({ v: 99, t: 'hello', playerId: 'x', name: 'X' })
    junk.send({ v: PROTOCOL, t: 'hello', playerId: { evil: true }, name: 'X' })
    junk.send({ v: PROTOCOL, t: 'hello', playerId: 'x'.repeat(200), name: 'X' })
    expect(host.state.players).toHaveLength(0)
    expect(junk.inbox).toEqual([])
  })
})

describe('playing', () => {
  function seated(): { host: HostCore; ann: ReturnType<typeof phone>; ben: ReturnType<typeof phone>; saved: HomeState[] } {
    const saved: HomeState[] = []
    const host = new HostCore(newTable(CONFIG), (s) => saved.push(s))
    const ann = phone(host, 'a')
    const ben = phone(host, 'b')
    ann.hello('ann', 'Ann')
    ben.hello('ben', 'Ben')
    host.command({ type: 'startHand' })
    return { host, ann, ben, saved }
  }

  it('runs a joiner’s own action and shows the result to every phone', () => {
    const { host, ann, ben } = seated()
    // Heads-up: Ann has the button and acts first.
    ann.act('ann', 'call')
    expect(host.state.players[0].betThisStreet).toBe(10)
    const view = ben.lastView()
    expect(view?.t === 'state' && view.view.players[host.state.currentPlayerIndex].id).toBe('ben')
  })

  it('won’t let a joiner act for someone else, or run the dealer’s controls', () => {
    const { host, ann, ben } = seated()
    ben.act('ann', 'fold')
    expect(ben.last()).toMatchObject({ t: 'error', message: 'Only the host can do that.' })
    ben.send({ v: PROTOCOL, t: 'command', reqId: 2, command: { type: 'adjustStack', id: 'ben', stack: 99999 } })
    expect(ben.last()).toMatchObject({ t: 'error', message: 'Only the host can do that.', reqId: 2 })
    expect(host.state.players[1].stack).toBe(990)
    expect(ann.last()?.t).toBe('state')
  })

  it('answers an illegal move with the table’s own reason, to that phone only', () => {
    const { ann, ben } = seated()
    const benBefore = ben.inbox.length
    ann.act('ann', 'raise', 12)
    expect(ann.last()).toMatchObject({ t: 'error', message: 'The minimum is 20.' })
    expect(ben.inbox.length).toBe(benBefore)
  })

  it('lets the host act for a player, and throws the reason for the host’s own screen', () => {
    const { host } = seated()
    host.command({ type: 'act', playerId: 'ann', action: 'fold' })
    expect(host.state.phase).toBe('hand-over')
    expect(() => host.command({ type: 'advanceStreet' })).toThrow(HomeTableError)
  })

  it('saves the table after every change, so a host reload can restore it', () => {
    const { ann, saved } = seated()
    const before = saved.length
    ann.act('ann', 'call')
    expect(saved.length).toBe(before + 1)
    expect(saved.at(-1)?.players[0].betThisStreet).toBe(10)
  })

  it('sends phones the table without the undo history, but says whether undo is possible', () => {
    const { ann } = seated()
    ann.act('ann', 'call')
    const view = ann.lastView()
    expect(view?.t === 'state' && 'undo' in view.view).toBe(false)
    expect(view?.t === 'state' && view.view.canUndo).toBe(true)
  })

  it('answers a ping', () => {
    const { ann } = seated()
    ann.send({ v: PROTOCOL, t: 'ping' })
    expect(ann.last()).toEqual({ v: PROTOCOL, t: 'pong' })
  })
})
