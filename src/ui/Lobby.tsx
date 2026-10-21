import { useState } from 'react'
import type { Profile } from '../game/profile'
import type { GameMode } from '../game/mode'
import type { RoomInfo } from '../home/socket'
import { CITIES, tourStatus, type TourData } from '../game/tour'
import { canClaimDailyStake, DAILY_STAKE_AMOUNT, DAILY_STAKE_THRESHOLD } from '../game/profile'
import { DealIcon, TrophyIcon } from './icons'
import { ChipIcon } from './ChipIcon'
import { SUIT_PATH } from './suit-icons'
import { ordinal } from '../utils/format'
import { loadNearbyRoom, nearbySupported } from '../home/p2p'
import { NEARBY_LINE } from './home/nearby-copy'

export interface LobbyProps {
  profile: Profile
  mode: GameMode
  onModeChange: (mode: GameMode) => void
  onChooseQuick: () => void
  onClaimDailyStake: () => void
  onResetProfile: () => void
  onChooseCash: () => void
  tour: TourData
  onChooseTour: () => void
  /** Home Game: a room this phone was hosting, to reopen after a reload. */
  savedRoom: string | null
  /** What the server says about that room; null until it has answered, or if it can't be reached. */
  savedRoomStatus?: RoomInfo | null
  onHostGame: () => void
  onResumeRoom: () => void
  onJoinGame: () => void
  onOpenYourPlay: () => void
  onOpenSettings: () => void
  /** Home Game without internet: the intro for hosting or joining over a hotspot. */
  onNearby?: () => void
  /** Reopen the nearby table saved on this phone. */
  onResumeNearby?: () => void
}

/**
 * The front door, one level up from the table itself. Everything here is
 * about the player's *career* rather than any one session: what they're
 * carrying into the next table, and what they've done across every table
 * before it.
 *
 * Two doors lead out of it: the Cash game (leave whenever you like) and the
 * World Tour (a ladder of six-handed tournaments in casino cities). They are
 * different enough games that each has its own screen.
 *
 * Above all of that sits the one toggle that does belong at the top: Quick
 * Play or Career. Quick Play hides the bankroll and record entirely, since
 * nothing it plays touches them, and leaves a single door to a practice table.
 */
/** One line for the World Tour door: where you are on the ladder. */
function tourLine(tour: TourData, bankroll: number): string {
  const open = tourStatus(tour, bankroll).filter((c) => c.playable).length
  const played = CITIES.filter((c) => (tour.cities[c.id]?.plays ?? 0) > 0).length
  return played === 0
    ? `${CITIES.length} casino cities, six players a table, top three paid. Start in ${CITIES[0].city}.`
    : `${played} of ${CITIES.length} cities played · ${open} open to you now.`
}

export function Lobby({
  profile,
  mode,
  onModeChange,
  onChooseQuick,
  onClaimDailyStake,
  onResetProfile,
  onChooseCash,
  tour,
  onChooseTour,
  savedRoom,
  onHostGame,
  onResumeRoom,
  onJoinGame,
  onOpenSettings,
  onOpenYourPlay,
  onNearby,
  onResumeNearby,
}: LobbyProps) {
  const [confirmingReset, setConfirmingReset] = useState(false)
  const nearbyOn = !!onNearby && nearbySupported()
  const nearbySaved = nearbyOn && !!onResumeNearby && loadNearbyRoom() !== null
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
          <div className="menu-subtitle">
            {mode === 'quick'
              ? 'Pick a table and play. Nothing here touches your bankroll.'
              : mode === 'home'
                ? 'Friends, a real deck, and phones instead of chips.'
                : 'Your bankroll, your record, and a table to sit down at.'}
          </div>
        </div>

        <div className="menu-card lobby-card">
          <div className="lobby-mode-toggle" role="radiogroup" aria-label="Game mode">
            {(
              [
                ['quick', 'Quick Play'],
                ['career', 'Career'],
                ['home', 'Home Game'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                className={`menu-option ${mode === value ? 'menu-option-on' : ''}`}
                onClick={() => onModeChange(value)}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'home' ? (
            <section className="lobby-doors">
              {savedRoom && (
                <button type="button" className="lobby-door lobby-door-wide" onClick={onResumeRoom}>
                  <span className="lobby-door-icon">
                    <DealIcon />
                  </span>
                  <span className="lobby-door-title">Reopen room {savedRoom}</span>
                  <span className="lobby-door-copy">The game you were hosting, stacks and all. Players reconnect by themselves.</span>
                </button>
              )}
              <button type="button" className="lobby-door" onClick={onHostGame}>
                <span className="lobby-door-icon">
                  <TrophyIcon />
                </span>
                <span className="lobby-door-title">Host a game</span>
                <span className="lobby-door-copy">Open a room, deal the real cards, and run the showdowns.</span>
              </button>
              <button type="button" className="lobby-door" onClick={onJoinGame}>
                <span className="lobby-door-icon">
                  <DealIcon />
                </span>
                <span className="lobby-door-title">Join a game</span>
                <span className="lobby-door-copy">Enter the host’s room number and play from your phone.</span>
              </button>
              {nearbySaved && (
                <button type="button" className="lobby-door" onClick={onResumeNearby}>
                  <span className="lobby-door-icon">
                    <DealIcon />
                  </span>
                  <span className="lobby-door-title">Reopen nearby table</span>
                  <span className="lobby-door-copy">The offline game you were hosting. Players get new codes and rejoin.</span>
                </button>
              )}
              {nearbyOn && (
                <button type="button" className="lobby-door" onClick={onNearby}>
                  <span className="lobby-door-icon">
                    <TrophyIcon />
                  </span>
                  <span className="lobby-door-title">Nearby (no internet)</span>
                  <span className="lobby-door-copy">{NEARBY_LINE}</span>
                </button>
              )}
            </section>
          ) : mode === 'quick' ? (
            <section className="lobby-doors lobby-doors-single">
              <button type="button" className="lobby-door" onClick={onChooseQuick}>
                <span className="lobby-door-icon">
                  <DealIcon />
                </span>
                <span className="lobby-door-title">Quick Play</span>
                <span className="lobby-door-copy">
                  Choose players, stacks and blinds, and deal. No buy-in, and nothing touches your bankroll.
                </span>
              </button>
            </section>
          ) : (
            <>
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
                <button type="button" className="lobby-door lobby-door-wide" onClick={onChooseTour}>
                  <span className="lobby-door-icon">
                    <TrophyIcon />
                  </span>
                  <span className="lobby-door-title">World Tour</span>
                  <span className="lobby-door-copy">{tourLine(tour, profile.bankroll)}</span>
                </button>

                <button type="button" className="lobby-door" onClick={onChooseCash}>
                  <span className="lobby-door-icon">
                    <DealIcon />
                  </span>
                  <span className="lobby-door-title">Cash game</span>
                  <span className="lobby-door-copy">Pick your own stakes. Leave whenever you like and cash out.</span>
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
                              {entry.mode === 'tournament' ? `World Tour · ${ordinal(entry.finish ?? 0)} of ${entry.field}` : 'Cash game'}
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
            </>
          )}

          <div className="lobby-your-play-row">
            <button type="button" className="btn btn-secondary" onClick={onOpenSettings}>
              Settings
            </button>
          </div>

          {mode !== 'home' && (
            <div className="lobby-your-play-row">
              <button type="button" className="btn btn-secondary" onClick={onOpenYourPlay}>
                Your play — style, leaks, hand history
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
