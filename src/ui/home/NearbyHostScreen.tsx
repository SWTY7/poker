import { useCallback, useEffect, useState } from 'react'
import { clearNearbyRoom, startNearbyHost, type Invite, type NearbyHost, type NearbyStart } from '../../home/p2p'
import { loadMe } from '../../home/saved'
import { HomeTable } from './HomeTable'
import { InviteSheet } from './InviteSheet'
import { nearbyMessage } from './nearby-copy'
import { useRoom } from './useHomeRoom'
import { useWakeLock, WAKE_LOCK_NOTE } from './useWakeLock'

interface NearbyHostScreenProps {
  start: NearbyStart
  /** The host's own name, if the host plays too; undefined to only deal (or to reclaim the seat on a reopen). */
  name?: string
  onExit: () => void
}

/**
 * The phone that holds the table. The host object is made in an effect (and
 * closed on cleanup), so React's development double mount makes and drops one
 * spare rather than leaving a second host running.
 */
export function NearbyHostScreen({ start, name, onExit }: NearbyHostScreenProps) {
  const [host, setHost] = useState<NearbyHost | null>(null)

  useEffect(() => {
    const made = startNearbyHost(start)
    setHost(made)
    return () => {
      made.close()
      setHost(null)
    }
  }, [start])

  if (!host) return <div className="app-placeholder">Opening the table…</div>
  return <HostTable host={host} name={name} onExit={onExit} />
}

function HostTable({ host, name, onExit }: { host: NearbyHost; name?: string; onExit: () => void }) {
  const me = loadMe()
  const room = useRoom(host.roomId, me.playerId, me.seatKey, name, host.hostToken, host.connector)
  const wake = useWakeLock()
  const [invites, setInvites] = useState<Invite[]>(() => host.invites())
  const [sheet, setSheet] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [confirmEnd, setConfirmEnd] = useState(false)

  useEffect(() => host.onInvites(setInvites), [host])

  const current = [...invites].reverse().find((i) => i.status === 'waiting') ?? null

  const makeInvite = useCallback(async () => {
    setBusy(true)
    setProblem(null)
    try {
      await host.createInvite()
    } catch (error) {
      setProblem(nearbyMessage(error))
    }
    setBusy(false)
  }, [host])

  // Opening the sheet makes the first code, so there is something to show at once.
  useEffect(() => {
    if (sheet && !current && !busy) void makeInvite()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet])

  const reply = async (code: string) => {
    setBusy(true)
    setProblem(null)
    try {
      await host.acceptAnswer(code)
    } catch (error) {
      setProblem(nearbyMessage(error))
    }
    setBusy(false)
  }

  /** Asking for the camera makes the browser show real addresses; the stream itself is never used. */
  const allowCamera = async () => {
    setBusy(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      stream.getTracks().forEach((t) => t.stop())
    } catch {
      // Denied or missing: carry on with the code we have.
    }
    if (current) host.cancelInvite(current.id)
    setBusy(false)
    await makeInvite()
  }

  const endGame = () => {
    clearNearbyRoom()
    host.close()
    onExit()
  }

  return (
    <>
      <HomeTable
        view={room.view}
        status={room.status}
        detail={room.detail}
        error={room.error}
        onClearError={room.clearError}
        myId={room.view?.you.playerId ?? null}
        isHost
        code={null}
        send={room.send}
        onLeave={() => {
          room.close()
          host.close()
          onExit()
        }}
      />
      <div className="nearby-host-bar">
        {wake.missing && <p className="menu-hint nearby-hint">{WAKE_LOCK_NOTE}</p>}
        {sheet ? (
          <InviteSheet
            invite={current}
            invites={invites}
            busy={busy}
            problem={problem}
            onNew={() => void makeInvite()}
            onReply={(code) => void reply(code)}
            onAllowCamera={() => void allowCamera()}
            onClose={() => setSheet(false)}
          />
        ) : (
          <div className="nearby-actions">
            <button type="button" className="btn nearby-btn" onClick={() => setSheet(true)}>
              Add a player
            </button>
            {confirmEnd ? (
              <span className="home-leave-confirm">
                End the game for everyone?
                <button type="button" className="lobby-reset-link" onClick={endGame}>
                  End game
                </button>
                <button type="button" className="lobby-reset-link" onClick={() => setConfirmEnd(false)}>
                  Keep playing
                </button>
              </span>
            ) : (
              <button type="button" className="btn btn-secondary nearby-btn" onClick={() => setConfirmEnd(true)}>
                End game
              </button>
            )}
          </div>
        )}
      </div>
    </>
  )
}
