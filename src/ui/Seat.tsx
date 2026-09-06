import type { Card } from '../poker/card'
import type { PositionLabel } from '../poker/position'
import { CardView } from './CardView'
import { CoinIcon } from './icons'
import { avatarInitial, avatarStyle } from './avatar'

export interface SeatProps {
  name: string
  stack: number
  betThisStreet: number
  folded: boolean
  isAllIn: boolean
  isEliminated: boolean
  isDealer: boolean
  isCurrentTurn: boolean
  isWinner: boolean
  position?: PositionLabel
  /** What this player did on the CURRENT street only. */
  lastAction?: string
  cards: Card[]
  revealCards: boolean
}

/** A compact opponent tile in the strip above the board — the human player's own seat renders separately, in HeroBar. */
export function Seat({
  name,
  stack,
  betThisStreet,
  folded,
  isAllIn,
  isEliminated,
  isDealer,
  isCurrentTurn,
  isWinner,
  position,
  lastAction,
  cards,
  revealCards,
}: SeatProps) {
  if (isEliminated) return null

  const classes = ['seat', folded && 'seat-folded', isCurrentTurn && 'seat-active', isWinner && 'seat-winner']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      <div className="seat-head">
        <div className="seat-avatar" style={avatarStyle(name)}>
          {avatarInitial(name)}
        </div>
        <div className="seat-id">
          <span className="seat-name">{name}</span>
          <span className="seat-position">
            {position}
            {isDealer && <span className="seat-dealer-disc">D</span>}
          </span>
        </div>
      </div>

      {revealCards && cards.length > 0 && (
        <div className="seat-cards">
          {cards.map((card, i) => (
            <CardView key={i} card={card} size="sm" />
          ))}
        </div>
      )}

      <div className="seat-foot">
        <span className="seat-stack">{stack.toLocaleString()}</span>
        {betThisStreet > 0 && !folded ? (
          <span className="seat-bet">
            <CoinIcon className="seat-bet-icon" />
            {betThisStreet.toLocaleString()}
          </span>
        ) : (
          <span className="seat-status">{folded ? 'FOLD' : isAllIn ? 'ALL-IN' : (lastAction ?? '')}</span>
        )}
      </div>
    </div>
  )
}
