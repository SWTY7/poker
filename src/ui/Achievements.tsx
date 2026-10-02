import { useEffect } from 'react'
import { ACHIEVEMENTS, type Achievement, type AchievementsData } from '../game/achievements'
import { SUIT_PATH } from './suit-icons'

/** Every achievement, earned ones with the day they were earned. */
export function AchievementsScreen({ data, onBack }: { data: AchievementsData; onBack: () => void }) {
  const count = Object.keys(data.earned).length
  return (
    <div className="menu-scene">
      <svg className="menu-watermark menu-watermark-a" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={SUIT_PATH.diamonds} />
      </svg>
      <div className="menu-content">
        <div className="menu-wordmark-row">
          <div className="menu-wordmark">
            <span className="menu-wordmark-text">Achievements</span>
          </div>
          <div className="menu-subtitle">
            {count} of {ACHIEVEMENTS.length}, earned at Career tables.
          </div>
          <div className="menu-bankroll-row">
            <button type="button" className="menu-back-link" onClick={onBack}>
              ← Back to the lobby
            </button>
          </div>
        </div>
        <ul className="menu-card lobby-card achievements">
          {ACHIEVEMENTS.map((a) => {
            const when = data.earned[a.id]
            return (
              <li key={a.id} className={`achievement ${when ? 'achievement-earned' : ''}`}>
                <span className="achievement-mark" aria-hidden="true">
                  {when ? '★' : '☆'}
                </span>
                <span className="achievement-text">
                  <span className="achievement-name">{a.name}</span>
                  <span className="achievement-desc">{a.description}</span>
                </span>
                <span className="achievement-when">{when ? new Date(when).toLocaleDateString() : 'Not yet'}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

/** The newest unlock, for a few seconds, over whatever screen is showing. */
export function AchievementToast({ toasts, onDone }: { toasts: Achievement[]; onDone: () => void }) {
  const current = toasts[0]
  useEffect(() => {
    if (!current) return
    const timer = window.setTimeout(onDone, 4000)
    return () => window.clearTimeout(timer)
  }, [current, onDone])
  if (!current) return null
  return (
    <button type="button" className="achievement-toast" role="status" onClick={onDone}>
      <span className="achievement-toast-label">Achievement</span>
      <span className="achievement-name">★ {current.name}</span>
      <span className="achievement-desc">{current.description}</span>
    </button>
  )
}
