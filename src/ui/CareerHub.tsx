import type { CareerData, SeasonOutcome } from '../game/career'
import { FIELD_SIZE, POINTS, TIERS, YOU, entrantName, nextEvent, seasonStandings } from '../game/career'
import { STRUCTURES, prizesForField } from '../game/tournament'
import { canAffordBuyIn, type ProfileHistoryEntry } from '../game/profile'
import { ordinal } from '../utils/format'
import { DealIcon, TrophyIcon } from './icons'
import { SUIT_PATH } from './suit-icons'

interface CareerHubProps {
  career: CareerData
  bankroll: number
  history: ProfileHistoryEntry[]
  onPlayEvent: () => void
  onCash: () => void
  onTournament: () => void
  onDismissSeason: () => void
  onBack: () => void
}

const RESULT_LINE: Record<SeasonOutcome['result'], (tier: string, next: string) => string> = {
  promoted: (_, next) => `Top two. You're promoted to ${next}.`,
  repeat: (tier) => `Not top two this time. Another ${tier} season.`,
  title: () => 'You won the Championship. A title, and next season you defend it.',
  dropped: (_, next) => `The Championship got away. Back to ${next} to qualify again.`,
}

/**
 * Career mode's home: where the season stands, who you're up against every
 * event, and the next event to play. Right after a season's last event it
 * shows how that season finished first.
 */
export function CareerHub({ career, bankroll, history, onPlayEvent, onCash, onTournament, onDismissSeason, onBack }: CareerHubProps) {
  return (
    <div className="menu-scene">
      <svg className="menu-watermark menu-watermark-a" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={SUIT_PATH.spades} />
      </svg>
      <svg className="menu-watermark menu-watermark-b" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={SUIT_PATH.diamonds} />
      </svg>
      <div className="menu-content">
        {career.lastSeason ? (
          <SeasonSummary outcome={career.lastSeason} nextTier={TIERS[career.tier].name} onContinue={onDismissSeason} />
        ) : (
          <Season
            career={career}
            bankroll={bankroll}
            history={history}
            onPlayEvent={onPlayEvent}
            onCash={onCash}
            onTournament={onTournament}
            onBack={onBack}
          />
        )}
      </div>
    </div>
  )
}

function Standings({ rows }: { rows: { id: string; points: number }[] }) {
  return (
    <ol className="career-standings">
      {rows.map((row, i) => (
        <li key={row.id} className={`results-row ${row.id === YOU ? 'results-row-you' : ''}`}>
          <span className="results-position">{ordinal(i + 1)}</span>
          <span>{entrantName(row.id)}</span>
          <span className="results-payout">{row.points} pts</span>
        </li>
      ))}
    </ol>
  )
}

