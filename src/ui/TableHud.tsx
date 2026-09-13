import { useEffect, useState } from 'react'
import type { Street } from '../poker/game-state'
import type { Speed } from './useHoldemGame'
import { useMediaQuery } from './useMediaQuery'

const STREETS: { key: Street; label: string }[] = [
  { key: 'preflop', label: 'Preflop' },
  { key: 'flop', label: 'Flop' },
  { key: 'turn', label: 'Turn' },
  { key: 'river', label: 'River' },
  { key: 'showdown', label: 'Showdown' },
]

const SPEEDS: Speed[] = ['slow', 'normal', 'fast']

interface TableHudProps {
  handNumber: number
  smallBlind: number
  bigBlind: number
  street: Street
  handsPlayed: number
  /** Session profit/loss for the one human, or null in a pass-and-play game where a single figure wouldn't mean much. */
  net: number | null
  speed: Speed
  onSpeed: (speed: Speed) => void
  paused: boolean
  onTogglePause: () => void
  onStep: () => void
  autoNextHand: boolean
  onToggleAutoNextHand: () => void
  showLog: boolean
  onToggleLog: () => void
  onShowPositions: () => void
  onExit: () => void
}

type TempoProps = Pick<
  TableHudProps,
  | 'speed'
  | 'onSpeed'
  | 'paused'
  | 'onTogglePause'
  | 'onStep'
  | 'autoNextHand'
  | 'onToggleAutoNextHand'
  | 'showLog'
  | 'onToggleLog'
  | 'onShowPositions'
>

/**
 * Everything that controls the table's tempo or what's on screen, as opposed
 * to what's happening in the hand. Rendered inline in the bar on a wide
 * screen, and inside the sheet on a phone — same buttons either way, so the
 * two can't drift apart.
 */
function TempoControls({
  speed,
  onSpeed,
  paused,
  onTogglePause,
  onStep,
  autoNextHand,
  onToggleAutoNextHand,
  showLog,
  onToggleLog,
  onShowPositions,
  grouped = false,
}: TempoProps & { grouped?: boolean }) {
  return (
    <>
      {grouped && <h3 className="sheet-group">Tempo</h3>}
      <div className="segmented">
        {SPEEDS.map((s) => (
          <button key={s} type="button" className={`segment ${speed === s ? 'segment-on' : ''}`} onClick={() => onSpeed(s)}>
            {s}
          </button>
        ))}
      </div>

      <button type="button" className="btn hud-btn" onClick={onTogglePause} title="Pause the table (P)">
        {paused ? 'Resume' : 'Pause'}
      </button>
      <button type="button" className="btn hud-btn" onClick={onStep} disabled={!paused} title="Play exactly one opponent action (S)">
        Step
      </button>

      <button
        type="button"
        className={`btn hud-btn ${autoNextHand ? 'hud-btn-on' : ''}`}
        onClick={onToggleAutoNextHand}
        title="Deal the next hand without waiting for you"
      >
        Auto-deal
      </button>

      {grouped && <h3 className="sheet-group">View</h3>}

      <button
        type="button"
        className={`btn hud-btn ${showLog ? 'hud-btn-on' : ''}`}
        onClick={onToggleLog}
        title="Show the running hand log"
      >
        Log
      </button>

      <button
        type="button"
        className="btn hud-btn"
        onClick={onShowPositions}
        title="What do BTN, SB, BB, UTG… mean?"
      >
        Positions <span aria-hidden="true">?</span>
      </button>
    </>
  )
}

/**
 * Orientation and tempo controls. Everything here answers a question the
 * player would otherwise have to guess at: where am I in the hand, how am I
 * doing, and — crucially — can I make this stop.
 *
 * On a phone the tempo half moves into a sheet behind a single button. It
 * used to stay in the bar inside a horizontal scroller, which meant half of
 * it sat off the right edge of the screen with nothing to say so: the last
 * button was sliced down the middle and Auto-deal, Log and the speed control
 * were, in practice, undiscoverable.
 */
export function TableHud({
  handNumber,
  smallBlind,
  bigBlind,
  street,
  handsPlayed,
  net,
  onExit,
  ...tempo
}: TableHudProps) {
  const currentIndex = STREETS.findIndex((s) => s.key === street)
  const compact = useMediaQuery('(max-width: 820px)')
  const [sheetOpen, setSheetOpen] = useState(false)

  // A sheet that outlives the width it was opened at would be unreachable,
  // so closing it is part of the width change itself. Adjusting state during
  // render (rather than in an effect) is React's own recommendation for
  // "reset something when a prop changes" — it re-renders before anything
  // paints, instead of showing one frame of the wrong thing first.
  const [wasCompact, setWasCompact] = useState(compact)
  if (wasCompact !== compact) {
    setWasCompact(compact)
    setSheetOpen(false)
  }

  useEffect(() => {
    if (!sheetOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSheetOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [sheetOpen])

  return (
    <div className="hud">
      <div className="hud-group">
        <button type="button" className="btn hud-btn" onClick={onExit} title="Cash out and leave this table">
          Leave
        </button>
        <span className="hud-sep" />
        <span className="hud-hand">Hand {handNumber}</span>
        <span className="hud-sep" />
        <span className="hud-dim">
          ${smallBlind} / ${bigBlind}
        </span>
      </div>

      <div className="street-stepper">
        {STREETS.map((s, i) => (
          <span
            key={s.key}
            className={`street-step ${i === currentIndex ? 'street-step-current' : ''} ${i < currentIndex ? 'street-step-done' : ''}`}
          >
            {s.label}
          </span>
        ))}
      </div>

      <div className="hud-group hud-controls">
        {!compact && <span className="hud-dim">{handsPlayed} played</span>}
        {net !== null && (
          <span className={`hud-net ${net >= 0 ? 'hud-net-up' : 'hud-net-down'}`}>
            {net >= 0 ? '+' : '−'}${Math.abs(net).toLocaleString()}
          </span>
        )}
        <span className="hud-sep" />

        {compact ? (
          <button
            type="button"
            className={`btn hud-btn hud-btn-icon ${sheetOpen ? 'hud-btn-on' : ''}`}
            onClick={() => setSheetOpen(true)}
            aria-label="Table controls"
            aria-expanded={sheetOpen}
          >
            ⋯
          </button>
        ) : (
          <TempoControls {...tempo} />
        )}
      </div>

      {compact && sheetOpen && (
        <div className="overlay overlay-sheet" onClick={() => setSheetOpen(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-label="Table controls" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-head">
              <h2 className="dialog-title">Table</h2>
              <button type="button" className="btn hud-btn" onClick={() => setSheetOpen(false)}>
                Done
              </button>
            </div>
            <p className="sheet-meta">
              {handsPlayed} hand{handsPlayed === 1 ? '' : 's'} played · blinds ${smallBlind}/${bigBlind}
            </p>
            {/* Speed, pause, step and auto-deal leave the sheet open — they're
                often pressed more than once. The two that change what's on
                screen *behind* the sheet dismiss it, so the player can see
                what they just asked for. */}
            <div className="sheet-controls">
              <TempoControls
                {...tempo}
                grouped
                onToggleLog={() => {
                  setSheetOpen(false)
                  tempo.onToggleLog()
                }}
                onShowPositions={() => {
                  setSheetOpen(false)
                  tempo.onShowPositions()
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
