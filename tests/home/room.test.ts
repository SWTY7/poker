import { describe, expect, it } from 'vitest'
import { PROTOCOL, RoomCore, isRoomCode, newPlayerId, roomCode, type ToPhone, type TableView } from '../../src/home/room'
import { newTable, shuffledDeck, type CardMode } from '../../src/home/table'
import { createRng } from '../../src/utils/random'
import { RANKS, SUITS, type Card } from '../../src/poker/card'

const CONFIG = { startingStack: 1000, smallBlind: 5, bigBlind: 10, ante: 0 }
const TOKEN = 'host-secret'

function room(cards: CardMode = 'real', saves: unknown[] = []) {
  const rng = createRng(9)
  return new RoomCore(newTable(CONFIG, cards), TOKEN, () => shuffledDeck(rng), (s) => saves.push(s))
}

/** Each test phone's private seat key. */
const keyOf = (playerId: string) => `key-of-${playerId}-0123456789`

/** One phone: everything the room has sent it. */
function phone(core: RoomCore, linkId: string) {
  const inbox: ToPhone[] = []
  core.open(linkId, (m) => inbox.push(structuredClone(m)))
  return {
    inbox,
    send: (message: unknown) => core.receive(linkId, message),
    hello: (playerId: string, name?: string, hostToken?: string, seatKey = keyOf(playerId)) =>
      core.receive(linkId, { v: PROTOCOL, t: 'hello', playerId, seatKey, name, hostToken }),
    command: (command: unknown, reqId = 1) => core.receive(linkId, { v: PROTOCOL, t: 'command', reqId, command }),
    act: (playerId: string, action: string, amount?: number) =>
      core.receive(linkId, { v: PROTOCOL, t: 'command', reqId: 1, command: { type: 'act', playerId, action, amount } }),
    last: () => inbox.at(-1),
    view: (): TableView => {
      const m = [...inbox].reverse().find((x) => x.t === 'state')
      if (!m || m.t !== 'state') throw new Error('no view yet')
      return m.view
    },
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
  it('seats a joiner and shows every phone the new table', () => {
    const core = room()
    const ann = phone(core, 'a')
    const ben = phone(core, 'b')
    ann.hello('ann', 'Ann')
    ben.hello('ben', 'Ben')
    expect(ann.view().players.map((p) => p.name)).toEqual(['Ann', 'Ben'])
    expect(ann.view().connected.sort()).toEqual(['ann', 'ben'])
    expect(ann.view().you).toEqual({ playerId: 'ann', isHost: false })
  })

  it('tells a joiner why they can’t sit, and sends them no table', () => {
    const core = room()
    phone(core, 'a').hello('ann', 'Ann')
    const imposter = phone(core, 'x')
    imposter.hello('someone-else', 'ANN')
    expect(imposter.inbox).toEqual([{ v: PROTOCOL, t: 'error', message: 'Someone is already called ANN.' }])
  })

  it('gives a returning phone its own seat back, mid-hand, without needing its name', () => {
    const core = room()
    const host = phone(core, 'h')
    host.hello('hana', 'Hana', TOKEN)
    phone(core, 'a').hello('ann', 'Ann')
    host.command({ type: 'startHand' })
    core.close('a')
    expect(core.connected()).toEqual(['hana'])
    const again = phone(core, 'a2')
    again.hello('ann')
    expect(core.state.players).toHaveLength(2)
    expect(again.view().you.playerId).toBe('ann')
    expect(core.state.phase).toBe('betting')
  })

  it('ignores anything that isn’t a message it knows', () => {
    const core = room()
    const junk = phone(core, 'j')
    junk.send('hello')
    junk.send({ v: 1, t: 'hello', playerId: 'x', seatKey: keyOf('x'), name: 'X' })
    junk.send({ v: PROTOCOL, t: 'hello', playerId: 'x', name: 'X' })
    junk.send({ v: PROTOCOL, t: 'hello', playerId: { evil: true }, name: 'X' })
    junk.send({ v: PROTOCOL, t: 'hello', playerId: 'x'.repeat(200), name: 'X' })
    junk.send({ v: PROTOCOL, t: 'hello', playerId: 'x', name: 42 })
    expect(core.state.players).toHaveLength(0)
    expect(junk.inbox).toEqual([])
  })
})

