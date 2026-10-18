import { useEffect, useRef, useState } from 'react'
import { groupCode, P2P_MESSAGES, qrScanSupported, startNearbyGuest, type NearbyGuest } from '../../home/p2p'
import { loadMe, saveMe } from '../../home/saved'
import { Frame } from './HomeEntry'
import { HomeTable } from './HomeTable'
import { NearbyScan } from './NearbyScan'
import { QrCode } from './QrCode'
import { nearbyMessage, TRUST_NOTICE } from './nearby-copy'
import { useRoom } from './useHomeRoom'
import { useWakeLock, WAKE_LOCK_NOTE } from './useWakeLock'

type Stage = { kind: 'form'; lost: boolean } | { kind: 'session'; guest: NearbyGuest; reply: string; name: string }

/** Joining a nearby table: the host's code in, a reply code out, then the table. */
export function NearbyJoin({ initialName, onBack }: { initialName: string; onBack: () => void }) {
  const [stage, setStage] = useState<Stage>({ kind: 'form', lost: false })
  const [name, setName] = useState(initialName)
  const guestRef = useRef<NearbyGuest | null>(null)

  useEffect(
    () => () => {
      guestRef.current?.close()
      guestRef.current = null
    },
    [],
  )

  /** Starts a fresh guest for the host's code; resolves to a message if it didn't work. */
  const connect = async (code: string): Promise<string | null> => {
    guestRef.current?.close()
    const guest = startNearbyGuest()
    guestRef.current = guest
    try {
      const reply = await guest.answer(code)
      saveMe({ ...loadMe(), name: name.trim() })
      setStage({ kind: 'session', guest, reply, name: name.trim() })
      return null
    } catch (error) {
      guest.close()
      guestRef.current = null
      return nearbyMessage(error)
    }
  }

  if (stage.kind === 'session') {
    return (
      <GuestSession
        guest={stage.guest}
        reply={stage.reply}
        name={stage.name}
        onRejoin={() => {
          guestRef.current?.close()
          guestRef.current = null
          setStage({ kind: 'form', lost: true })
        }}
        onExit={onBack}
      />
    )
  }
  return <JoinForm name={name} onName={setName} lost={stage.lost} onConnect={connect} onBack={onBack} />
}

function JoinForm({
  name,
  onName,
  lost,
  onConnect,
  onBack,
}: {
  name: string
  onName: (name: string) => void
  lost: boolean
  onConnect: (code: string) => Promise<string | null>
  onBack: () => void
}) {
  const [text, setText] = useState('')
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const canScan = qrScanSupported()
  const ready = name.trim() !== '' && !busy

  const submit = async (code: string) => {
    setScanning(false)
    setBusy(true)
    setProblem(await onConnect(code))
    setBusy(false)
  }

  return (
    <Frame title="Join nearby" subtitle="Join the host’s hotspot first, then get their code." onBack={onBack}>
      {lost && <p className="nearby-problem">{P2P_MESSAGES.hostLost}</p>}
      <label className="home-field">
        <span>Your name</span>
        <input value={name} maxLength={16} onChange={(e) => onName(e.target.value)} placeholder="Name at the table" />
      </label>

      {scanning ? (
        <NearbyScan onCode={(code) => void submit(code)} onCancel={() => setScanning(false)} />
      ) : (
        canScan && (
          <button type="button" className="btn nearby-btn" disabled={!ready} onClick={() => setScanning(true)}>
            Scan host code
          </button>
        )
      )}

      <label className="home-field">
        <span>{canScan ? 'Or type the host’s code' : 'The host’s code'}</span>
        <textarea
          className="nearby-textarea"
          value={text}
          rows={4}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="P1H…"
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <button type="button" className="btn menu-start nearby-btn" disabled={!ready || text.trim() === ''} onClick={() => void submit(text)}>
        {busy ? 'Making your reply…' : 'Continue'}
      </button>
      {problem && <p className="nearby-problem">{problem}</p>}
      <p className="nearby-trust">{TRUST_NOTICE}</p>
    </Frame>
  )
}

function GuestSession({ guest, reply, name, onRejoin, onExit }: { guest: NearbyGuest; reply: string; name: string; onRejoin: () => void; onExit: () => void }) {
  const me = loadMe()
  const room = useRoom(reply, me.playerId, me.seatKey, name, undefined, guest.connector)
  const wake = useWakeLock()

  if (room.status === 'closed') {
    return (
      <Frame title="Join nearby" subtitle="The table went quiet." onBack={onExit}>
        <p className="nearby-problem">{room.detail ?? P2P_MESSAGES.hostLost}</p>
        <button type="button" className="btn menu-start nearby-btn" onClick={onRejoin}>
          Rejoin
        </button>
      </Frame>
    )
  }

  if (!room.view) {
    return (
      <Frame title="Join nearby" subtitle="Connecting…" onBack={onExit}>
        <ReplyPanel reply={reply} />
        {wake.missing && <p className="menu-hint nearby-hint">{WAKE_LOCK_NOTE}</p>}
      </Frame>
    )
  }

  return (
    <>
      <HomeTable
        view={room.view}
        status={room.status}
        detail={room.detail}
        error={room.error}
        onClearError={room.clearError}
        myId={room.view.you.playerId}
        isHost={false}
        code={null}
        send={room.send}
        onLeave={() => {
          room.close()
          guest.close()
          onExit()
        }}
      />
      {wake.missing && <p className="menu-hint nearby-hint nearby-host-bar">{WAKE_LOCK_NOTE}</p>}
    </>
  )
}

/** The guest's answer, for the host to scan or type. */
export function ReplyPanel({ reply }: { reply: string }) {
  return (
    <div className="nearby-invite">
      <QrCode text={reply} label="Your reply code for the host to scan" />
      <div className="nearby-invite-side">
        <p className="nearby-code" aria-label="Reply code to type">
          {groupCode(reply)}
        </p>
        <p className="menu-hint nearby-hint">Show this to the host.</p>
        <p className="menu-hint nearby-hint">Connecting…</p>
      </div>
    </div>
  )
}
