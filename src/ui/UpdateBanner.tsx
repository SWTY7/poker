import { useState } from 'react'
import { applyUpdate, useUpdateReady } from '../pwa/register'

/** Top banner when a new version is waiting. Dismissible until the next visit. */
export function UpdateBanner() {
  const ready = useUpdateReady()
  const [dismissed, setDismissed] = useState(false)
  if (!ready || dismissed) return null
  return (
    <div className="update-banner" role="status">
      <span className="update-banner__text">New version ready</span>
      <button type="button" className="update-banner__go" onClick={applyUpdate}>
        Tap to reload
      </button>
      <button
        type="button"
        className="update-banner__x"
        aria-label="Dismiss"
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  )
}
