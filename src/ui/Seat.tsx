import type { Card } from '../poker/card'
import type { PositionLabel } from '../poker/position'
import { CardView } from './CardView'

export interface SeatProps {
  name: string
  stack: number
  betThisStreet: number
  folded: boolean
  isAllIn: boolean
  isEliminated: boolean
  isDealer: boolean
  isCurrentTurn: boolean
  isHero: boolean
  isWinner: boolean
  position?: PositionLabel
  /** What this player did on the CURRENT street only. */
  lastAction?: string
  cards: Card[]
  revealCards: boolean
  left: number
  top: number
}

export function Seat({
  name,
  stack,
  betThisStreet,
  folded,
  isAllIn,
  isEliminated,
  isDealer,
  isCurrentTurn,
  isHero,
  isWinner,
  position,
  lastAction,
  cards,
  revealCards,
  left,
  top,
}: SeatProps) {
  if (isEliminated) return null

  const classes = [
    'seat',
    folded && 'seat-folded',
    isCurrentTurn && 'seat-active',
    isHero && 'seat-hero',
    isWinner && 'seat-winner',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes} style={{ left: `${left}%`, top: `${top}%` }}>
      <div className="seat-cards">
        {cards.length > 0 ? (
          cards.map((card, i) => (
            <CardView key={i} card={card} faceDown={!revealCards} size={isHero ? 'lg' : 'sm'} />
          ))
        ) : (
          <>
            <CardView faceDown size={isHero ? 'lg' : 'sm'} />
            <CardView faceDown size={isHero ? 'lg' : 'sm'} />
          </>
        )}
      </div>

      <div className="seat-plate">
        {isDealer && <span className="seat-badge seat-badge-dealer">D</span>}
        <div className="seat-head">
          <span className="seat-name">{name}</span>
          {position && <span className="seat-position">{position}</span>}
        </div>
        <div className="seat-stack">${stack.toLocaleString()}</div>
        <div className="seat-status">{folded ? 'Folded' : isAllIn ? 'All-in' : (lastAction ?? '')}</div>
      </div>

      {betThisStreet > 0 && !folded && (
        <div className="seat-bet-chip">
          <span className="chip-dot" />${betThisStreet.toLocaleString()}
        </div>
      )}
    </div>
  )
}
