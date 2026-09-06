import type { Card } from '../poker/card'
import type { PositionLabel } from '../poker/position'
import { CardView } from './CardView'

interface HeroBarProps {
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
}

/** The human player's own seat — always rendered at a fixed spot at the bottom, cards large, regardless of table position. */
export function HeroBar({ name, stack, cards, position, isDealer, toCall, potOdds, folded, isAllIn }: HeroBarProps) {
  return (
    <div className={`hero-bar ${folded ? 'hero-bar-folded' : ''}`}>
      <div className="hero-cards">
        {cards.length > 0 ? (
          cards.map((card, i) => <CardView key={i} card={card} size="lg" />)
        ) : (
          <>
            <CardView faceDown size="lg" />
            <CardView faceDown size="lg" />
          </>
        )}
      </div>
      <div className="hero-id">
        <div className="hero-id-top">
          <span className="hero-name">{name}</span>
          {position && <span className="seat-position">{position}</span>}
          {isDealer && <span className="seat-dealer-disc">D</span>}
        </div>
        <span className="hero-stack">${stack.toLocaleString()}</span>
      </div>
      <div className="hero-spacer" />
      {!folded && !isAllIn && (
        <div className="hero-stats">
          <div className="hero-stat">
            <span className="hero-stat-label">To call</span>
            <span className="hero-stat-value">${toCall.toLocaleString()}</span>
          </div>
          {potOdds !== null && (
            <div className="hero-stat">
              <span className="hero-stat-label">Pot odds</span>
              <span className="hero-stat-value hero-stat-accent">{Math.round(potOdds * 100)}%</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
