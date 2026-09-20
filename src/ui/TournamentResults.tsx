import type { Standing } from '../game/tournament'
import { placesPaid, prizeForPosition } from '../game/tournament'
import { TrophyIcon } from './icons'
import { SUIT_PATH } from './suit-icons'
import { ordinal } from '../utils/format'

export interface TournamentOutcome {
  /** Full standings when the tournament ran to completion, or just the human's own row if they quit early. */
  standings: Standing[]
  names: Record<string, string>
  humanId: string
  fieldSize: number
  prizePool: number
  buyIn: number
  /** True if the human left before the tournament actually finished — see the note this renders. */
  forfeited: boolean
}

interface TournamentResultsProps {
  outcome: TournamentOutcome
  onBackToLobby: () => void
}

/**
 * Where a tournament ends up: not a hand result, a whole session's — the
 * screen that answers "was it worth the buy-in" in one look.
 */
export function TournamentResults({ outcome, onBackToLobby }: TournamentResultsProps) {
  const { standings, names, humanId, fieldSize, prizePool, buyIn, forfeited } = outcome
  const human = standings.find((s) => s.playerId === humanId)
  const humanPosition = human?.position ?? fieldSize
  const prize = prizeForPosition(prizePool, fieldSize, humanPosition)
  const net = prize - buyIn
  const paid = placesPaid(fieldSize)
  const won = humanPosition === 1 && !forfeited

  return (
    <div className="menu-scene">
      <svg className="menu-watermark menu-watermark-a" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={SUIT_PATH.hearts} />
      </svg>
      <svg className="menu-watermark menu-watermark-b" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={SUIT_PATH.spades} />
      </svg>

      <div className="menu-content">
        <div className="menu-wordmark-row">
          <div className={`menu-wordmark ${won ? 'results-won' : ''}`}>
            <TrophyIcon className={`menu-wordmark-glyph ${won ? 'results-won-glyph' : ''}`} />
            <span className="menu-wordmark-text">{won ? 'You won!' : `${ordinal(humanPosition)} place`}</span>
          </div>
          <div className="menu-subtitle">
            {forfeited
              ? `You left the tournament with ${Math.max(humanPosition - 1, 0)} player${humanPosition === 2 ? '' : 's'} still in.`
              : `Out of ${fieldSize} entries.`}
          </div>
        </div>

        <div className="menu-card">
          <section className="results-headline">
            <div className={`results-prize ${net >= 0 ? 'cashout-up' : 'cashout-down'}`}>
              {net >= 0 ? '+' : '−'}${Math.abs(net).toLocaleString()}
            </div>
            <div className="results-prize-detail">
              {prize > 0 ? `Prize $${prize.toLocaleString()} · ` : ''}Buy-in was ${buyIn.toLocaleString()}
            </div>
          </section>

          <div className="menu-divider" />

          <section className="results-standings">
            <h2 className="menu-section">Standings</h2>
            {forfeited && (
              <p className="menu-hint">
                You quit before the tournament finished, so only your own finish is known — the rest of the field's
                order was never played out.
              </p>
            )}
            <ul className="results-list">
              {standings
                .slice()
                .sort((a, b) => a.position - b.position)
                .map((s) => (
                  <li
                    key={s.playerId}
                    className={`results-row ${s.playerId === humanId ? 'results-row-you' : ''} ${s.position <= paid ? 'results-row-paid' : ''}`}
                  >
                    <span className="results-position">{ordinal(s.position)}</span>
                    <span className="results-name">{names[s.playerId] ?? s.playerId}{s.playerId === humanId ? ' (you)' : ''}</span>
                    <span className="results-payout">
                      {prizeForPosition(prizePool, fieldSize, s.position) > 0
                        ? `$${prizeForPosition(prizePool, fieldSize, s.position).toLocaleString()}`
                        : '—'}
                    </span>
                  </li>
                ))}
            </ul>
          </section>

          <button type="button" className="btn menu-start" onClick={onBackToLobby}>
            Back to the lobby
          </button>
        </div>
      </div>
    </div>
  )
}
