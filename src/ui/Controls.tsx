import { useEffect, useRef, useState } from 'react'
import type { ActionType } from '../poker/game-state'
import type { PreAction } from './useHoldemGame'

interface ControlsProps {
  legalActions: ActionType[]
  toCall: number
  minRaiseTo: number
  maxRaiseTo: number
  /** Everything already in the middle, plus this street's bets. */
  potSize: number
  /** The hero's remaining chips — used to tell a max-size raise apart from a shove. */
  stack: number
  /** True on a phone-width screen: the sizing panel replaces the buttons instead of sitting above them. */
  compact: boolean
  onAction: (type: ActionType, amount?: number) => void
}

/** Fraction-of-pot shortcuts, as a raise TO amount. */
function potFractionTarget(potSize: number, toCall: number, fraction: number): number {
  return Math.round(toCall + (potSize + toCall) * fraction)
}

/**
 * The action bar.
 *
 * Two rules shape it. First, it only ever shows actions that are legal right
 * now — there is no greyed-out furniture to read past. Second, every button
 * says what it will actually cost: "Call $50", "Raise to $150", never a bare
 * "Bet" that leaves the player working out whether the number beside it is
 * the amount added or the total wagered.
 *
 * On a phone the sizing panel (slider, presets, numeric entry) is a second
 * step behind the Bet/Raise button rather than permanently occupying a third
 * of the screen. That panel is only relevant once you have decided to put
 * chips in; until then it is display competing with the table. On a wider
 * screen there is room for both at once, so it stays inline.
 */
