import { useState } from 'react'
import { THEMES, loadTheme, setTheme, type ThemeId } from '../game/settings'
import { readEnum, writeString } from '../utils/storage'
import { SUIT_PATH } from './suit-icons'

const SPEEDS = ['slow', 'normal', 'fast'] as const

/** How fast the bots act and the cards come, as the table starts. The table's own control still changes it mid-game. */
function loadSpeed() {
  return readEnum('poker.speed', SPEEDS, 'normal')
}

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [theme, setThemeState] = useState<ThemeId>(() => loadTheme())
  const [speed, setSpeedState] = useState(() => loadSpeed())

  return (
    <div className="menu-scene">
      <svg className="menu-watermark menu-watermark-a" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={SUIT_PATH.clubs} />
      </svg>
      <div className="menu-content">
        <div className="menu-wordmark-row">
          <div className="menu-wordmark">
            <span className="menu-wordmark-text">Settings</span>
          </div>
          <div className="menu-subtitle">Kept on this device.</div>
          <div className="menu-bankroll-row">
            <button type="button" className="menu-back-link" onClick={onBack}>
              ← Back to the lobby
            </button>
          </div>
        </div>

        <div className="menu-card lobby-card">
          <section>
            <h2 className="menu-section">Look</h2>
            <div className="theme-grid" role="radiogroup" aria-label="Theme">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={theme === t.id}
                  className={`theme-option ${theme === t.id ? 'theme-option-on' : ''}`}
                  onClick={() => {
                    setTheme(t.id)
                    setThemeState(t.id)
                  }}
                >
                  <span className="theme-swatch" aria-hidden="true">
                    {t.swatch.map((color) => (
                      <span key={color} style={{ background: color }} />
                    ))}
                  </span>
                  <span className="theme-name">{t.name}</span>
                  <span className="theme-desc">{t.description}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="menu-divider" />

          <section>
            <h2 className="menu-section">Table speed</h2>
            <div className="menu-options">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`menu-option ${speed === s ? 'menu-option-on' : ''}`}
                  aria-pressed={speed === s}
                  onClick={() => {
                    writeString('poker.speed', s)
                    setSpeedState(s)
                  }}
                >
                  {s[0].toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>
            <p className="menu-hint">How fast the bots act and the cards come. You can change it at the table too.</p>
          </section>
        </div>
      </div>
    </div>
  )
}
