import { useState, type CSSProperties } from 'react'
import { TIERS } from '../game/career'
import { canClaimDailyStake, DAILY_STAKE_AMOUNT, DAILY_STAKE_THRESHOLD } from '../game/profile'
import { ordinal } from '../utils/format'
import type { LobbyProps } from './Lobby'

/**
 * The lobby as a poker room: three tables, the home game first and widest
 * because it is what gets played most. Each box says what it is in a line and
 * has its own verb; the lifetime numbers are one line under them.
 */

/** The eight-seat home table from above: you at the bottom, the others round the rail. */
function HomeTable() {
  const seats = 8
  return (
    <svg viewBox="0 0 80 48" className="room-table" aria-hidden="true">
      <ellipse cx="40" cy="24" rx="29" ry="15" className="room-table-felt" />
      {Array.from({ length: seats }, (_, i) => {
        const a = Math.PI / 2 + (i * 2 * Math.PI) / seats
        return (
          <circle
            key={i}
            cx={40 + Math.cos(a) * 35}
            cy={24 + Math.sin(a) * 21}
            r={i === 0 ? 4 : 3.2}
            className={i === 0 ? 'room-seat-you' : 'room-seat'}
          />
        )
      })}
    </svg>
  )
}

/** A short stack of chips: taller the more money there is. */
function ChipPile({ amount }: { amount: number }) {
  const height = Math.min(6, Math.max(1, String(Math.max(amount, 0)).length))
  return (
    <span className="room-chips" aria-hidden="true">
      {Array.from({ length: height }, (_, i) => (
        <i key={i} style={{ '--k': i } as CSSProperties} />
      ))}
    </span>
  )
}

export function RoomLobby({
  profile,
  career,
  savedRoom,
  onChooseQuick,
  onClaimDailyStake,
  onResetProfile,
  onChooseCareer,
  onHostGame,
  onResumeRoom,
  onJoinGame,
  onOpenSettings,
  onOpenYourPlay,
}: LobbyProps) {
  const [confirmingReset, setConfirmingReset] = useState(false)
  const canClaim = canClaimDailyStake(profile)
  const tier = TIERS[career.tier]
  const { lifetime } = profile

  return (
    <div className="room">
      <header className="room-head">
        <h1 className="room-title">Poker</h1>
        <nav className="room-links" aria-label="More">
          <button type="button" className="room-text-link" onClick={onOpenYourPlay}>
            Your play
          </button>
          <button type="button" className="room-text-link" onClick={onOpenSettings}>
            Settings
          </button>
        </nav>
      </header>

      <main className="room-boxes">
        <section className="room-box room-box-main" aria-labelledby="room-home">
          <HomeTable />
          <h2 id="room-home" className="room-name">
            Home game
          </h2>
          <p className="room-line">
            {savedRoom
              ? `Room ${savedRoom} is where you left it. Players reconnect by themselves.`
              : 'Real cards at a real table with friends. The phones keep the chips.'}
          </p>
          <div className="room-acts">
            {savedRoom && (
              <button type="button" className="room-go" onClick={onResumeRoom}>
                Reopen {savedRoom}
              </button>
            )}
            <button type="button" className="room-go" onClick={onHostGame}>
              Host
            </button>
            <button type="button" className="room-go" onClick={onJoinGame}>
              Join
            </button>
          </div>
        </section>

        <section className="room-box" aria-labelledby="room-career">
          <h2 id="room-career" className="room-name">
            Career
          </h2>
          <p className="room-money">
            ${profile.bankroll.toLocaleString()}
            <ChipPile amount={profile.bankroll} />
          </p>
          <p className="room-line">
            {career.lastSeason
              ? `${tier.name} season ${career.season} is over. See how it finished.`
              : `${tier.name} season ${career.season}, event ${career.eventIndex + 1} of ${tier.events.length}.`}
          </p>
          {canClaim && (
            <button type="button" className="room-text-link room-claim" onClick={onClaimDailyStake}>
              Claim today’s ${DAILY_STAKE_AMOUNT}
            </button>
          )}
          {!canClaim && profile.bankroll <= DAILY_STAKE_THRESHOLD && <p className="room-fine">Come back tomorrow for another stake.</p>}
          <div className="room-acts">
            <span className="room-fine">Plus cash games and tournaments</span>
            <button type="button" className="room-go" onClick={onChooseCareer}>
              Open
            </button>
          </div>
        </section>

        <section className="room-box" aria-labelledby="room-quick">
          <h2 id="room-quick" className="room-name">
            Quick Play
          </h2>
          <p className="room-line">A practice table. No buy-in, and nothing counts toward your bankroll.</p>
          <div className="room-acts">
            <span className="room-fine">Against bots</span>
            <button type="button" className="room-go" onClick={onChooseQuick}>
              Play
            </button>
          </div>
        </section>
      </main>

      <footer className="room-foot">
        {lifetime.handsPlayed > 0 ? (
          <>
            <span>
              <b>{lifetime.handsPlayed.toLocaleString()}</b> hands
            </span>
            <span>
              <b>{lifetime.gamesPlayed.toLocaleString()}</b> games
            </span>
            <span>
              <b>${lifetime.biggestPot.toLocaleString()}</b> biggest pot
            </span>
            {lifetime.bestFinish !== null && (
              <span>
                <b>{ordinal(lifetime.bestFinish)}</b> best finish
              </span>
            )}
          </>
        ) : (
          <span>Nothing played yet.</span>
        )}
        {confirmingReset ? (
          <span className="room-reset">
            Wipe your bankroll and history?{' '}
            <button type="button" className="room-text-link" onClick={onResetProfile}>
              Yes, reset
            </button>{' '}
            <button type="button" className="room-text-link" onClick={() => setConfirmingReset(false)}>
              Keep it
            </button>
          </span>
        ) : (
          <button type="button" className="room-text-link room-text-link-quiet room-reset" onClick={() => setConfirmingReset(true)}>
            Reset profile
          </button>
        )}
      </footer>
    </div>
  )
}
