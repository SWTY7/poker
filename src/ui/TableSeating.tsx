import type { RivalsData, SeatPlan } from '../game/rivals'
import { scoutingDetails } from '../game/rivals'
import { avatarInitial, avatarStyle } from './avatar'
import { DealIcon } from './icons'
import { SUIT_PATH } from './suit-icons'

interface TableSeatingProps {
  seats: SeatPlan[]
  rivals: RivalsData
  /** What you're sitting down to, e.g. "$5/$10 cash game". */
  title: string
  onSit: () => void
  onBack: () => void
}

/**
 * The walk from the rail to your seat: who is already at the table, and what
 * you remember of them. A rival you've seen enough of gets your notes; one you
 * haven't gets a line saying so; a walk-in is simply someone nobody knows.
 */
export function TableSeating({ seats, rivals, title, onSit, onBack }: TableSeatingProps) {
  return (
    <div className="menu-scene">
      <svg className="menu-watermark menu-watermark-a" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={SUIT_PATH.hearts} />
      </svg>
      <svg className="menu-watermark menu-watermark-b" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={SUIT_PATH.clubs} />
      </svg>

      <div className="menu-content">
        <div className="menu-wordmark-row">
          <div className="menu-wordmark">
            <span className="menu-wordmark-text">Who&rsquo;s at the table</span>
          </div>
          <div className="menu-bankroll-row">
            <button type="button" className="menu-back-link" onClick={onBack}>
              ← Lobby
            </button>
          </div>
        </div>

        <div className="menu-card lobby-card">
          <h2 className="menu-section">{title}</h2>
          <ul className="seating-list">
            {seats.map((seat) => {
              const record = seat.kind === 'rival' ? rivals.rivals[seat.rival.id] : undefined
              const note = seat.kind === 'rival' ? scoutingDetails(seat.rival, record) : null
              let line: string
              if (seat.kind === 'walk-in') line = 'A walk-in. Nobody here has seen them play.'
              else if (note) line = `${note.charAt(0).toUpperCase()}${note.slice(1)}.`
              else if (record && record.sessions > 0) line = 'You’ve sat with them before, but not long enough to say much.'
              else line = 'First time at a table together.'
              return (
                <li key={seat.name} className="seating-row">
                  <span className="seating-avatar" style={avatarStyle(seat.name)} aria-hidden="true">
                    {avatarInitial(seat.name)}
                  </span>
                  <span className="seating-text">
                    <span className="seating-name">{seat.name}</span>
                    <span className={`seating-note ${note ? 'seating-note-known' : ''}`}>{line}</span>
                  </span>
                </li>
              )
            })}
          </ul>

          <button type="button" className="btn menu-start" onClick={onSit}>
            <DealIcon className="menu-start-icon" />
            Take your seat
          </button>
        </div>
      </div>
    </div>
  )
}