describe('seats belong to phones', () => {
  it('won’t hand a seat to a phone that only knows the player id', () => {
    const core = room('online')
    const host = phone(core, 'h')
    const ann = phone(core, 'a')
    host.hello('hana', 'Hana', TOKEN)
    ann.hello('ann', 'Ann')
    host.command({ type: 'startHand' })
    // Every phone can see Ann's id. Knowing it isn't enough to sit in her seat.
    const thief = phone(core, 't')
    thief.hello('ann', undefined, undefined, 'a-guess-at-annes-key')
    expect(thief.inbox).toEqual([{ v: PROTOCOL, t: 'error', message: 'That seat belongs to another phone.' }])
    thief.act('ann', 'fold')
    expect(core.state.players.find((p) => p.id === 'ann')?.folded).toBe(false)
    // Ann's own phone, reloaded, gets back in.
    core.close('a')
    const again = phone(core, 'a2')
    again.hello('ann')
    expect(again.view().players.find((p) => p.id === 'ann')?.holeCards).toHaveLength(2)
  })

  it('frees a seat’s key when the host removes the player', () => {
    const core = room()
    const host = phone(core, 'h')
    host.hello('hana', 'Hana', TOKEN)
    phone(core, 'a').hello('ann', 'Ann')
    host.command({ type: 'remove', id: 'ann' })
    expect(core.seatKeys.ann).toBeUndefined()
    const newcomer = phone(core, 'n')
    newcomer.hello('ann', 'Annie', undefined, 'someone-elses-key-0000')
    expect(newcomer.view().you.playerId).toBe('ann')
  })
})

describe('the host', () => {
  it('is whoever holds the token, seated or only dealing', () => {
    const core = room()
    const dealer = phone(core, 'd')
    dealer.hello('dealer-phone', undefined, TOKEN)
    expect(dealer.view().you).toEqual({ playerId: null, isHost: true })
    expect(core.state.players).toHaveLength(0)
    const guess = phone(core, 'g')
    guess.hello('guess', 'Gus', 'wrong-token')
    expect(guess.view().you.isHost).toBe(false)
  })

  it('runs the game’s flow, and nobody but the host can', () => {
    const core = room()
    const host = phone(core, 'h')
    const ann = phone(core, 'a')
    host.hello('hana', undefined, TOKEN)
    ann.hello('ann', 'Ann')
    phone(core, 'b').hello('ben', 'Ben')
    ann.command({ type: 'startHand' }, 2)
    expect(ann.last()).toMatchObject({ t: 'error', message: 'Only the host can do that.', reqId: 2 })
    ann.command({ type: 'move', id: 'ann', toIndex: 0 })
    expect(ann.last()).toMatchObject({ t: 'error', message: 'Only the host can do that.' })
    host.command({ type: 'move', id: 'ben', toIndex: 0 })
    expect(core.state.players.map((p) => p.id)).toEqual(['ben', 'ann'])
    host.command({ type: 'startHand' })
    expect(core.state.phase).toBe('betting')
  })

  it('can’t act for anyone, or set anyone’s stack, its own seat included', () => {
    const core = room()
    const host = phone(core, 'h')
    const ann = phone(core, 'a')
    host.hello('hana', 'Hana', TOKEN)
    ann.hello('ann', 'Ann')
    host.command({ type: 'startHand' })
    // Heads-up, Hana has the button and acts first; then it's Ann's turn.
    host.act('hana', 'call')
    host.command({ type: 'act', playerId: 'ann', action: 'check' })
    expect(host.last()).toMatchObject({ t: 'error', message: 'You can only act for your own seat.' })
    expect(core.state.players[core.state.currentPlayerIndex].id).toBe('ann')
    for (const id of ['ann', 'hana']) {
      host.command({ type: 'adjustStack', id, stack: 99999 })
      expect(host.last()).toMatchObject({ t: 'error', message: 'Stacks only change by playing, or by a rebuy.' })
    }
    ann.command({ type: 'adjustStack', id: 'ann', stack: 99999 })
    expect(core.state.players.map((p) => p.stack)).toEqual([990, 990])
  })
})

