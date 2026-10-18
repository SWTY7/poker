import { useCallback, useEffect, useRef, useState } from 'react'
import { connectRoom, type RoomLine, type RoomStatus } from '../../home/socket'
import type { Connector } from '../../home/p2p'
import type { TableView } from '../../home/room'
import type { Command } from '../../home/table'

export interface RoomConnection {
  view: TableView | null
  status: RoomStatus
  /** Why the status is what it is, when that needs saying ("Reconnecting…"). */
  detail: string | null
  /** The last refusal, in the table's own words, until the next change clears it. */
  error: string | null
  send: (command: Command) => void
  clearError: () => void
  close: () => void
}

/**
 * This phone's seat at room `code`. The same for the host and everyone else:
 * the server decides who may deal from the host token, and says so in the view.
 */
export function useRoom(code: string, playerId: string, seatKey: string, name: string | undefined, hostToken: string | undefined, connector?: Connector): RoomConnection {
  const [view, setView] = useState<TableView | null>(null)
  const [status, setStatus] = useState<RoomStatus>('connecting')
  const [detail, setDetail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lineRef = useRef<RoomLine | null>(null)

  useEffect(() => {
    const connect: Connector = connector ?? ((hello, events) => connectRoom(code, hello, events))
    const line = connect(
      { playerId, seatKey, name, hostToken },
      {
        onStatus: (s, d) => {
          setStatus(s)
          setDetail(d ?? null)
        },
        onView: (v) => {
          setView(v)
          setError(null)
        },
        onError: setError,
      },
    )
    lineRef.current = line
    return () => line.close()
  }, [code, playerId, seatKey, name, hostToken, connector])

  const send = useCallback((command: Command) => lineRef.current?.send(command), [])
  const close = useCallback(() => lineRef.current?.close(), [])
  const clearError = useCallback(() => setError(null), [])

  return { view, status, detail, error, send, clearError, close }
}
