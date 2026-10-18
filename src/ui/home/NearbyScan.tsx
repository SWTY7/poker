import { useEffect, useRef, useState } from 'react'
import { P2PError, P2P_MESSAGES, startQrScan } from '../../home/p2p'

/**
 * The camera, looking for a code. Started by the tap that opened it (a click
 * handler's worth of user gesture), stopped on a hit, on Cancel, and on unmount.
 */
export function NearbyScan({ onCode, onCancel }: { onCode: (text: string) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const latest = useRef(onCode)
  useEffect(() => {
    latest.current = onCode
  })

  useEffect(() => {
    const el = video.current
    if (!el) return
    let stop: (() => void) | null = null
    let gone = false
    startQrScan(el, (text) => latest.current(text)).then(
      (stopper) => {
        if (gone) stopper()
        else stop = stopper
      },
      (error) => setProblem(error instanceof P2PError ? P2P_MESSAGES[error.code] : P2P_MESSAGES.camera),
    )
    return () => {
      gone = true
      stop?.()
    }
  }, [])

  return (
    <div className="nearby-scan">
      {problem && <p className="nearby-problem">{problem}</p>}
      <video ref={video} className="nearby-video" hidden={!!problem} playsInline muted />
      <button type="button" className="btn btn-secondary nearby-btn" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}
