import type { HomeState } from '../../home/table'
import { HomeTable } from './HomeTable'
import { useHostRoom, useJoinRoom } from './useHomeRoom'

interface HostScreenProps {
  initial: HomeState
  /** Reopening a saved room: its number. Null opens a new one. */
  resumeCode: string | null
  hostPlayerId: string | null
  hostName: string | null
  onExit: () => void
}

/** The host's phone: runs the room and deals. */
export function HostScreen({ initial, resumeCode, hostPlayerId, hostName, onExit }: HostScreenProps) {
  const room = useHostRoom(initial, resumeCode, hostPlayerId, hostName)
  return (
    <HomeTable
      view={room.view}
      status={room.status}
      detail={room.detail}
      error={room.error}
      onClearError={room.clearError}
      myId={hostPlayerId}
      isHost
      code={room.code}
      send={room.send}
      onLeave={() => {
        room.close()
        onExit()
      }}
    />
  )
}

interface JoinScreenProps {
  code: string
  playerId: string
  name: string
  onExit: () => void
}

/** A player's phone: their seat, their buttons, and everyone else's stacks. */
export function JoinScreen({ code, playerId, name, onExit }: JoinScreenProps) {
  const room = useJoinRoom(code, playerId, name)
  return (
    <HomeTable
      view={room.view}
      status={room.status}
      detail={room.detail}
      error={room.error}
      onClearError={room.clearError}
      myId={playerId}
      isHost={false}
      code={code}
      send={room.send}
      onLeave={() => {
        room.close()
        onExit()
      }}
    />
  )
}
