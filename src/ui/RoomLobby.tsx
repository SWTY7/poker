import { useState, type CSSProperties } from 'react'
import { TIERS } from '../game/career'
import { canClaimDailyStake, DAILY_STAKE_AMOUNT, DAILY_STAKE_THRESHOLD } from '../game/profile'
import { ordinal } from '../utils/format'
import type { LobbyProps } from './Lobby'

/**
 * The lobby as a poker room: the tables you can sit at on the left, each with
 * a plan of its seats, and on the right what you can do at the one you've
 * picked, as plain rows. One table at a time, so the whole menu fits on a
 * screen. No cards: rules and spacing do the grouping.
 */

const TABLES = [
  { mode: 'quick', name: 'Quick Play', seats: 6, button: 2 },
  { mode: 'career', name: 'Career', seats: 6, button: 4 },
  { mode: 'home', name: 'Home game', seats: 8, button: 6 },
] as const

/** A table seen from above: `seats` places round the rail, you at the bottom, and the button on one of them. */
function TableThumb({ seats, button }: { seats: number; button: number }) {
  const spot = (i: number, rx: number, ry: number) => {
    const a = Math.PI / 2 + (i * 2 * Math.PI) / seats
    return { x: 40 + Math.cos(a) * rx, y: 24 + Math.sin(a) * ry }
  }
  const puck = spot(button, 22, 11)
  return (
    <svg viewBox="0 0 80 48" className="room-table" aria-hidden="true">
      <ellipse cx="40" cy="24" rx="29" ry="15" className="room-table-felt" />
      {Array.from({ length: seats }, (_, i) => {
        const { x, y } = spot(i, 35, 21)
        return <circle key={i} cx={x} cy={y} r={i === 0 ? 4 : 3.2} className={i === 0 ? 'room-seat-you' : 'room-seat'} />
      })}
      <circle cx={puck.x} cy={puck.y} r="2" className="room-puck" />
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

/** One thing to do: its name and a line on it, with the verb on the right. The whole row is the button. */
function Go({ title, copy, verb, onClick }: { title: string; copy: string; verb: string; onClick: () => void }) {
  return (
    <button type="button" className="room-go" onClick={onClick}>
      <span className="room-go-text">
        <span className="room-go-title">{title}</span>
        <span className="room-go-copy">{copy}</span>
      </span>
      <span className="room-go-verb">{verb}</span>
    </button>
  )
}

export function RoomLobby({
  mode,
  onModeChange,
  profile,
  career,
  savedRoom,
  achievementCount,
  achievementTotal,
  onChooseQuick,
  onClaimDailyStake,
  onResetProfile,
  onChooseCash,
  onChooseTournament,
  onChooseCareer,
  onHostGame,
  onResumeRoom,
  onJoinGame,
  onOpenAchievements,
  onOpenSettings,
  onOpenYourPlay,
}: LobbyProps) {
  const [confirmingReset, setConfirmingReset] = useState(false)
  const canClaim = canClaimDailyStake(profile)
  const tier = TIERS[career.tier]
  const { lifetime } = profile
  const recent = [...profile.history].slice(-3).reverse()

  return (
    <div className="room">
      <div className="room-layout">
        <nav className="room-side" aria-label="Tables">
          <h1 className="room-title">Poker</h1>
          <div className="room-tables" role="radiogroup" aria-label="Game mode">
            {TABLES.map((t) => (
              <button
                key={t.mode}
                type="button"
                role="radio"
                aria-checked={mode === t.mode}
                className={`room-pick ${mode === t.mode ? 'room-pick-on' : ''}`}
                onClick={() => onModeChange(t.mode)}
              >
                <TableThumb seats={t.seats} button={t.button} />
                <span className="room-pick-name">{t.name}</span>
              </button>
            ))}
          </div>
        </nav>

        <main className="room-detail">
          {mode === 'quick' && (
            <>
              <h2 className="room-name">Quick Play</h2>
              <p className="room-line">A practice table. No buy-in, and nothing counts toward your bankroll.</p>
              <div className="room-goes">
                <Go title="Sit down" copy="Pick the players, the stacks and the blinds." verb="Play" onClick={onChooseQuick} />
              </div>
            </>
          )}

          {mode === 'career' && (
            <>
              <h2 className="room-name">Career</h2>
              <p className="room-line">
                You have <span className="room-money">${profile.bankroll.toLocaleString()}</span>
                <ChipPile amount={profile.bankroll} />
                {lifetime.handsPlayed > 0
                  ? ` and have played ${lifetime.handsPlayed.toLocaleString()} hands in ${lifetime.gamesPlayed.toLocaleString()} games. Biggest pot $${lifetime.biggestPot.toLocaleString()}${lifetime.bestFinish === null ? '' : `, best finish ${ordinal(lifetime.bestFinish)}`}.`
                  : '. Nothing played yet.'}{' '}
                {canClaim ? (
                  <button type="button" className="room-text-link" onClick={onClaimDailyStake}>
                    Claim today’s ${DAILY_STAKE_AMOUNT}
                  </button>
                ) : (
                  profile.bankroll <= DAILY_STAKE_THRESHOLD && 'Come back tomorrow for another stake.'
                )}
              </p>

              <div className="room-goes">
                <Go
                  title={`${tier.name} season ${career.season}${career.titles > 0 ? `, ${career.titles} title${career.titles === 1 ? '' : 's'}` : ''}`}
                  copy={
                    career.lastSeason
                      ? 'The season is over. See how it finished.'
                      : `Event ${career.eventIndex + 1} of ${tier.events.length}. The same rivals each time; finish in the top two to move up.`
                  }
                  verb={career.lastSeason ? 'See it' : 'Open'}
                  onClick={onChooseCareer}
                />
                <Go title="Cash game" copy="You set the stakes. Leave and cash out whenever you like." verb="Sit down" onClick={onChooseCash} />
                <Go title="Tournament" copy="One buy-in, rising blinds, and prizes for the places that pay." verb="Register" onClick={onChooseTournament} />
              </div>

              {recent.length > 0 && (
                <ul className="room-recent" aria-label="Recent games">
                  {recent.map((entry) => (
                    <li key={entry.at}>
                      <span>{entry.mode === 'tournament' ? `Tournament, ${ordinal(entry.finish ?? 0)} of ${entry.field}` : 'Cash game'}</span>
                      <span className={entry.result >= 0 ? 'cashout-up' : 'cashout-down'}>
                        {entry.result >= 0 ? '+' : '−'}${Math.abs(entry.result).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {mode === 'home' && (
            <>
              <h2 className="room-name">Home game</h2>
              <p className="room-line">Real cards at a real table with friends. The phones keep the chips.</p>
              <div className="room-goes">
                {savedRoom && (
                  <Go title={`Room ${savedRoom}`} copy="The game you were hosting, stacks and all. Players reconnect by themselves." verb="Reopen" onClick={onResumeRoom} />
                )}
                <Go title="Host a table" copy="Open a room and run the dealing and the showdowns." verb="Host" onClick={onHostGame} />
                <Go title="Join a table" copy="Enter the host’s room number and play from your phone." verb="Join" onClick={onJoinGame} />
              </div>
            </>
          )}
        </main>
        <div className="room-foot">
          <button type="button" className="room-text-link" onClick={onOpenYourPlay}>
            Your play
          </button>
          <button type="button" className="room-text-link" onClick={onOpenAchievements}>
            Achievements, {achievementCount} of {achievementTotal}
          </button>
          <button type="button" className="room-text-link" onClick={onOpenSettings}>
            Settings
          </button>
          {confirmingReset ? (
            <span>
              Wipe your bankroll and history?{' '}
              <button type="button" className="room-text-link" onClick={onResetProfile}>
                Yes, reset
              </button>{' '}
              <button type="button" className="room-text-link" onClick={() => setConfirmingReset(false)}>
                Keep it
              </button>
            </span>
          ) : (
            <button type="button" className="room-text-link room-text-link-quiet" onClick={() => setConfirmingReset(true)}>
              Reset profile
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
