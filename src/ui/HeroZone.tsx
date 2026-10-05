import type { Card } from '../poker/card'
import { POSITION_NAMES, type PositionLabel } from '../poker/position'
import { CardView } from './CardView'
import { CoinIcon, PercentIcon } from './icons'
import { avatarInitial, avatarStyle } from './avatar'

interface HeroZoneProps {
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
  isMyTurn: boolean
  /** Chips this seat has put in on the current street. */
  betThisStreet?: number
  /** What this seat did on the current street, e.g. "Call $10". */
  lastAction?: string
  /** What the hero currently holds, e.g. "Pair of nines". Null before the flop. */
  madeHand: string | null
  /** Opens the hand-potential drawer. Absent when the study aid is switched off. */
  onShowPotential?: () => void
  potentialOpen?: boolean
}

/**
 * The hero's own seat. Fixed at the bottom of the screen whatever their
 * actual seat at the table, because the one thing that must never move
 * between betting rounds is where your own cards are.
 *
 * This is also the only place the app says "it's your turn" in words rather
 * than by highlighting something — the ring on a seat is easy to miss on a
 * phone held at arm's length.
 */
export function HeroZone({
  name,
  stack,
  cards,
  position,
  isDealer,
  toCall,
  potOdds,
  folded,
  isAllIn,
  isMyTurn,
  betThisStreet = 0,
  lastAction,
  madeHand,
  onShowPotential,
  potentialOpen,
}: HeroZoneProps) {
  const classes = ['hero', folded && 'hero-folded', isMyTurn && 'hero-turn'].filter(Boolean).join(' ')
  const facingBet = !folded && !isAllIn && toCall > 0

  return (
    <div className={classes}>
      <div className="hero-cards">
        {cards.length > 0 ? (
          cards.map((card, i) => <CardView key={`${card.rank}${card.suit}`} card={card} size="lg" index={i} />)
        ) : (
          <>
            <CardView faceDown size="lg" index={0} />
            <CardView faceDown size="lg" index={1} />
          </>
        )}
      </div>

      <div className="hero-info">
        {/* Who you are, in one row: a chip, the name, your position and your
            stack. The avatar, the chips you've committed and the status line
            are only shown by layouts that seat you at the table like everyone
            else. */}
        <div className="hero-head">
          <span className="seat-avatar hero-avatar" style={avatarStyle(name)} aria-hidden="true">
            {avatarInitial(name)}
          </span>
          <div className="hero-id">
            {isMyTurn && <span className="hero-turn-chip">Your turn</span>}
            <span className="hero-name">{name}</span>
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
          </div>

          <div className="hero-stack-row">
            <span className="label">Stack</span>
            <span className="hero-stack money">${stack.toLocaleString()}</span>
          </div>
        </div>

        {/* What the hole cards plus the board currently make. The single most
            useful line for a player still learning to read a board, and it
            costs one row. */}
        {madeHand && !folded && <div className="hero-made">{madeHand}</div>}

        {/* What you just did and what you have in front of you, on one line
            under the cards. */}
        <div className="hero-notes">
          {lastAction && !folded && <div className="hero-status">{lastAction}</div>}

          {betThisStreet > 0 && !folded && (
            <span className="hero-bet money" aria-label={`you have bet $${betThisStreet.toLocaleString()}`}>
              <CoinIcon className="seat-bet-icon" />
              {betThisStreet.toLocaleString()}
            </span>
          )}

          {folded && <div className="hero-state">Folded this hand</div>}
          {isAllIn && !folded && <div className="hero-state">All-in</div>}
        </div>
      </div>

      <div className="hero-right">
        {/* Always rendered: when there is nothing to call it is only hidden, so
            the row keeps its height and the cards and buttons don't jump
            between checking and facing a bet. */}
        <div className={`hero-tocall ${facingBet ? '' : 'hero-tocall-idle'}`} aria-hidden={!facingBet}>
          <span className="label">To call</span>
          <span className="hero-tocall-amount money">${toCall.toLocaleString()}</span>
          <span className="hero-tocall-odds">{potOdds !== null ? `${Math.round(potOdds * 100)}% of pot` : ' '}</span>
        </div>

        {onShowPotential && (
          <button
            type="button"
            className={`btn btn-sm btn-ghost hero-potential-btn ${potentialOpen ? 'btn-on' : ''}`}
            onClick={onShowPotential}
            aria-expanded={potentialOpen}
          >
            <PercentIcon className="hero-potential-icon" />
            Potential
          </button>
        )}
      </div>
    </div>
  )
}
