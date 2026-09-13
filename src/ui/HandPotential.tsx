import { useEffect } from 'react'
import type { HandOdds } from '../poker/equity'
import { CATEGORY_LABEL, CATEGORY_ORDER } from '../poker/hand-name'

interface HandPotentialProps {
  odds: HandOdds
  /** What the hero holds right now, e.g. "Pair of nines". */
  madeHand: string | null
  onClose: () => void
}

/**
 * The study aid, as a drawer rather than a permanent panel.
 *
 * It used to be titled "Your hand odds", which is wrong in a way that matters:
 * "odds" in poker means your chance of winning the pot, and this number has
 * nothing to do with opponents at all. What `estimateHandOdds` actually
 * computes is the probability distribution of the hero's OWN final hand
 * category over every way the remaining board could come — "what could this
 * become", not "how likely am I to win". Calling it hand *potential*, and
 * saying so in a line of body text, is the difference between a teaching aid
 * and a misleading one.
 *
 * It opens from the bottom and is deliberately short, so the board and the
 * pot stay visible above it while it is being read.
 */
export function HandPotential({ odds, madeHand, onClose }: HandPotentialProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const categories = CATEGORY_ORDER.filter((c) => (odds.byCategory[c] ?? 0) > 0)
    .slice()
    .reverse()

  return (
    <div className="overlay overlay-sheet" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Hand potential"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-head">
          <h2 className="dialog-title">Hand potential</h2>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
            Done
          </button>
        </div>

        {madeHand && (
          <p className="potential-made">
            <span className="label">You have</span>
            <span className="potential-made-name">{madeHand}</span>
          </p>
        )}

        <p className="potential-note">
          Chance your hand finishes as each of these, over every way the rest of the board could come. Your opponents’
          cards are not part of this — it is not your chance of winning the pot.
        </p>

        <div className="potential-rows">
          {categories.map((category) => {
            const p = odds.byCategory[category] ?? 0
            return (
              <div key={category} className="potential-row">
                <span className="potential-label">{CATEGORY_LABEL[category]}</span>
                <div className="potential-track">
                  <span className="potential-fill" style={{ width: `${Math.max(p * 100, 1.5)}%` }} />
                </div>
                <span className="potential-value money">{(p * 100).toFixed(p < 0.01 ? 1 : 0)}%</span>
              </div>
            )
          })}
        </div>

        <p className="potential-foot">
          {odds.sampleSize === 1
            ? 'The board is complete — this hand is final.'
            : `Exact, counted over all ${odds.sampleSize.toLocaleString()} ways the board can finish.`}
        </p>
      </div>
    </div>
  )
}
