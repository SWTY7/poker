import { useEffect, useState } from 'react'
import type { ActionType } from '../poker/game-state'
import type { PreAction } from './useHoldemGame'

interface ControlsProps {
  legalActions: ActionType[]
  toCall: number
  minRaiseTo: number
  maxRaiseTo: number
  /** Everything already in the middle, plus this street's bets. */
  potSize: number
  onAction: (type: ActionType, amount?: number) => void
}

/** Fraction-of-pot shortcuts, as a raise TO amount. */
function potFractionTarget(potSize: number, toCall: number, fraction: number): number {
  return Math.round(toCall + (potSize + toCall) * fraction)
}

export function Controls({ legalActions, toCall, minRaiseTo, maxRaiseTo, potSize, onAction }: ControlsProps) {
  const canRaise = legalActions.includes('bet') || legalActions.includes('raise')
  const raiseType: ActionType = legalActions.includes('bet') ? 'bet' : 'raise'
  const [amount, setAmount] = useState(minRaiseTo)

  // Each new betting round should offer the minimum raise again rather than
  // whatever was dialled in last street. Adjusting during render (rather than
  // in an effect) avoids briefly showing the stale figure.
  const bounds = `${minRaiseTo}:${maxRaiseTo}`
  const [lastBounds, setLastBounds] = useState(bounds)
  if (lastBounds !== bounds) {
    setLastBounds(bounds)
    setAmount(Math.min(minRaiseTo, maxRaiseTo))
  }

  const clamp = (value: number) => Math.min(Math.max(value, minRaiseTo), maxRaiseTo)
  const clampedAmount = clamp(amount)

  // Keyboard is the difference between choosing an action and hunting for a
  // button before the table moves on.
  useEffect(() => {
    if (legalActions.length === 0) return
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

      switch (event.key.toLowerCase()) {
        case 'f':
          if (legalActions.includes('fold')) onAction('fold')
          break
        case 'c':
          if (legalActions.includes('call')) onAction('call')
          else if (legalActions.includes('check')) onAction('check')
          break
        case 'k':
          if (legalActions.includes('check')) onAction('check')
          break
        case 'r':
        case 'enter':
          if (canRaise) onAction(raiseType, clampedAmount)
          break
        case 'a':
          if (legalActions.includes('all-in')) onAction('all-in')
          break
        case '1':
          if (canRaise) setAmount(clamp(potFractionTarget(potSize, toCall, 0.5)))
          break
        case '2':
          if (canRaise) setAmount(clamp(potFractionTarget(potSize, toCall, 0.75)))
          break
        case '3':
          if (canRaise) setAmount(clamp(potFractionTarget(potSize, toCall, 1)))
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Touch shortcuts for one-handed phone play: an upward swipe starting
  // from the lower-left corner folds (mirrors physically pushing cards away
  // from you); a double-tap anywhere plays the free action (check, or call
  // when there's nothing free to do). Both are skipped when the touch
  // started on a real control, so they never fight a button tap or a drag
  // on the raise slider.
  useEffect(() => {
    if (legalActions.length === 0) return

    let touchStart: { x: number; y: number; time: number } | null = null
    let lastTap: { x: number; y: number; time: number } | null = null

    function isOnControl(target: EventTarget | null): boolean {
      return Boolean((target as HTMLElement | null)?.closest('button, input, a'))
    }

    function onTouchStart(event: TouchEvent) {
      const touch = event.touches[0]
      touchStart = { x: touch.clientX, y: touch.clientY, time: Date.now() }
    }

    function onTouchEnd(event: TouchEvent) {
      const start = touchStart
      touchStart = null
      if (isOnControl(event.target)) return

      const touch = event.changedTouches[0]
      const now = Date.now()

      if (start) {
        const dx = touch.clientX - start.x
        const dy = touch.clientY - start.y
        const elapsed = now - start.time
        const startedLowerLeft = start.x < window.innerWidth * 0.5 && start.y > window.innerHeight * 0.55
        const swipedUp = dy < -70 && Math.abs(dx) < Math.abs(dy) * 1.5
        if (startedLowerLeft && swipedUp && elapsed < 700 && legalActions.includes('fold')) {
          onAction('fold')
          lastTap = null
          return
        }
      }

      if (
        lastTap &&
        now - lastTap.time < 350 &&
        Math.hypot(touch.clientX - lastTap.x, touch.clientY - lastTap.y) < 40
      ) {
        if (legalActions.includes('check')) onAction('check')
        else if (legalActions.includes('call')) onAction('call')
        lastTap = null
        return
      }
      lastTap = { x: touch.clientX, y: touch.clientY, time: now }
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [legalActions, onAction])

  if (legalActions.length === 0) return null

  return (
    <div className="controls">
      {canRaise && (
        <div className="raise-controls">
          <div className="raise-readout">
            <span className="raise-readout-label">{raiseType === 'bet' ? 'Bet' : 'Raise'} to</span>
            <span className="raise-readout-amount">${clampedAmount.toLocaleString()}</span>
          </div>
          <input
            type="range"
            min={minRaiseTo}
            max={maxRaiseTo}
            value={clampedAmount}
            aria-label="Raise amount"
            onChange={(e) => setAmount(Number(e.target.value))}
          />
          <div className="raise-quick-buttons">
            <button className="btn btn-quick" onClick={() => setAmount(minRaiseTo)}>
              Min
            </button>
            <button className="btn btn-quick" onClick={() => setAmount(clamp(potFractionTarget(potSize, toCall, 0.5)))}>
              ½ pot <kbd>1</kbd>
            </button>
            <button className="btn btn-quick" onClick={() => setAmount(clamp(potFractionTarget(potSize, toCall, 0.75)))}>
              ¾ pot <kbd>2</kbd>
            </button>
            <button className="btn btn-quick" onClick={() => setAmount(clamp(potFractionTarget(potSize, toCall, 1)))}>
              Pot <kbd>3</kbd>
            </button>
            <button className="btn btn-quick" onClick={() => setAmount(maxRaiseTo)}>
              Max
            </button>
          </div>
        </div>
      )}

      <div className="action-buttons">
        {legalActions.includes('fold') && (
          <button className="btn btn-action btn-fold" onClick={() => onAction('fold')}>
            Fold <kbd>F</kbd>
          </button>
        )}
        {legalActions.includes('check') && (
          <button className="btn btn-action btn-check" onClick={() => onAction('check')}>
            Check <kbd>C</kbd>
          </button>
        )}
        {legalActions.includes('call') && (
          <button className="btn btn-action btn-call" onClick={() => onAction('call')}>
            Call ${toCall.toLocaleString()} <kbd>C</kbd>
          </button>
        )}
        {canRaise && (
          <button className="btn btn-action btn-raise" onClick={() => onAction(raiseType, clampedAmount)}>
            {raiseType === 'bet' ? 'Bet' : 'Raise to'} ${clampedAmount.toLocaleString()} <kbd>R</kbd>
          </button>
        )}
        {legalActions.includes('all-in') && !canRaise && (
          <button className="btn btn-action btn-allin" onClick={() => onAction('all-in')}>
            All-in <kbd>A</kbd>
          </button>
        )}
      </div>
    </div>
  )
}

interface PreActionBarProps {
  /** What it costs to stay in right now, from the hero's seat. */
  toCall: number
  value: PreAction | null
  onChange: (value: PreAction | null) => void
  waitingOn: string | null
  /** True while the board is being dealt — nobody may act, hero included. */
  dealing: boolean
}

/**
 * Occupies the control bar whenever it is not the player's turn, so the bottom
 * of the screen never collapses and reflows. While an opponent is deciding it
 * also offers pre-actions: committing a decision in advance turns dead time
 * into a choice the player is making, rather than time they sit through.
 */
export function PreActionBar({ toCall, value, onChange, waitingOn, dealing }: PreActionBarProps) {
  const toggle = (next: PreAction) => onChange(value === next ? null : next)

  return (
    <div className="controls controls-waiting">
      <span className="waiting-label">
        {dealing ? 'Dealing…' : waitingOn ? `${waitingOn} is deciding…` : 'Waiting…'}
      </span>
      {!dealing && (
        <div className="pre-actions">
          <button
            className={`btn btn-pre ${value === 'check-fold' ? 'btn-pre-on' : ''}`}
            onClick={() => toggle('check-fold')}
          >
            {toCall > 0 ? 'Fold' : 'Check / fold'}
          </button>
          <button
            className={`btn btn-pre ${value === 'call-any' ? 'btn-pre-on' : ''}`}
            onClick={() => toggle('call-any')}
          >
            Call any
          </button>
        </div>
      )}
    </div>
  )
}

interface SpectatingBarProps {
  message: string
  onSkip: () => void
}

/**
 * Takes over the control bar once nobody at the table has a decision left to
 * make this hand — folded, or all-in — but the hand itself is still being
 * played out. Without this the bottom of the screen simply went empty, which
 * reads as the game having stalled rather than as "nothing left to decide".
 */
export function SpectatingBar({ message, onSkip }: SpectatingBarProps) {
  return (
    <div className="controls controls-waiting">
      <span className="waiting-label">{message}</span>
      <button className="btn btn-skip" onClick={onSkip}>
        Skip to end of hand
      </button>
    </div>
  )
}

interface WaitingBarProps {
  label: string
}

/**
 * A plain, button-less placeholder for the control bar. Used in pass-and-play
 * games while bots are deciding between two humans' turns — nobody is holding
 * the device on anyone's behalf then, so there is nothing to pre-arm and
 * nothing that should be shown, just a reason the screen is quiet.
 */
export function WaitingBar({ label }: WaitingBarProps) {
  return (
    <div className="controls controls-waiting">
      <span className="waiting-label">{label}</span>
    </div>
  )
}

interface RevealGateProps {
  playerName: string
  onReveal: () => void
}

/**
 * Sits between two humans' turns in a pass-and-play game. Nothing about the
 * hand — cards, controls — appears until whoever now has the device confirms
 * it's actually them. That confirmation is the only thing standing between a
 * device changing hands and the previous player's hole cards still being lit
 * up on screen for the next person to see.
 */
export function RevealGate({ playerName, onReveal }: RevealGateProps) {
  return (
    <div className="controls controls-waiting">
      <span className="waiting-label">Pass the device to {playerName}</span>
      <button className="btn btn-reveal" onClick={onReveal}>
        I&rsquo;m {playerName} — show my hand
      </button>
    </div>
  )
}
