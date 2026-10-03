import type { CSSProperties } from 'react'
import type { Card } from '../poker/card'
import type { Street } from '../poker/game-state'
import { CardView } from './CardView'
import { CoinIcon } from './icons'

interface BoardProps {
  communityCards: Card[]
  /** Chips already swept into the middle from earlier streets. */
  potSize: number
  /** Chips still sitting in front of seats on this street. */
  inPlay: number
  street: Street
  /** The pot is drawn as chips counted in big blinds. */
  bigBlind: number
}

const STREET_LABEL: Record<Street, string> = {
  preflop: 'Pre-flop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'Showdown',
}

/** How many board cards exist by the time each street is being acted on. */
const CARDS_BY_STREET: Record<Street, number> = {
  preflop: 0,
  flop: 3,
  turn: 4,
  river: 5,
  showdown: 5,
}

/**
 * The middle of the table: the board, and the pot it is being played for.
 *
 * Two deliberate choices here.
 *
 * The board always renders five slots. An undealt card is an outline rather
 * than nothing, so the board keeps one width all hand and the flop → turn →
 * river progression reads as slots filling in — instead of the whole row
 * jumping wider and re-centring twice a hand.
 *
 * The street name is a small caption, not a headline. It labels the cards; it
 * is not more important than them.
 */
/**
 * The pot as chips on the felt: more chips the bigger the pot, in stacks that
 * are added to as it grows. Counted against the big blind and eased with a
 * square root, so a big pot is clearly bigger without a hundred chips.
 */
const MAX_POT_CHIPS = 48
const MAX_STACK = 8
const MAX_POT_STACKS = 6

function PotChips({ amount, unit }: { amount: number; unit: number }) {
  const count = amount <= 0 ? 0 : Math.min(MAX_POT_CHIPS, Math.ceil(Math.sqrt(amount / Math.max(unit, 1)) * 3))
  const stacks = Math.min(MAX_POT_STACKS, Math.ceil(count / MAX_STACK))
  return (
    <div className="pot-chips" aria-hidden="true">
      {Array.from({ length: stacks }, (_, s) => {
        // Spread the chips over the stacks as evenly as they go.
        const height = Math.floor(count / stacks) + (s < count % stacks ? 1 : 0)
        return (
          <span key={s} className="pot-stack" style={{ '--s': s } as CSSProperties}>
            {Array.from({ length: height }, (_, k) => (
              <i key={k} style={{ '--k': k } as CSSProperties} />
            ))}
          </span>
        )
      })}
    </div>
  )
}

export function Board({ communityCards, potSize, inPlay, street, bigBlind }: BoardProps) {
  // The headline is the whole pot — that is the number pot odds are figured
  // against. The sub-line says how much of it is still in front of players,
  // which is what the chips beside each seat represent, so the two readings
  // agree instead of appearing to double-count.
  const total = potSize + inPlay
  const dealtCount = communityCards.length

  return (
    <div className="board">
      <div className="board-street" aria-hidden="true">
        <span className="board-street-rule" />
        <span className="board-street-label">{STREET_LABEL[street]}</span>
        <span className="board-street-rule" />
      </div>

      <div
        className="board-cards"
        role="group"
        aria-label={
          dealtCount === 0
            ? 'Board: no cards yet'
            : `Board: ${communityCards.map((c) => `${c.rank} of ${c.suit}`).join(', ')}`
        }
      >
        {Array.from({ length: 5 }, (_, i) => {
          const card = communityCards[i]
          if (!card) return <CardView key={`slot-${i}`} size="md" slot />
          // Only the cards this street just turned over animate; the ones
          // already face-up shouldn't re-land every time the pot changes.
          const justDealt = i >= CARDS_BY_STREET[street] - (dealtCount === 3 ? 3 : 1)
          return (
            <CardView
              key={`${card.rank}${card.suit}`}
              card={card}
              size="md"
              index={i}
              animate={justDealt}
            />
          )
        })}
      </div>

      <div className="pot">
        <PotChips amount={total} unit={bigBlind} />
        <span className="label">Pot</span>
        <span className="pot-amount money">
          <CoinIcon className="pot-icon" aria-hidden="true" />${total.toLocaleString()}
        </span>
        {inPlay > 0 && potSize > 0 && (
          <span className="pot-sub">${inPlay.toLocaleString()} still in front</span>
        )}
      </div>
    </div>
  )
}