function Season({ career, bankroll, history, onPlayEvent, onCash, onTournament, onBack }: Omit<CareerHubProps, 'onDismissSeason'>) {
  const tier = TIERS[career.tier]
  const event = nextEvent(career)
  const affordable = canAffordBuyIn(bankroll, tier.buyIn)
  const [first, second] = prizesForField(tier.buyIn * FIELD_SIZE, FIELD_SIZE)

  return (
    <>
      <div className="menu-wordmark-row">
        <div className="menu-wordmark">
          <span className="menu-wordmark-text">
            {tier.name} <span className="menu-wordmark-accent">season {career.season}</span>
          </span>
        </div>
        <div className="menu-bankroll-row">
          <span className="menu-bankroll">Bankroll ${bankroll.toLocaleString()}</span>
          {career.titles > 0 && (
            <span className="career-titles">
              <TrophyIcon /> {career.titles}
            </span>
          )}
          <button type="button" className="menu-back-link" onClick={onBack}>
            ← Lobby
          </button>
        </div>
      </div>

      <div className="menu-card lobby-card">
        <section>
          <h2 className="menu-section">Events</h2>
          <ol className="career-events">
            {tier.events.map((id, i) => {
              const done = i < career.eventIndex
              const next = i === career.eventIndex
              return (
                <li key={i} className={`career-event ${next ? 'career-event-next' : ''} ${done ? 'career-event-done' : ''}`}>
                  <span>
                    {i + 1}. {STRUCTURES[id].name}
                    {i === tier.events.length - 1 && tier.events.length > 1 ? ' (final)' : ''}
                  </span>
                  <span className="career-event-finish">
                    {done ? ordinal(career.finishes[i] ?? FIELD_SIZE) : next ? 'next' : ''}
                  </span>
                </li>
              )
            })}
          </ol>
        </section>

        <div className="menu-divider" />

        <section>
          <h2 className="menu-section">Standings</h2>
          <Standings rows={seasonStandings(career)} />
          <p className="menu-hint">
            Points by finish: {POINTS.join(' / ')}.{' '}
            {career.tier === TIERS.length - 1 ? 'One final: win it for the title.' : 'Top two after the final move up a tier.'}
          </p>
        </section>

        <div className="menu-divider" />

        <p className="menu-hint">
          Event {event.number} of {event.of}: {event.structure.name}. ${tier.buyIn} buy-in, {FIELD_SIZE} players, pays $
          {first.toLocaleString()} / ${second.toLocaleString()}.
        </p>
        {!affordable && <p className="menu-hint">Not enough in the bankroll for this buy-in. The lobby has a daily top-up.</p>}
        <button type="button" className="btn menu-start" onClick={onPlayEvent} disabled={!affordable}>
          <DealIcon className="menu-start-icon" />
          Play event {event.number}
        </button>

        {/* Round table only: where the cash game and tournament live now. */}
        <section className="career-outside">
          <h2 className="menu-section">Outside the season</h2>
          <button type="button" className="career-outside-row" onClick={onCash}>
            <span>
              <strong>Cash game</strong>
              <span className="menu-hint">You set the stakes. Leave and cash out whenever you like.</span>
            </span>
            <span className="career-outside-verb">Sit down</span>
          </button>
          <button type="button" className="career-outside-row" onClick={onTournament}>
            <span>
              <strong>Tournament</strong>
              <span className="menu-hint">One buy-in, rising blinds, and prizes for the places that pay.</span>
            </span>
            <span className="career-outside-verb">Register</span>
          </button>
          {history.length > 0 && (
            <ul className="career-recent" aria-label="Recent games">
              {[...history]
                .slice(-3)
                .reverse()
                .map((entry) => (
                  <li key={entry.at}>
                    <span>{entry.mode === 'tournament' ? `Tournament, ${ordinal(entry.finish ?? 0)} of ${entry.field}` : 'Cash game'}</span>
                    <span className={entry.result >= 0 ? 'cashout-up' : 'cashout-down'}>
                      {entry.result >= 0 ? '+' : '−'}${Math.abs(entry.result).toLocaleString()}
                    </span>
                  </li>
                ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}

function SeasonSummary({ outcome, nextTier, onContinue }: { outcome: SeasonOutcome; nextTier: string; onContinue: () => void }) {
  const tier = TIERS[outcome.tier].name
  return (
    <>
      <div className={`menu-wordmark-row ${outcome.result === 'title' || outcome.result === 'promoted' ? 'results-won' : ''}`}>
        <div className="menu-wordmark">
          <span className="menu-wordmark-text">
            {tier} season {outcome.season}
          </span>
        </div>
      </div>
      <div className="menu-card lobby-card">
        <section className="results-headline">
          <span className="results-prize">{ordinal(outcome.place)}</span>
          <span className="results-prize-detail">{RESULT_LINE[outcome.result](tier, nextTier)}</span>
        </section>
        <div className="menu-divider" />
        <Standings rows={outcome.standings} />
        <button type="button" className="btn menu-start" onClick={onContinue}>
          Continue
        </button>
      </div>
    </>
  )
}
