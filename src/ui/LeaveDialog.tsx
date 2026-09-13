import { useEffect, useRef } from 'react'

interface LeaveDialogProps {
  handsPlayed: number
  /** Session profit/loss for the one human, or null in pass-and-play where a single figure wouldn't mean much. */
  net: number | null
  stack: number
  startingStack: number
  /** True if a hand is still live — leaving now forfeits whatever is already in the pot. */
  handInProgress: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Standing up from the table. In a real cardroom you may leave whenever you
 * like, but you cannot pick up chips you have already pushed into a live pot
 * — you either play the hand out or fold and walk, and the pot stays.
 * That's the distinction the warning below draws, and it's why this is a
 * proper cash-out screen rather than a bare "are you sure?".
 */
export function LeaveDialog({
  handsPlayed,
  net,
  stack,
  startingStack,
  handInProgress,
  onConfirm,
  onCancel,
}: LeaveDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const up = net !== null && net >= 0

  return (
    <div className="overlay" onClick={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Leave the table"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <h2 className="dialog-title">Cash out?</h2>
        </div>

        <div className="cashout-grid">
          <div className="cashout-cell">
            <span className="cashout-label">Hands played</span>
            <span className="cashout-value">{handsPlayed}</span>
          </div>
          <div className="cashout-cell">
            <span className="cashout-label">Bought in for</span>
            <span className="cashout-value">${startingStack.toLocaleString()}</span>
          </div>
          <div className="cashout-cell">
            <span className="cashout-label">Leaving with</span>
            <span className="cashout-value">${stack.toLocaleString()}</span>
          </div>
          {net !== null && (
            <div className="cashout-cell">
              <span className="cashout-label">Result</span>
              <span className={`cashout-value ${up ? 'cashout-up' : 'cashout-down'}`}>
                {up ? '+' : '−'}${Math.abs(net).toLocaleString()}
              </span>
            </div>
          )}
        </div>

        {handInProgress && (
          <p className="dialog-warn">
            A hand is still live. Just like standing up mid-hand in a real cardroom, anything you have already put in
            the pot stays there — you forfeit this hand. Sit back down and fold it out if you’d rather not.
          </p>
        )}

        <div className="dialog-actions">
          <button ref={cancelRef} type="button" className="btn btn-secondary" onClick={onCancel}>
            Keep playing
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm}>
            Leave table
          </button>
        </div>
      </div>
    </div>
  )
}
