import { useEffect, useRef } from 'react'
import type { PositionLabel } from '../poker/position'

interface Entry {
  label: PositionLabel
  name: string
  blurb: string
}

/**
 * Late position is better than early position because you act last and
 * therefore act knowing what everyone else did, so the list reads in acting
 * order after the flop — worst seat first, best seat last — rather than
 * alphabetically. UTG+n / MP+n only appear at bigger tables and are just
 * "one seat later than the one above", so they're covered by a footnote
 * instead of their own rows.
 */
const ENTRIES: Entry[] = [
  { label: 'SB', name: 'Small blind', blurb: 'Posts half a bet before cards are dealt. Acts first on every street after the flop — the worst seat to be in once the board is out.' },
  { label: 'BB', name: 'Big blind', blurb: 'Posts the full bet before cards are dealt. Gets the last word before the flop, so it can check its option for free.' },
  { label: 'UTG', name: 'Under the gun', blurb: 'First seat to act before the flop, with the whole table still to speak behind it. Needs the strongest hands to enter.' },
  { label: 'MP', name: 'Middle position', blurb: 'Past the early seats, not yet on the button. Comfortable but still has players to act behind it.' },
  { label: 'HJ', name: 'Hijack', blurb: 'Two seats to the right of the button — late enough to open a wide range of hands.' },
  { label: 'CO', name: 'Cutoff', blurb: 'One seat to the right of the button. Second-best seat at the table, and the one that steals the button’s advantage when the button folds.' },
  { label: 'BTN', name: 'Button (dealer)', blurb: 'The dealer disc. Acts LAST on the flop, turn and river — the single most profitable seat, which is why it moves one place left every hand.' },
]

interface PositionLegendProps {
  onClose: () => void
  /** Labels currently in use at this table, so the player can see which rows apply to them. */
  inUse: Set<string>
}

/** A reference card for the seat abbreviations printed under every player's name. */
export function PositionLegend({ onClose, inUse }: PositionLegendProps) {
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="dialog dialog-wide"
        role="dialog"
        aria-modal="true"
        aria-label="Table positions"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <h2 className="dialog-title">Table positions</h2>
          <button ref={closeRef} type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <p className="dialog-lede">
          The tag under each name is the seat’s <strong>position</strong> — where it sits relative to the dealer button,
          which decides when it has to act. Acting later is a real edge: you make your decision already knowing what
          everyone before you did. The button moves one seat clockwise every hand so the advantage is shared out.
        </p>

        <ul className="legend-list">
          {ENTRIES.map((entry) => (
            <li key={entry.label} className={`legend-row ${inUse.has(entry.label) ? 'legend-row-live' : ''}`}>
              <span className="legend-tag">{entry.label}</span>
              <div className="legend-text">
                <span className="legend-name">
                  {entry.name}
                  {inUse.has(entry.label) && <span className="legend-live-dot">at your table</span>}
                </span>
                <span className="legend-blurb">{entry.blurb}</span>
              </div>
            </li>
          ))}
        </ul>

        <p className="dialog-foot">
          Bigger tables add <span className="legend-tag-inline">UTG+1</span>, <span className="legend-tag-inline">UTG+2</span> and{' '}
          <span className="legend-tag-inline">MP+1</span> — each is simply one seat later than the plain version above.
          Heads-up there is no button tag: the dealer posts the small blind, so only <span className="legend-tag-inline">SB</span>{' '}
          and <span className="legend-tag-inline">BB</span> exist, and the small blind acts first after the flop.
        </p>
      </div>
    </div>
  )
}