describe('taking a move back', () => {
  function started() {
    const core = room()
    const host = phone(core, 'h')
    const ann = phone(core, 'a')
    const ben = phone(core, 'b')
    host.hello('dealer', undefined, TOKEN)
    ann.hello('ann', 'Ann')
    ben.hello('ben', 'Ben')
    host.command({ type: 'startHand' })
    return { core, host, ann, ben }
  }

  it('is for whoever made it: a player their own move, the host its own deal', () => {
    const { core, host, ann, ben } = started()
    // The host dealt last: only the host may take the deal back.
    expect(host.view().canUndo).toBe('dealer')
    expect(ann.view().canUndo).toBe(null)
    ann.act('ann', 'call')
    expect(ann.view().canUndo).toBe('move')
    expect(ben.view().canUndo).toBe(null)
    expect(host.view().canUndo).toBe(null)
    ben.command({ type: 'undo' })
    expect(ben.last()).toMatchObject({ t: 'error', message: 'Only whoever made the last move can take it back.' })
    host.command({ type: 'undo' })
    expect(host.last()).toMatchObject({ t: 'error', message: 'Only whoever made the last move can take it back.' })
    ann.command({ type: 'undo' })
    expect(core.state.players[core.state.currentPlayerIndex].id).toBe('ann')
    expect(core.state.players.find((p) => p.id === 'ann')?.betThisStreet).toBe(5)
  })
})

describe('rebuys', () => {
  it('are a busted player’s own to make, between hands, for the starting stack', () => {
    const core = room()
    const host = phone(core, 'h')
    const ann = phone(core, 'a')
    const ben = phone(core, 'b')
    host.hello('dealer', undefined, TOKEN)
    ann.hello('ann', 'Ann')
    ben.hello('ben', 'Ben')
    host.command({ type: 'startHand' })
    ann.act('ann', 'all-in')
    ben.act('ben', 'call')
    host.command({ type: 'advanceStreet' })
    host.command({ type: 'advanceStreet' })
    host.command({ type: 'advanceStreet' })
    host.command({ type: 'advanceStreet' })
    host.command({ type: 'award', winnersByPot: [['ben']] })
    expect(core.state.players.find((p) => p.id === 'ann')?.isEliminated).toBe(true)
    ben.command({ type: 'rebuy', id: 'ann' })
    expect(ben.last()).toMatchObject({ t: 'error', message: 'You can only rebuy your own seat.' })
    host.command({ type: 'rebuy', id: 'ann' })
    expect(host.last()).toMatchObject({ t: 'error', message: 'You can only rebuy your own seat.' })
    ben.command({ type: 'rebuy', id: 'ben' })
    expect(ben.last()).toMatchObject({ t: 'error', message: 'You still have chips.' })
    ann.command({ type: 'rebuy', id: 'ann' })
    const annNow = core.state.players.find((p) => p.id === 'ann')!
    expect([annNow.stack, annNow.isEliminated]).toEqual([1000, false])
  })
})

