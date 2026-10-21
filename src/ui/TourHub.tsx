import { prizesFor, recordOf, tourStatus, type CityStatus, type TourData } from '../game/tour'
import { ordinal } from '../utils/format'
import { DealIcon } from './icons'
import { SUIT_PATH } from './suit-icons'

interface TourHubProps {
  tour: TourData
  bankroll: number
  onPlay: (cityId: string) => void
  onBack: () => void
}

const money = (n: number) => `$${n.toLocaleString('en-US')}`

function recordLine(best: number | null, wins: number): string {
  if (best === null) return 'Not played yet'
  return `Best ${ordinal(best)} · ${wins} ${wins === 1 ? 'win' : 'wins'}`
}

/** One city. A plain function component (no hooks), exported so a test can read its Play button. */
export function CityRow({ status, tour, onPlay }: { status: CityStatus; tour: TourData; onPlay: (cityId: string) => void }) {
  const { city, playable, unlocked, reason } = status
  const [first, second, third] = prizesFor(city)
  const record = recordOf(tour, city.id)
  const state = playable ? 'ready' : unlocked ? 'short' : 'locked'
  return (
    <li className={`tour-row tour-row-${state}`} data-city={city.id}>
      <div className="tour-where">
        <h3 className="tour-city">{city.city}</h3>
        <span className="tour-room">
          {city.room} · {city.country}
        </span>
      </div>
      <div className="tour-money">
        <span className="tour-buyin">
          <span className="tour-label">Buy-in</span> {money(city.buyIn)}
        </span>
        <span className="tour-prizes" aria-label="Prizes for first, second and third">
          <span>
            <span className="tour-label">1st</span> {money(first)}
          </span>
          <span>
            <span className="tour-label">2nd</span> {money(second)}
          </span>
          <span>
            <span className="tour-label">3rd</span> {money(third)}
          </span>
        </span>
      </div>
      <div className="tour-record">{recordLine(record.best, record.wins)}</div>
      {playable ? (
        <div className="tour-act">
          <button type="button" className="btn menu-start tour-play" onClick={() => onPlay(city.id)} aria-label={`Play in ${city.city}`}>
            <DealIcon className="menu-start-icon" />
            Play
          </button>
        </div>
      ) : (
        <p className="tour-reason">{reason}</p>
      )}
    </li>
  )
}

/**
 * The World Tour: a list of casino cities, each one a six-handed tournament
 * with its own buy-in. Locked cities say what opens them.
 */
export function TourHub({ tour, bankroll, onPlay, onBack }: TourHubProps) {
  const statuses = tourStatus(tour, bankroll)
  return (
    <div className="menu-scene">
      <svg className="menu-watermark menu-watermark-a" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={SUIT_PATH.spades} />
      </svg>
      <svg className="menu-watermark menu-watermark-b" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={SUIT_PATH.diamonds} />
      </svg>
      <div className="menu-content">
        <div className="menu-wordmark-row">
          <div className="menu-wordmark">
            <span className="menu-wordmark-text">
              World <span className="menu-wordmark-accent">Tour</span>
            </span>
          </div>
          <div className="menu-bankroll-row">
            <span className="menu-bankroll">{`Bankroll ${money(bankroll)}`}</span>
            <span className="menu-bankroll tour-winnings">{`Won on tour ${money(tour.winnings)}`}</span>
            <button type="button" className="menu-back-link" onClick={onBack}>
              ← Lobby
            </button>
          </div>
          <div className="menu-subtitle">Six players, top three paid. Finish top 3 to open the next city.</div>
        </div>

        <div className="menu-card lobby-card tour-card">
          <ol className="tour-list">
            {statuses.map((status) => (
              <CityRow key={status.city.id} status={status} tour={tour} onPlay={onPlay} />
            ))}
          </ol>
        </div>
      </div>
    </div>
  )
}
