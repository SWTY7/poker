import type { TableView } from '../../../src/home/room'
import type { LineEvents, NearbyHost, P2PDeps, RoomLine, Connector, Invite } from '../../../src/home/p2p/contract'
import { startNearbyGuest } from '../../../src/home/p2p/guest'
import type { RoomStatus } from '../../../src/home/socket'
import type { FakeNetwork } from './fake-peer'

export const CONFIG = { startingStack: 1000, smallBlind: 5, bigBlind: 10, ante: 0 }

export const seatKeyOf = (playerId: string) => `key-of-${playerId}-0123456789`

export function depsFor(net: FakeNetwork, extra: P2PDeps = {}): P2PDeps {
  return { createPeer: net.createPeer, ...extra }
}

/** One phone's side of a table line: everything the line told it. */
export interface Phone {
  line: RoomLine
  statuses: { status: RoomStatus; detail?: string }[]
  views: TableView[]
  errors: string[]
  view(): TableView
}

export function sit(connector: Connector, playerId: string, name?: string, seatKey = seatKeyOf(playerId)): Phone {
  const statuses: Phone['statuses'] = []
  const views: TableView[] = []
  const errors: string[] = []
  const events: LineEvents = {
    onStatus: (status, detail) => statuses.push({ status, detail }),
    onView: (view) => views.push(view),
    onError: (message) => errors.push(message),
  }
  const line = connector({ playerId, seatKey, name }, events)
  return {
    line,
    statuses,
    views,
    errors,
    view: () => {
      const view = views.at(-1)
      if (!view) throw new Error('no view yet')
      return view
    },
  }
}

/** The real-timer way to let promises and queued microtasks run. */
export const flush = async () => {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve))
}

/** A joiner and the host exchange codes. Resolves once the host has the reply entered; the channel opens a moment later. */
export async function exchange(host: NearbyHost, deps: P2PDeps): Promise<{ invite: Invite; guest: ReturnType<typeof startNearbyGuest>; reply: string }> {
  const invite = await host.createInvite()
  const guest = startNearbyGuest(deps)
  const reply = await guest.answer(invite.code)
  await host.acceptAnswer(reply)
  return { invite, guest, reply }
}
