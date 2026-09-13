import { useState } from 'react'
import type { HandCategory } from '../poker/hand-evaluator'
import type { HandOdds } from '../poker/equity'
import { readEnum, writeString } from '../utils/storage'

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

/** Room-saving names for the one-line collapsed summary only. */
const CATEGORY_SHORT: Record<HandCategory, string> = {
  'high-card': 'High',
  pair: 'Pair',
  'two-pair': '2 pair',
  trips: 'Trips',
  straight: 'Str8',
  flush: 'Flush',
  'full-house': 'Boat',
  quads: 'Quads',
  'straight-flush': 'St. flush',
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
 *
 * Collapsible, and collapsed by default: expanded it is nine rows tall, which
 * on a phone is most of the space the board itself needs. Collapsed it keeps
 * the three likeliest outcomes on one line, which is the part a player
 * actually reads mid-hand.
 */
export function HandOddsPanel({ odds }: HandOddsPanelProps) {
  const [open, setOpen] = useState(() => readEnum('poker.handOddsOpen', ['on', 'off'] as const, 'off') === 'on')

  const toggle = () => {
    setOpen((wasOpen) => {
      writeString('poker.handOddsOpen', wasOpen ? 'off' : 'on')
      return !wasOpen
    })
  }

  const categories = CATEGORY_ORDER.filter((c) => (odds.byCategory[c] ?? 0) > 0)
  const likeliest = [...categories]
    .sort((a, b) => (odds.byCategory[b] ?? 0) - (odds.byCategory[a] ?? 0))
    .slice(0, 3)

  return (
    <div className={`hand-odds ${open ? 'hand-odds-open' : ''}`}>
      <button type="button" className="hand-odds-header" onClick={toggle} aria-expanded={open}>
        <span className="hand-odds-title">
          <span className="hand-odds-title-long">Your hand odds</span>
          <span className="hand-odds-title-short">Odds</span>
        </span>
        {!open && (
          <span className="hand-odds-summary">
            {likeliest.map((category) => (
              <span key={category} className="hand-odds-chip">
                {CATEGORY_SHORT[category]} {Math.round((odds.byCategory[category] ?? 0) * 100)}%
              </span>
            ))}
          </span>
        )}
        <span className="hand-odds-caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
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
      )}
    </div>
  )
}
