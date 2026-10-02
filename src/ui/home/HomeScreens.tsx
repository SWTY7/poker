import { HomeTable } from './HomeTable'
import { useRoom } from './useHomeRoom'

interface RoomScreenProps {
  code: string
  playerId: string
  seatKey: string
  /** To sit down under this name; left out to reclaim a seat (or, for the host, to only deal). */
  name?: string
  /** Present on the phone that created the room. */
  hostToken?: string
  onExit: () => void
}

/** One phone at a home game table, host or player alike. */
export function RoomScreen({ code, playerId, seatKey, name, hostToken, onExit }: RoomScreenProps) {
  const room = useRoom(code, playerId, seatKey, name, hostToken)
  return (
    <HomeTable
      view={room.view}
      status={room.status}
      detail={room.detail}
      error={room.error}
      onClearError={room.clearError}
      myId={room.view?.you.playerId ?? null}
      isHost={room.view?.you.isHost ?? false}
      code={code}
      send={room.send}
      onLeave={() => {
        room.close()
        onExit()
      }}
    />
  )
}
