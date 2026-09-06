import type { Street } from '../poker/game-state'
import type { Speed } from './useHoldemGame'

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
  onExit: () => void
}

/**
 * Orientation and tempo controls. Everything here answers a question the
 * player would otherwise have to guess at: where am I in the hand, how am I
 * doing, and — crucially — can I make this stop.
 */
export function TableHud({
  handNumber,
  smallBlind,
  bigBlind,
  street,
  handsPlayed,
  net,
  speed,
  onSpeed,
  paused,
  onTogglePause,
  onStep,
  autoNextHand,
  onToggleAutoNextHand,
  showLog,
  onToggleLog,
  onExit,
}: TableHudProps) {
  const currentIndex = STREETS.findIndex((s) => s.key === street)

  return (
    <div className="hud">
      <div className="hud-group">
        <button type="button" className="hud-btn" onClick={onExit} title="Leave this table and reconfigure">
          Menu
        </button>
        <span className="hud-sep" />
        <span className="hud-strong">Hand {handNumber}</span>
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
        <span className="hud-dim">{handsPlayed} played</span>
        {net !== null && (
          <span className={`hud-net ${net >= 0 ? 'hud-net-up' : 'hud-net-down'}`}>
            {net >= 0 ? '+' : '−'}${Math.abs(net).toLocaleString()}
          </span>
        )}
        <span className="hud-sep" />

        <div className="segmented">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              className={`segment ${speed === s ? 'segment-on' : ''}`}
              onClick={() => onSpeed(s)}
            >
              {s}
            </button>
          ))}
        </div>

        <button type="button" className="hud-btn" onClick={onTogglePause} title="Pause the table (P)">
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          type="button"
          className="hud-btn"
          onClick={onStep}
          disabled={!paused}
          title="Play exactly one opponent action (S)"
        >
          Step
        </button>

        <button
          type="button"
          className={`hud-btn ${autoNextHand ? 'hud-btn-on' : ''}`}
          onClick={onToggleAutoNextHand}
          title="Deal the next hand without waiting for you"
        >
          Auto-deal
        </button>

        <button
          type="button"
          className={`hud-btn ${showLog ? 'hud-btn-on' : ''}`}
          onClick={onToggleLog}
          title="Show the running hand log"
        >
          Log
        </button>
      </div>
    </div>
  )
}