describe('playing', () => {
  it('answers an illegal move with the table’s own reason, to that phone only', () => {
    const core = room()
    const host = phone(core, 'h')
    const ann = phone(core, 'a')
    host.hello('hana', 'Hana', TOKEN)
    ann.hello('ann', 'Ann')
    host.command({ type: 'startHand' })
    const before = ann.inbox.length
    host.act('hana', 'raise', 12)
    expect(host.last()).toMatchObject({ t: 'error', message: 'The minimum is 20.' })
    expect(ann.inbox.length).toBe(before)
  })

  it('saves every change, and sends phones no undo history', () => {
    const saves: unknown[] = []
    const core = room('real', saves)
    const host = phone(core, 'h')
    host.hello('hana', 'Hana', TOKEN)
    phone(core, 'a').hello('ann', 'Ann')
    const before = saves.length
    host.command({ type: 'startHand' })
    expect(saves.length).toBe(before + 1)
    expect('undo' in host.view()).toBe(false)
    expect(host.view().canUndo).toBe('dealer')
  })

  it('answers a ping', () => {
    const core = room()
    const ann = phone(core, 'a')
    ann.hello('ann', 'Ann')
    ann.send({ v: PROTOCOL, t: 'ping' })
    expect(ann.last()).toEqual({ v: PROTOCOL, t: 'pong' })
  })

  it('picks up where it left off after the server sleeps and wakes', () => {
    const core = room()
    const sent: ToPhone[] = []
    core.open('a', () => {})
    core.receive('a', { v: PROTOCOL, t: 'hello', playerId: 'ann', seatKey: keyOf('ann'), name: 'Ann' })
    const identity = core.identity('a')!
    const woken = new RoomCore(core.state, TOKEN, () => shuffledDeck(createRng(1)))
    woken.reattach('a', (m) => sent.push(m), identity)
    woken.receive('a', { v: PROTOCOL, t: 'ping' })
    expect(sent).toEqual([{ v: PROTOCOL, t: 'pong' }])
    expect(woken.connected()).toEqual(['ann'])
  })
})

describe('online cards', () => {
  const stacked: Card[] = [...SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })))]

  it('shuffles every deck here, whatever the host’s phone sends', () => {
    const core = room('online')
    const host = phone(core, 'h')
    host.hello('hana', 'Hana', TOKEN)
    phone(core, 'a').hello('ann', 'Ann')
    // A host trying to deal a known deck: the room ignores it and shuffles its own.
    host.command({ type: 'startHand', deck: stacked })
    const known = new Set(stacked.slice(-4).map((c) => c.rank + c.suit))
    const dealt = core.state.players.flatMap((p) => p.holeCards).map((c) => c.rank + c.suit)
    expect(dealt).toHaveLength(4)
    expect(dealt.every((c) => known.has(c))).toBe(false)
  })

  it('sends each phone only its own cards, the host included, and never the deck', () => {
    const core = room('online')
    const host = phone(core, 'h')
    const ann = phone(core, 'a')
    const ben = phone(core, 'b')
    host.hello('dealer', undefined, TOKEN)
    ann.hello('ann', 'Ann')
    ben.hello('ben', 'Ben')
    host.command({ type: 'startHand' })
    for (const [who, seat] of [
      [ann, 'ann'],
      [ben, 'ben'],
    ] as const) {
      const view = who.view()
      expect(view.deck).toEqual([])
      expect(view.players.find((p) => p.id === seat)?.holeCards).toHaveLength(2)
      expect(view.players.filter((p) => p.id !== seat).every((p) => p.holeCards.length === 0)).toBe(true)
    }
    expect(host.view().players.every((p) => p.holeCards.length === 0)).toBe(true)
    expect(JSON.stringify(host.inbox)).not.toContain('"deck":[{')
  })
})

describe('the blind clock', () => {
  it('runs on the server’s clock, whatever time a phone claims', () => {
    let clock = 1_000
    const core = new RoomCore(newTable({ ...CONFIG, levelMinutes: 15 }), TOKEN, () => shuffledDeck(createRng(2)), undefined, {}, () => clock)
    const host = phone(core, 'h')
    host.hello('hana', 'Hana', TOKEN)
    phone(core, 'a').hello('ann', 'Ann')
    host.command({ type: 'startHand', now: 999_999_999 })
    expect(core.state.clock).toEqual({ level: 1, startedAt: 1_000 })
    expect(host.view().now).toBe(1_000)

    clock += 16 * 60_000
    const first = core.state.players[core.state.currentPlayerIndex].id
    core.receive(first === 'ann' ? 'a' : 'h', { v: PROTOCOL, t: 'command', reqId: 2, command: { type: 'act', playerId: first, action: 'fold' } })
    expect(core.state.phase).toBe('hand-over')
    host.command({ type: 'startHand' })
    expect(core.state.clock?.level).toBe(2)
    expect(core.state.currentBet).toBe(16)
  })
})
