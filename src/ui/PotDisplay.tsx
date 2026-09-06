import type { Card } from '../poker/card'
import { CardView } from './CardView'
import { ChipIcon } from './icons'

interface PotDisplayProps {
  /** Chips already swept into the middle from earlier streets. */
  potSize: number
  /** Chips still sitting in front of seats on this street. */
  inPlay: number
  communityCards: Card[]
}

const STREET_LABEL: Record<number, string> = { 3: 'Flop', 4: 'Turn', 5: 'River' }

export function PotDisplay({ potSize, inPlay, communityCards }: PotDisplayProps) {
  // The headline is the whole pot — that is the number pot odds are figured
  // against. The sub-line says how much of it is still sitting in front of
  // players, which is what the chips beside each seat represent, so the two
  // readings agree instead of appearing to double-count.
  const total = potSize + inPlay
  const streetLabel = STREET_LABEL[communityCards.length]

  return (
    <div className="pot-display">
      {streetLabel && (
        <div className="board-street">
          <span className="board-street-rule" />
          <span className="board-street-label">{streetLabel}</span>
          <span className="board-street-rule" />
        </div>
      )}
      <div className="community-cards">
        {communityCards.map((card, i) => (
          <CardView key={i} card={card} size="sm" />
        ))}
      </div>
      {total > 0 && (
        <div className="pot-readout">
          <div className="pot-amount">
            <ChipIcon className="pot-amount-icon" />
            ${total.toLocaleString()}
          </div>
          {potSize > 0 && inPlay > 0 && (
            <div className="pot-in-play">${inPlay.toLocaleString()} still in front</div>
          )}
        </div>
      )}
    </div>
  )
}
