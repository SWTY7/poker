import { useEffect, useRef } from 'react'
import { cardToString } from '../poker/card'
import type { HandLogEntry, Street } from '../poker/game-state'

interface HandFeedProps {
  log: HandLogEntry[]
  /** Whose row gets bolded — the currently revealed human, if any. */
  activeId: string | null | undefined
}

const STREET_TITLE: Record<Street, string> = {
  preflop: 'Preflop',
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
  showdown: 'Showdown',
}

function describe(entry: HandLogEntry): string {
  switch (entry.kind) {
    case 'blind':
      return `posts the ${entry.message} — $${entry.amount?.toLocaleString()}`
    case 'ante':
      return `antes $${entry.amount?.toLocaleString()}`
    case 'action':
      switch (entry.actionType) {
        case 'fold':
          return 'folds'
        case 'check':
          return 'checks'
        case 'call':
          return `calls $${entry.amount?.toLocaleString()}`
        case 'bet':
          return `bets $${entry.toAmount?.toLocaleString()}`
        case 'raise':
          return `raises to $${entry.toAmount?.toLocaleString()}`
        case 'all-in':
          return `is all-in for $${entry.toAmount?.toLocaleString()}`
      }
      return ''
    default:
      return entry.message ?? ''
  }
}

/**
 * The running story of the hand. Without it, the only record of what the
 * table just did is whatever the player happened to be looking at when it
 * happened — the single biggest reason a hand feels like it happened *to* you.
 */
export function HandFeed({ log, activeId }: HandFeedProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log.length])

  // A street header reports the pot as that street LEFT it, not as it found
  // it, so the column of figures reads as the pot growing street by street.
  const potByStreet = new Map<Street, number>()
  for (const entry of log) potByStreet.set(entry.street, entry.potAfter)

  return (
    <div className="hand-feed">
      <div className="hand-feed-title">This hand</div>
      <div className="hand-feed-scroll" ref={scrollRef}>
        {log.map((entry, i) => {
          const showHeader = entry.street !== log[i - 1]?.street
          const isHero = activeId != null && entry.playerId === activeId

          return (
            <div key={entry.seq}>
              {showHeader && (
                <div className="feed-street">
                  <span className="feed-street-name">{STREET_TITLE[entry.street]}</span>
                  <span className="feed-street-rule" />
                  <span className="feed-street-pot">
                    ${(potByStreet.get(entry.street) ?? entry.potAfter).toLocaleString()}
                  </span>
                </div>
              )}

              {entry.kind === 'deal' ? (
                <div className="feed-deal">{entry.cards?.map(cardToString).join('  ')}</div>
              ) : entry.kind === 'result' ? (
                <div className="feed-result">{entry.message}</div>
              ) : (
                <div className={`feed-row ${isHero ? 'feed-row-hero' : ''}`}>
                  <span className="feed-name">{entry.playerName}</span>
                  <span className="feed-what">{describe(entry)}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