export function Controls({
  legalActions,
  toCall,
  minRaiseTo,
  maxRaiseTo,
  potSize,
  stack,
  compact,
  onAction,
}: ControlsProps) {
  const canRaise = legalActions.includes('bet') || legalActions.includes('raise')
  const raiseType: ActionType = legalActions.includes('bet') ? 'bet' : 'raise'
  const raiseVerb = raiseType === 'bet' ? 'Bet' : 'Raise to'
  const [amount, setAmount] = useState(minRaiseTo)
  const [sizing, setSizing] = useState(false)
  const amountRef = useRef<HTMLInputElement>(null)

  // Each new betting round should offer the minimum raise again rather than
  // whatever was dialled in last street. Adjusting during render (rather than
  // in an effect) avoids briefly showing the stale figure.
  const bounds = `${minRaiseTo}:${maxRaiseTo}`
  const [lastBounds, setLastBounds] = useState(bounds)
  if (lastBounds !== bounds) {
    setLastBounds(bounds)
    setAmount(Math.min(minRaiseTo, maxRaiseTo))
    setSizing(false)
  }

  const clamp = (value: number) => Math.min(Math.max(value, minRaiseTo), maxRaiseTo)
  const clampedAmount = clamp(amount)
  const isShove = clampedAmount >= maxRaiseTo && maxRaiseTo >= stack

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
        case 'escape':
          setSizing(false)
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

  const presets: { label: string; hint?: string; value: number }[] = [
    { label: 'Min', value: minRaiseTo },
    { label: '½ pot', hint: '1', value: potFractionTarget(potSize, toCall, 0.5) },
    { label: '¾ pot', hint: '2', value: potFractionTarget(potSize, toCall, 0.75) },
    { label: 'Pot', hint: '3', value: potFractionTarget(potSize, toCall, 1) },
    { label: 'All-in', value: maxRaiseTo },
  ]

  const sizer = (
    <div className="sizer">
      <div className="sizer-readout">
        <span className="label">{raiseVerb}</span>
        <div className="sizer-amount">
          <span className="sizer-currency" aria-hidden="true">
            $
          </span>
          {/* Typing the number beats hunting for it on a slider whenever the
              player already knows what they want to make it. */}
          <input
            ref={amountRef}
            className="sizer-input money"
            type="number"
            inputMode="numeric"
            min={minRaiseTo}
            max={maxRaiseTo}
            step={1}
            value={amount}
            aria-label={`${raiseVerb} amount in dollars`}
            onChange={(e) => setAmount(Number(e.target.value))}
            onBlur={() => setAmount(clampedAmount)}
          />
        </div>
        {isShove && <span className="sizer-shove">Your whole stack</span>}
      </div>

      <input
        className="sizer-slider"
        type="range"
        min={minRaiseTo}
        max={maxRaiseTo}
        value={clampedAmount}
        aria-label={`${raiseVerb} amount`}
        aria-valuetext={`$${clampedAmount.toLocaleString()}`}
        onChange={(e) => setAmount(Number(e.target.value))}
      />

      <div className="sizer-bounds" aria-hidden="true">
        <span>min ${minRaiseTo.toLocaleString()}</span>
        <span>max ${maxRaiseTo.toLocaleString()}</span>
      </div>

      <div className="sizer-presets">
        {presets.map((preset) => {
          const value = clamp(preset.value)
          const active = value === clampedAmount
          return (
            <button
              key={preset.label}
              type="button"
              className={`btn btn-sm btn-preset ${active ? 'btn-preset-on' : ''}`}
              onClick={() => setAmount(value)}
              aria-pressed={active}
            >
              {preset.label}
              {preset.hint && <kbd>{preset.hint}</kbd>}
            </button>
          )
        })}
      </div>
    </div>
  )

  const raiseLabel = isShove
    ? `All-in $${clampedAmount.toLocaleString()}`
    : `${raiseVerb} $${clampedAmount.toLocaleString()}`

  // Phone, mid-raise: the sizing panel takes the dock over entirely, with one
  // way forward and one way back. Nothing else competes for the thumb.
  if (compact && sizing && canRaise) {
    return (
      <div className="dock dock-sizing">
        {sizer}
        <div className="dock-row">
          <button type="button" className="btn btn-secondary dock-back" onClick={() => setSizing(false)}>
            Back
          </button>
          <button
            type="button"
            className="btn btn-lg btn-primary dock-confirm"
            onClick={() => onAction(raiseType, clampedAmount)}
          >
            {raiseLabel}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="dock">
      {!compact && canRaise && sizer}

      <div className="dock-row">
        {legalActions.includes('fold') && (
          <button type="button" className="btn btn-lg btn-danger dock-fold" onClick={() => onAction('fold')}>
            Fold <kbd>F</kbd>
          </button>
        )}

        {legalActions.includes('check') && (
          <button type="button" className="btn btn-lg btn-primary dock-continue" onClick={() => onAction('check')}>
            Check <kbd>C</kbd>
          </button>
        )}

        {legalActions.includes('call') && (
          <button type="button" className="btn btn-lg btn-primary dock-continue" onClick={() => onAction('call')}>
            Call ${toCall.toLocaleString()} <kbd>C</kbd>
          </button>
        )}

        {canRaise &&
          (compact ? (
            <button type="button" className="btn btn-lg btn-accent dock-raise" onClick={() => setSizing(true)}>
              {raiseType === 'bet' ? 'Bet' : 'Raise'} <span aria-hidden="true">▸</span>
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-lg btn-accent dock-raise"
              onClick={() => onAction(raiseType, clampedAmount)}
            >
              {raiseLabel} <kbd>R</kbd>
            </button>
          ))}

        {legalActions.includes('all-in') && !canRaise && (
          <button type="button" className="btn btn-lg btn-accent dock-raise" onClick={() => onAction('all-in')}>
            All-in ${stack.toLocaleString()} <kbd>A</kbd>
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
 * Occupies the dock whenever it is not the player's turn, so the bottom of
 * the screen never collapses and reflows. While an opponent is deciding it
 * also offers pre-actions: committing a decision in advance turns dead time
 * into a choice the player is making, rather than time they sit through.
 */
export function PreActionBar({ toCall, value, onChange, waitingOn, dealing }: PreActionBarProps) {
  const toggle = (next: PreAction) => onChange(value === next ? null : next)

  return (
    <div className="dock dock-waiting">
      <span className="dock-status">
        {dealing ? 'Dealing…' : waitingOn ? `${waitingOn} is deciding…` : 'Waiting…'}
      </span>
      {!dealing && (
        <div className="dock-row dock-row-pre">
          <button
            type="button"
            className={`btn btn-sm ${value === 'check-fold' ? 'btn-preset-on' : ''}`}
            onClick={() => toggle('check-fold')}
            aria-pressed={value === 'check-fold'}
          >
            {toCall > 0 ? 'Fold when it’s me' : 'Check / fold'}
          </button>
          <button
            type="button"
            className={`btn btn-sm ${value === 'call-any' ? 'btn-preset-on' : ''}`}
            onClick={() => toggle('call-any')}
            aria-pressed={value === 'call-any'}
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
 * Takes over the dock once nobody at the table has a decision left to make
 * this hand — folded, or all-in — but the hand itself is still being played
 * out. Without this the bottom of the screen simply went empty, which reads
 * as the game having stalled rather than as "nothing left to decide".
 */
export function SpectatingBar({ message, onSkip }: SpectatingBarProps) {
  return (
    <div className="dock dock-waiting">
      <span className="dock-status">{message}</span>
      <button type="button" className="btn btn-secondary" onClick={onSkip}>
        Skip to end of hand
      </button>
    </div>
  )
}

interface WaitingBarProps {
  label: string
}

/**
 * A plain, button-less placeholder for the dock. Used in pass-and-play games
 * while bots are deciding between two humans' turns — nobody is holding the
 * device on anyone's behalf then, so there is nothing to pre-arm and nothing
 * that should be shown, just a reason the screen is quiet.
 */
export function WaitingBar({ label }: WaitingBarProps) {
  return (
    <div className="dock dock-waiting">
      <span className="dock-status">{label}</span>
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
    <div className="dock dock-waiting">
      <span className="dock-status">Pass the device to {playerName}</span>
      <button type="button" className="btn btn-primary" onClick={onReveal}>
        I&rsquo;m {playerName} — show my hand
      </button>
    </div>
  )
}
