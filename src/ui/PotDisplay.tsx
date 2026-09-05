import type { Card } from '../poker/card'
import { CardView } from './CardView'

interface PotDisplayProps {
  /** Chips already swept into the middle from earlier streets. */
  potSize: number
  /** Chips still sitting in front of seats on this street. */
  inPlay: number
  communityCards: Card[]
}

export function PotDisplay({ potSize, inPlay, communityCards }: PotDisplayProps) {
  // The headline is the whole pot — that is the number pot odds are figured
  // against. The sub-line says how much of it is still sitting in front of
  // players, which is what the chips beside each seat represent, so the two
  // readings agree instead of appearing to double-count.
  const total = potSize + inPlay

  return (
    <div className="pot-display">
      <div className="community-cards">
        {communityCards.map((card, i) => (
          <CardView key={i} card={card} size="sm" />
        ))}
      </div>
      {total > 0 && (
        <div className="pot-readout">
          <div className="pot-amount">
            <span className="chip-dot chip-dot-pot" />
            Pot ${total.toLocaleString()}
          </div>
          {potSize > 0 && inPlay > 0 && (
            <div className="pot-in-play">${inPlay.toLocaleString()} still in front</div>
          )}
        </div>
      )}
    </div>
  )
}
