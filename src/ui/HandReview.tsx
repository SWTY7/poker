import { useEffect, useMemo } from 'react'
import type { HandRecord } from '../review/log'
import { parseCardCode, reviewHand, type Verdict } from '../review/hand-review'
import { PRO } from '../ai/psychology/profile'
import { CardView } from './CardView'

interface HandReviewProps {
  hand: HandRecord
  onClose: () => void
}

const VERDICT_LABEL: Record<Verdict, string> = {
  book: 'Book play',
  mixed: 'In the mix',
  off: 'Off the book',
  none: 'No solve here',
}

const STREET_LABEL: Record<string, string> = {
  preflop: 'Preflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
}

/**
 * The hand just played, decision by decision (review/hand-review.ts). A
 * sheet from the bottom like the other study aids, so the result stays in
 * view above it.
 *
 * Each decision shows four things side by side: what you did, the solve's
 * mix where one covers the spot, your equity at the time against random
 * hands for whoever was still in, and what the table's professional would
 * have done. Equity against random hands flatters a hand facing a big bet,
 * which is why the note says so rather than calling it your chance to win.
 */
export function HandReview({ hand, onClose }: HandReviewProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const review = useMemo(() => reviewHand(hand), [hand])
  const bb = hand.bigBlind
  const net = hand.net

  return (
    <div className="overlay overlay-sheet" onClick={onClose}>
      <div
        className="sheet sheet-review"
        role="dialog"
        aria-modal="true"
        aria-label="Hand review"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <h2 className="dialog-title">Hand review</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            Done
          </button>
        </div>

        <div className="review-hand">
          <div className="review-cards" aria-label="Your cards">
            {hand.cards.map((code) => (
              <CardView key={code} card={parseCardCode(code)} size="sm" animate={false} />
            ))}
          </div>
          <div className="review-hand-meta">
            <span>
              {hand.position ?? 'Seat'} · {hand.players} players
            </span>
            <span className={net >= 0 ? 'cashout-up' : 'cashout-down'}>
              {net >= 0 ? '+' : '−'}${Math.abs(net).toLocaleString()}
              {bb > 0 && ` (${net >= 0 ? '+' : '−'}${Math.abs(net / bb).toFixed(1)} bb)`}
            </span>
          </div>
        </div>

        {review.decisions.length === 0 ? (
          <p className="potential-note">You had no decision to make this hand.</p>
        ) : (
          <ol className="review-list">
            {review.decisions.map((d, i) => (
              <li key={i} className="review-step">
                <div className="review-step-head">
                  <span className="review-street">{STREET_LABEL[d.street] ?? d.street}</span>
                  {d.board.length > 0 && (
                    <span className="review-board" aria-label="Board">
                      {d.board.map((code) => (
                        <CardView key={code} card={parseCardCode(code)} size="sm" animate={false} />
                      ))}
                    </span>
                  )}
                  <span className={`review-verdict review-verdict-${d.verdict}`}>{VERDICT_LABEL[d.verdict]}</span>
                </div>
                <p className="review-spot">
                  {d.spot}. Pot ${d.pot.toLocaleString()}
                  {d.toCall > 0 && `, $${d.toCall.toLocaleString()} to call`}.
                </p>
                <dl className="review-facts">
                  <dt>You</dt>
                  <dd>{d.youSaid}</dd>
                  <dt>Book</dt>
                  <dd>{d.bookSaid ?? 'no solve covers this spot'}</dd>
                  <dt>Equity</dt>
                  <dd>
                    {d.equity === null ? '—' : `${Math.round(d.equity * 100)}%`}
                    <span className="review-dim">
                      {' '}
                      vs {d.opponents} random hand{d.opponents === 1 ? '' : 's'}
                    </span>
                  </dd>
                  {d.proSaid && (
                    <>
                      <dt>{PRO.name}</dt>
                      <dd>
                        {d.proSaid}
                        <span className="review-dim">{d.proAgrees ? ' · same as you' : ''}</span>
                      </dd>
                    </>
                  )}
                </dl>
              </li>
            ))}
          </ol>
        )}

        <p className="potential-foot">
          Book: the solved strategy’s mix (heads-up at a trained depth, or preflop multiway). {PRO.name} is the
          table’s professional, asked the same question with what a bot in your seat could see. Equity is against
          random hands, so it flatters a hand facing a big bet.
        </p>
      </div>
    </div>
  )
}
