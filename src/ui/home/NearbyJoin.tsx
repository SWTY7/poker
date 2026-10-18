import { useEffect, useRef, useState } from 'react'
import { allowCamera, CODE_INPUT_MAX, groupCode, P2P_MESSAGES, qrScanSupported, startNearbyGuest, type NearbyGuest } from '../../home/p2p'
import { loadMe, saveMe } from '../../home/saved'
import { Frame } from './HomeEntry'
import { HomeTable } from './HomeTable'
import { NearbyScan } from './NearbyScan'
import { QrCode } from './QrCode'
import { nearbyMessage, TRUST_NOTICE } from './nearby-copy'
import { useRoom } from './useHomeRoom'
import { useWakeLock, WAKE_LOCK_NOTE } from './useWakeLock'

type Stage = { kind: 'form'; lost: boolean } | { kind: 'session'; guest: NearbyGuest; reply: string; name: string; offer: string }

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
      if (guestRef.current !== guest) return null
      saveMe({ ...loadMe(), name: name.trim() })
      setStage({ kind: 'session', guest, reply, name: name.trim(), offer: code })
      return null
    } catch (error) {
      if (guestRef.current !== guest) return null
      guest.close()
      guestRef.current = null
      return nearbyMessage(error)
    }
  }

  if (stage.kind === 'session') {
    return (
      <GuestSession
        key={stage.reply}
        guest={stage.guest}
        reply={stage.reply}
        name={stage.name}
        onAllowCamera={async () => {
          await allowCamera()
          // Same host code, a new reply that can carry real addresses now. If it fails, the first reply stays.
          const first = stage.guest
          const next = startNearbyGuest()
          try {
            const reply = await next.answer(stage.offer)
            if (guestRef.current !== first) {
              next.close()
              return
            }
            first.close()
            guestRef.current = next
            setStage({ kind: 'session', guest: next, reply, name: stage.name, offer: stage.offer })
          } catch {
            next.close()
          }
        }}
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

  // The scan loop calls back every 200 ms until the camera stops; only the first code counts.
  const working = useRef(false)
  const submit = async (code: string) => {
    if (working.current) return
    working.current = true
    setScanning(false)
    setBusy(true)
    try {
      setProblem(await onConnect(code))
    } finally {
      working.current = false
      setBusy(false)
    }
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
          maxLength={CODE_INPUT_MAX}
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

function GuestSession({
  guest,
  reply,
  name,
  onAllowCamera,
  onRejoin,
  onExit,
}: {
  guest: NearbyGuest
  reply: string
  name: string
  onAllowCamera: () => Promise<void>
  onRejoin: () => void
  onExit: () => void
}) {
  const me = loadMe()
  const [asking, setAsking] = useState(false)
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
        <ReplyPanel
          reply={reply}
          mdnsOnly={guest.mdnsOnly}
          busy={asking}
          onAllowCamera={() => {
            setAsking(true)
            void onAllowCamera().finally(() => setAsking(false))
          }}
        />
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
export function ReplyPanel({
  reply,
  mdnsOnly = false,
  busy = false,
  onAllowCamera,
}: {
  reply: string
  mdnsOnly?: boolean
  busy?: boolean
  onAllowCamera?: () => void
}) {
  return (
    <>
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
      {mdnsOnly && onAllowCamera && (
        <div className="nearby-mdns">
          <p className="menu-hint nearby-hint">{P2P_MESSAGES.mdnsOnly}</p>
          <button type="button" className="btn btn-secondary nearby-btn" disabled={busy} onClick={onAllowCamera}>
            Allow camera
          </button>
        </div>
      )}
    </>
  )
}
