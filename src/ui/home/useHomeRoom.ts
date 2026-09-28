import { useCallback, useEffect, useRef, useState } from 'react'
import { hostRoom, joinRoom, type HostHandle, type JoinHandle, type RoomStatus } from '../../home/peer'
import type { TableView } from '../../home/room'
import { HomeTableError, type Command, type HomeState } from '../../home/table'
import { saveHost } from '../../home/saved'

export interface RoomConnection {
  view: TableView | null
  status: RoomStatus
  /** Why the status is what it is, when that needs saying ("Lost the host. Reconnecting…"). */
  detail: string | null
  /** The last refusal, in the table's own words, until the next change clears it. */
  error: string | null
  code: string | null
  send: (command: Command) => void
  clearError: () => void
}

/**
 * Runs the room on this device, as host. The table is saved after every
 * change, so a reload comes back to the same room and hand.
 */
export function useHostRoom(initial: HomeState, resumeCode: string | null, hostPlayerId: string | null, hostName: string | null): RoomConnection & { close: () => void } {
  const [view, setView] = useState<TableView | null>(null)
  const [status, setStatus] = useState<RoomStatus>('connecting')
  const [detail, setDetail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState<string | null>(resumeCode)
  const handleRef = useRef<HostHandle | null>(null)
  // The room is opened once, with whatever table and number this screen was entered with.
  const initialRef = useRef({ initial, resumeCode, hostPlayerId, hostName })

  useEffect(() => {
    const { initial, resumeCode, hostPlayerId, hostName } = initialRef.current
    let handle: HostHandle | null = null
    const persist = (state: HomeState) => {
      if (handle) saveHost({ code: handle.code, state, hostPlayerId })
    }
    handle = hostRoom(
      initial,
      persist,
      {
        onStatus: (s, d) => {
          setStatus(s)
          setDetail(d ?? null)
        },
        onCode: (c) => {
          setCode(c)
          if (handle) saveHost({ code: c, state: handle.core.state, hostPlayerId })
        },
      },
      resumeCode ?? undefined,
    )
    handle.core.onView = setView
    handle.core.hostPlayerId = hostPlayerId
    if (hostPlayerId && hostName && !handle.core.state.players.some((p) => p.id === hostPlayerId)) {
      handle.core.command({ type: 'join', id: hostPlayerId, name: hostName })
    }
    handle.core.announce()
    handleRef.current = handle
    return () => {
      handle?.close()
      handleRef.current = null
    }
  }, [])

  const send = useCallback((command: Command) => {
    try {
      handleRef.current?.core.command(command)
      setError(null)
    } catch (e) {
      setError(e instanceof HomeTableError ? e.message : 'Something went wrong.')
    }
  }, [])

  const close = useCallback(() => {
    handleRef.current?.close()
    saveHost(null)
  }, [])

  return { view, status, detail, error, code, send, clearError: () => setError(null), close }
}

/** Joins room `code` from this phone, rejoining the same seat whenever the connection drops. */
export function useJoinRoom(code: string, playerId: string, name: string): RoomConnection & { close: () => void } {
  const [view, setView] = useState<TableView | null>(null)
  const [status, setStatus] = useState<RoomStatus>('connecting')
  const [detail, setDetail] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const handleRef = useRef<JoinHandle | null>(null)

  useEffect(() => {
    const handle = joinRoom(code, playerId, name, {
      onStatus: (s, d) => {
        setStatus(s)
        setDetail(d ?? null)
      },
      onView: (v) => {
        setView(v)
        setError(null)
      },
      onError: setError,
    })
    handleRef.current = handle
    return () => handle.close()
  }, [code, playerId, name])

  const send = useCallback((command: Command) => handleRef.current?.send(command), [])
  const close = useCallback(() => handleRef.current?.close(), [])

  return { view, status, detail, error, code, send, clearError: () => setError(null), close }
}
