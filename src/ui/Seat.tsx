import type { Card } from '../poker/card'
import { POSITION_NAMES, type PositionLabel } from '../poker/position'
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
  isSmallBlind: boolean
  isBigBlind: boolean
  isCurrentTurn: boolean
  isWinner: boolean
  /** The hand is over and this seat didn't win it. */
  hasLost?: boolean
  position?: PositionLabel
  /** What this player did on the CURRENT street only. */
  lastAction?: string
  cards: Card[]
  revealCards: boolean
}

/**
 * One opponent, as a seat at the table rather than a card in a dashboard.
 *
 * The hierarchy is deliberate and fixed: name (who), stack (the number that
 * matters), then status (what they just did). Everything else — position,
 * button, blinds — is a badge, because a badge can be scanned without being
 * read.
 *
 * State is never carried by colour alone: the active seat gets a ring AND a
 * pip AND an accessible "to act" label; a folded seat is dimmed AND says
 * FOLDED; a winner is ringed AND says WON.
 */
export function Seat({
  name,
  stack,
  betThisStreet,
  folded,
  isAllIn,
  isEliminated,
  isDealer,
  isSmallBlind,
  isBigBlind,
  isCurrentTurn,
  isWinner,
  hasLost,
  position,
  lastAction,
  cards,
  revealCards,
}: SeatProps) {
  if (isEliminated) return null

  const classes = [
    'seat',
    folded && 'seat-folded',
    isCurrentTurn && 'seat-active',
    isWinner && 'seat-winner',
    hasLost && 'seat-lost',
    isAllIn && 'seat-allin',
  ]
    .filter(Boolean)
    .join(' ')

  const status = folded ? 'Folded' : isWinner ? 'Won' : isAllIn ? 'All-in' : (lastAction ?? '')

  const state = isCurrentTurn ? 'to act' : folded ? 'folded' : isAllIn ? 'all-in' : isWinner ? 'won the pot' : 'waiting'

  return (
    <div
      className={classes}
      aria-label={`${name}, ${position ? `${position}, ` : ''}$${stack.toLocaleString()}, ${state}`}
    >
      <div className="seat-top">
        <span className="seat-avatar" style={avatarStyle(name)} aria-hidden="true">
          {avatarInitial(name)}
        </span>
        {isCurrentTurn && <span className="seat-pip" aria-hidden="true" />}
      </div>

      <span className="seat-name">{name}</span>

      <span className="seat-badges">
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
        {/* The position tag already reads SB/BB at those two seats, so only
            add a blind badge where it would say something new — which is
            heads-up, where the button posts the small blind and there is no
            BTN tag to carry it. */}
        {isSmallBlind && position !== 'SB' && (
          <span className="badge badge-blind" title="Small blind">
            SB
          </span>
        )}
        {isBigBlind && position !== 'BB' && (
          <span className="badge badge-blind" title="Big blind">
            BB
          </span>
        )}
      </span>

      <span className="seat-stack money">${stack.toLocaleString()}</span>

      {revealCards && cards.length > 0 && (
        <div className="seat-cards">
          {cards.map((card, i) => (
            <CardView key={i} card={card} size="sm" index={i} />
          ))}
        </div>
      )}

      <span className={`seat-status ${folded ? 'seat-status-folded' : ''} ${isWinner ? 'seat-status-won' : ''}`}>
        {status || ' '}
      </span>

      {/* The chips this player has pushed out this street, rendered below the
          seat so they read as sitting on the felt between them and the pot —
          which is where they'd physically be. */}
      {betThisStreet > 0 && !folded && (
        <span className="seat-bet money" aria-label={`has bet $${betThisStreet.toLocaleString()}`}>
          <CoinIcon className="seat-bet-icon" />
          {betThisStreet.toLocaleString()}
        </span>
      )}
    </div>
  )
}
