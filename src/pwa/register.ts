import { useSyncExternalStore } from 'react'

const CHECK_EVERY_MS = 30 * 60 * 1000

let updateReady = false
let reloading = false
let registration: ServiceWorkerRegistration | null = null
const listeners = new Set<() => void>()

function setReady(v: boolean): void {
  if (updateReady === v) return
  updateReady = v
  listeners.forEach((l) => l())
}

export function subscribeUpdate(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
export const getUpdateReady = (): boolean => updateReady

/** True when a new version is installed and waiting. */
export function useUpdateReady(): boolean {
  return useSyncExternalStore(subscribeUpdate, getUpdateReady, () => false)
}

/** Ask the waiting worker to take over, then reload once it does. */
export function applyUpdate(): void {
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined
  const waiting = registration?.waiting
  if (!sw || !waiting) return
  sw.addEventListener('controllerchange', () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  })
  waiting.postMessage({ type: 'SKIP_WAITING' })
}

function watch(reg: ServiceWorkerRegistration): void {
  // Only an update when a page is already controlled; a first install is not one.
  const flag = (): void => {
    if (reg.waiting && navigator.serviceWorker.controller) setReady(true)
  }
  flag()
  reg.addEventListener('updatefound', () => {
    const w = reg.installing
    w?.addEventListener('statechange', () => {
      if (w.state === 'installed') flag()
    })
  })
}

/** Register ./sw.js after load. Production only; returns false when skipped. */
export function registerServiceWorker(opts: { enabled?: boolean } = {}): boolean {
  const enabled = opts.enabled ?? import.meta.env.PROD
  if (!enabled || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false

  const start = (): void => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        registration = reg
        watch(reg)
        const check = (): void => {
          reg.update().catch(() => {})
        }
        setInterval(check, CHECK_EVERY_MS)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check()
        })
      })
      .catch(() => {})
  }
  if (document.readyState === 'complete') start()
  else window.addEventListener('load', start, { once: true })
  return true
}

/** Test hook: forget module state. */
export function resetForTests(): void {
  updateReady = false
  reloading = false
  registration = null
  listeners.clear()
}
