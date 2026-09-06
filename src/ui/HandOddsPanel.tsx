import type { HandCategory } from '../poker/hand-evaluator'
import type { HandOdds } from '../poker/equity'

const CATEGORY_LABEL: Record<HandCategory, string> = {
  'high-card': 'High card',
  pair: 'Pair',
  'two-pair': 'Two pair',
  trips: 'Three of a kind',
  straight: 'Straight',
  flush: 'Flush',
  'full-house': 'Full house',
  quads: 'Four of a kind',
  'straight-flush': 'Straight flush',
}

/** Worst to best — the order a real hand-rankings chart reads in. */
const CATEGORY_ORDER: HandCategory[] = [
  'high-card',
  'pair',
  'two-pair',
  'trips',
  'straight',
  'flush',
  'full-house',
  'quads',
  'straight-flush',
]

interface HandOddsPanelProps {
  odds: HandOdds
}

/**
 * The exact probability of ending up with each hand category, computed
 * purely from the hero's own cards and the board — no opponent modeling at
 * all. A study aid for checking the psychology layer's decisions against
 * what the hand actually was, not something a real player would have.
 */
export function HandOddsPanel({ odds }: HandOddsPanelProps) {
  const categories = CATEGORY_ORDER.filter((c) => (odds.byCategory[c] ?? 0) > 0)

  return (
    <div className="hand-odds">
      <div className="hand-odds-title">Your hand odds</div>
      <div className="hand-odds-rows">
        {categories.map((category) => {
          const p = odds.byCategory[category] ?? 0
          return (
            <div key={category} className="hand-odds-row">
              <span className="hand-odds-label">{CATEGORY_LABEL[category]}</span>
              <div className="hand-odds-bar-track">
                <span className="hand-odds-bar-fill" style={{ width: `${Math.max(p * 100, 1.5)}%` }} />
              </div>
              <span className="hand-odds-value">{(p * 100).toFixed(p < 0.01 ? 1 : 0)}%</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
