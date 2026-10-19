import { useEffect, useState } from 'react'

interface WakeLockSentinelLike {
  release(): Promise<void>
}
interface WakeLockLike {
  request(type: 'screen'): Promise<WakeLockSentinelLike>
}

/**
 * Keeps the screen on while a nearby table is open: if the phone locks, the
 * page is suspended and the game ends for everyone. Returns `missing` when the
 * browser can't, so the screen can ask for auto-lock to be turned off.
 * Nothing runs at render (server rendering is safe); it all happens in the effect.
 */
export function useWakeLock(): { missing: boolean } {
  const [missing, setMissing] = useState<boolean>(() => typeof navigator !== 'undefined' && !(navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock)

  useEffect(() => {
    const wakeLock = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock
    if (!wakeLock) return
    let sentinel: WakeLockSentinelLike | null = null
    let stopped = false
    const request = () => {
      if (stopped || document.visibilityState !== 'visible') return
      wakeLock
        .request('screen')
        .then((s) => {
          if (stopped) void s.release()
          else sentinel = s
        })
        .catch(() => setMissing(true))
    }
    request()
    document.addEventListener('visibilitychange', request)
    return () => {
      stopped = true
      document.removeEventListener('visibilitychange', request)
      void sentinel?.release().catch(() => undefined)
    }
  }, [])

  return { missing }
}

export const WAKE_LOCK_NOTE = 'Set auto-lock to Never while you play.'
