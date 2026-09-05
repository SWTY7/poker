import type { Card, Suit } from '../poker/card'
import { displayRank, isRedSuit } from '../poker/card'

interface CardViewProps {
  card?: Card
  faceDown?: boolean
  size?: 'sm' | 'lg'
}

/**
 * Drawn suit glyphs instead of the Unicode ♠♥♦♣ characters. The text glyphs
 * render at wildly different weights and optical sizes across fonts — at
 * small card sizes they're often the hardest part of the card to read. A
 * fixed-geometry SVG stays crisp and consistent at every size.
 */
const SUIT_PATH: Record<Exclude<Suit, 'clubs'>, string> = {
  hearts: 'M12 21S3 14.6 3 9.1A4.9 4.9 0 0 1 12 6.2 4.9 4.9 0 0 1 21 9.1C21 14.6 12 21 12 21z',
  diamonds: 'M12 2l9 10-9 10-9-10z',
  spades: 'M12 2c0 0-9 6.6-9 11.6a4.5 4.5 0 0 0 7.9 2.9c-.4 2.3-1.3 3.8-2.5 4.8h7.2c-1.2-1-2.1-2.5-2.5-4.8A4.5 4.5 0 0 0 21 13.6C21 8.6 12 2 12 2z',
}

// Three clearly separate lobes (not a single blobby path) plus a stem,
// mirroring how clubs actually read at a glance.
function ClubsIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12 12L9 20.6h6z" fill="currentColor" />
      <rect x="9.5" y="19.4" width="5" height="2.4" rx="0.7" fill="currentColor" />
      <circle cx="12" cy="7.6" r="3.9" fill="currentColor" />
      <circle cx="7.9" cy="13.2" r="3.9" fill="currentColor" />
      <circle cx="16.1" cy="13.2" r="3.9" fill="currentColor" />
    </svg>
  )
}

function SuitIcon({ suit, className }: { suit: Suit; className: string }) {
  if (suit === 'clubs') return <ClubsIcon className={className} />
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
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
