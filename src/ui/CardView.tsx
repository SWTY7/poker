import type { Card, Suit } from '../poker/card'
import { displayRank, isRedSuit } from '../poker/card'
import { SUIT_PATH } from './suit-icons'

interface CardViewProps {
  card?: Card
  faceDown?: boolean
  size?: 'sm' | 'lg'
}

function SuitIcon({ suit, className }: { suit: Suit; className: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d={SUIT_PATH[suit]} fill="currentColor" />
    </svg>
  )
}

export function CardView({ card, faceDown, size = 'sm' }: CardViewProps) {
  if (faceDown || !card) {
    return <div className={`card card-back card-${size}`} />
  }

  const red = isRedSuit(card.suit)
  return (
    <div className={`card card-face card-${size} ${red ? 'card-red' : 'card-black'}`}>
      <span className="card-rank">{displayRank(card.rank)}</span>
      <SuitIcon suit={card.suit} className="card-suit" />
    </div>
  )
}
