import type { Card, Suit } from '../poker/card'
import { cardToString, displayRank, isRedSuit } from '../poker/card'
import { SUIT_PATH } from './suit-icons'

export type CardSize = 'sm' | 'md' | 'lg'

interface CardViewProps {
  card?: Card
  faceDown?: boolean
  /** sm = opponent seats, md = the board, lg = the hero's own hand. */
  size?: CardSize
  /** Renders the outline of a card that hasn't been dealt yet. */
  slot?: boolean
  /** Position in a dealt group; staggers the landing animation left to right. */
  index?: number
  /** Set false to skip the landing animation (cards that were already on screen). */
  animate?: boolean
}

function SuitIcon({ suit, className }: { suit: Suit; className: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true">
      <path d={SUIT_PATH[suit]} fill="currentColor" />
    </svg>
  )
}

const SUIT_WORD: Record<Suit, string> = {
  spades: 'of spades',
  hearts: 'of hearts',
  diamonds: 'of diamonds',
  clubs: 'of clubs',
}

export function CardView({ card, faceDown, size = 'sm', slot, index = 0, animate = true }: CardViewProps) {
  const deal = animate ? ' card-dealt' : ''
  const style = animate ? ({ '--i': index } as React.CSSProperties) : undefined

  if (slot) {
    return <div className={`card card-slot card-${size}`} aria-hidden="true" />
  }

  if (faceDown || !card) {
    return <div className={`card card-back card-${size}${deal}`} style={style} role="img" aria-label="Face-down card" />
  }

  const red = isRedSuit(card.suit)
  return (
    <div
      className={`card card-face card-${size} ${red ? 'card-red' : 'card-black'}${deal}`}
      style={style}
      role="img"
      // Screen readers get the spoken name; sighted players get the glyph.
      aria-label={`${displayRank(card.rank)} ${SUIT_WORD[card.suit]}`}
      title={cardToString(card)}
    >
      <span className="card-rank">{displayRank(card.rank)}</span>
      <SuitIcon suit={card.suit} className="card-suit" />
    </div>
  )
}
