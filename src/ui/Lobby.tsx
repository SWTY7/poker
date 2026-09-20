import { useState } from 'react'
import type { Profile } from '../game/profile'
import { canClaimDailyStake, DAILY_STAKE_AMOUNT, DAILY_STAKE_THRESHOLD } from '../game/profile'
import { DealIcon, TrophyIcon } from './icons'
import { ChipIcon } from './ChipIcon'
import { SUIT_PATH } from './suit-icons'
import { ordinal } from '../utils/format'

interface LobbyProps {
  profile: Profile
  onClaimDailyStake: () => void
  onResetProfile: () => void
  onChooseCash: () => void
  onChooseTournament: () => void
}

/**
 * The front door, one level up from the table itself. Everything here is
 * about the player's *career* rather than any one session: what they're
 * carrying into the next table, and what they've done across every table
 * before it.
 *
 * Two doors lead out of it. A cash game and a tournament are different
 * enough games — leave whenever versus play until you bust or win, one
 * prize versus none — that folding them into one setup form would mean
 * every field either doesn't apply half the time or means something subtly
 * different depending on a toggle at the top. Separate screens instead.
 */
export function Lobby({ profile, onClaimDailyStake, onResetProfile, onChooseCash, onChooseTournament }: LobbyProps) {
  const [confirmingReset, setConfirmingReset] = useState(false)
  const canClaim = canClaimDailyStake(profile)

  return (
    <div className="menu-scene">
      <svg className="menu-watermark menu-watermark-a" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={SUIT_PATH.clubs} />
      </svg>
      <svg className="menu-watermark menu-watermark-b" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={SUIT_PATH.diamonds} />
      </svg>

      <div className="menu-content">
        <div className="menu-wordmark-row">
          <div className="menu-wordmark">
            <svg className="menu-wordmark-glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d={SUIT_PATH.spades} />
            </svg>
            <span className="menu-wordmark-text">The Lobby</span>
            <svg className="menu-wordmark-glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d={SUIT_PATH.hearts} />
            </svg>
          </div>
          <div className="menu-subtitle">Your bankroll, your record, and a table to sit down at.</div>
        </div>

        <div className="menu-card lobby-card">
          <section className="lobby-bankroll">
            <span className="lobby-bankroll-label">Bankroll</span>
            <span className="lobby-bankroll-value">
              <ChipIcon amount={profile.bankroll} className="lobby-bankroll-icon" />
              {profile.bankroll.toLocaleString()}
            </span>

            {canClaim && (
              <button type="button" className="btn btn-secondary lobby-stake-btn" onClick={onClaimDailyStake}>
                Claim daily stake — +${DAILY_STAKE_AMOUNT}
              </button>
            )}
            {!canClaim && profile.bankroll <= DAILY_STAKE_THRESHOLD && (
              <span className="lobby-stake-hint">Come back tomorrow for another stake.</span>
            )}
          </section>

          <div className="menu-divider" />

          <section className="lobby-stats">
            <div className="lobby-stat">
              <span className="lobby-stat-value">{profile.lifetime.handsPlayed.toLocaleString()}</span>
              <span className="lobby-stat-label">Hands played</span>
            </div>
            <div className="lobby-stat">
              <span className="lobby-stat-value">{profile.lifetime.gamesPlayed.toLocaleString()}</span>
              <span className="lobby-stat-label">Games played</span>
            </div>
            <div className="lobby-stat">
              <span className="lobby-stat-value">${profile.lifetime.biggestPot.toLocaleString()}</span>
              <span className="lobby-stat-label">Biggest pot</span>
            </div>
            <div className="lobby-stat">
              <span className="lobby-stat-value">
                {profile.lifetime.bestFinish === null ? '—' : ordinal(profile.lifetime.bestFinish)}
              </span>
              <span className="lobby-stat-label">Best finish</span>
            </div>
          </section>

          <div className="menu-divider" />

          <section className="lobby-doors">
            <button type="button" className="lobby-door" onClick={onChooseCash}>
              <span className="lobby-door-icon">
                <DealIcon />
              </span>
              <span className="lobby-door-title">Cash game</span>
              <span className="lobby-door-copy">Pick your own stakes. Leave whenever you like and cash out.</span>
            </button>

            <button type="button" className="lobby-door" onClick={onChooseTournament}>
              <span className="lobby-door-icon">
                <TrophyIcon />
              </span>
              <span className="lobby-door-title">Tournament</span>
              <span className="lobby-door-copy">One buy-in, rising blinds, and a prize for the places that pay.</span>
            </button>
          </section>

          {profile.history.length > 0 && (
            <>
              <div className="menu-divider" />
              <section className="lobby-history">
                <h2 className="menu-section">Recent</h2>
                <ul className="lobby-history-list">
                  {[...profile.history]
                    .slice(-5)
                    .reverse()
                    .map((entry) => (
                      <li key={entry.at} className="lobby-history-row">
                        <span className="lobby-history-mode">
                          {entry.mode === 'tournament' ? `Tournament · ${ordinal(entry.finish ?? 0)} of ${entry.field}` : 'Cash game'}
                        </span>
                        <span className={`lobby-history-result ${entry.result >= 0 ? 'cashout-up' : 'cashout-down'}`}>
                          {entry.result >= 0 ? '+' : '−'}${Math.abs(entry.result).toLocaleString()}
                        </span>
                      </li>
                    ))}
                </ul>
              </section>
            </>
          )}

          <div className="lobby-reset-row">
            {confirmingReset ? (
              <span className="lobby-reset-confirm">
                Wipe your bankroll and history and start over?
                <button type="button" className="lobby-reset-link" onClick={onResetProfile}>
                  Yes, reset
                </button>
                <button type="button" className="lobby-reset-link" onClick={() => setConfirmingReset(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <button type="button" className="lobby-reset-link" onClick={() => setConfirmingReset(true)}>
                Reset profile
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
