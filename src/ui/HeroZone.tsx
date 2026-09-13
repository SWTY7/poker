import type { Card } from '../poker/card'
import { POSITION_NAMES, type PositionLabel } from '../poker/position'
import { CardView } from './CardView'
import { PercentIcon } from './icons'

interface HeroZoneProps {
  name: string
  stack: number
  cards: Card[]
  position?: PositionLabel
  isDealer: boolean
  toCall: number
  /** 0..1, or null when there's nothing to call and the stat doesn't apply. */
  potOdds: number | null
  folded: boolean
  isAllIn: boolean
  isMyTurn: boolean
  /** What the hero currently holds, e.g. "Pair of nines". Null before the flop. */
  madeHand: string | null
  /** Opens the hand-potential drawer. Absent when the study aid is switched off. */
  onShowPotential?: () => void
  potentialOpen?: boolean
}

/**
 * The hero's own seat. Fixed at the bottom of the screen whatever their
 * actual seat at the table, because the one thing that must never move
 * between betting rounds is where your own cards are.
 *
 * This is also the only place the app says "it's your turn" in words rather
 * than by highlighting something — the ring on a seat is easy to miss on a
 * phone held at arm's length.
 */
export function HeroZone({
  name,
  stack,
  cards,
  position,
  isDealer,
  toCall,
  potOdds,
  folded,
  isAllIn,
  isMyTurn,
  madeHand,
  onShowPotential,
  potentialOpen,
}: HeroZoneProps) {
  const classes = ['hero', folded && 'hero-folded', isMyTurn && 'hero-turn'].filter(Boolean).join(' ')

  return (
    <div className={classes}>
      <div className="hero-cards">
        {cards.length > 0 ? (
          cards.map((card, i) => <CardView key={`${card.rank}${card.suit}`} card={card} size="lg" index={i} />)
        ) : (
          <>
            <CardView faceDown size="lg" index={0} />
            <CardView faceDown size="lg" index={1} />
          </>
        )}
      </div>

      <div className="hero-info">
        <div className="hero-id">
          {isMyTurn && <span className="hero-turn-chip">Your turn</span>}
          <span className="hero-name">{name}</span>
          {position && (
            <span className="badge badge-pos" title={POSITION_NAMES[position]}>
              {position}
            </span>
          )}
          {isDealer && (
            <span className="badge badge-dealer" title="Dealer button">
              D
            </span>
          )}
        </div>

        <div className="hero-stack-row">
          <span className="label">Stack</span>
          <span className="hero-stack money">${stack.toLocaleString()}</span>
        </div>

        {/* What the hole cards plus the board currently make. The single most
            useful line for a player still learning to read a board, and it
            costs one row. */}
        {madeHand && !folded && <div className="hero-made">{madeHand}</div>}

        {folded && <div className="hero-state">Folded this hand</div>}
        {isAllIn && !folded && <div className="hero-state">All-in</div>}
      </div>

      <div className="hero-right">
        {!folded && !isAllIn && toCall > 0 && (
          <div className="hero-tocall">
            <span className="label">To call</span>
            <span className="hero-tocall-amount money">${toCall.toLocaleString()}</span>
            {potOdds !== null && <span className="hero-tocall-odds">{Math.round(potOdds * 100)}% of pot</span>}
          </div>
        )}

        {onShowPotential && (
          <button
            type="button"
            className={`btn btn-sm btn-ghost hero-potential-btn ${potentialOpen ? 'btn-on' : ''}`}
            onClick={onShowPotential}
            aria-expanded={potentialOpen}
          >
            <PercentIcon className="hero-potential-icon" />
            Potential
          </button>
        )}
      </div>
    </div>
  )
}
