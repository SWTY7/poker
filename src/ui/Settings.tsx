import { useState } from 'react'
import { MODES, THEMES, loadLook, setLook, type Look, type Theme } from '../game/settings'
import { readEnum, writeString } from '../utils/storage'
import { SUIT_PATH } from './suit-icons'

const SPEEDS = ['slow', 'normal', 'fast'] as const

/** A small, non-interactive preview of each theme: three flat colour bands. */
const THEME_SWATCH: Record<Theme, [string, string, string]> = {
  classic: ['#1a1d24', '#26443a', '#7d8aa0'],
  realistic: ['#14573a', '#1d1d22', '#c62a2a'],
}

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [look, setLookState] = useState<Look>(() => loadLook())
  const [speed, setSpeedState] = useState(() => readEnum('poker.speed', SPEEDS, 'normal'))

  const change = (patch: Partial<Look>) => {
    const next = { ...look, ...patch }
    setLook(next)
    setLookState(next)
  }

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

        <div className="menu-card lobby-card settings-card">
          <section>
            <h2 className="menu-section">Theme</h2>
            <div className="theme-grid" role="radiogroup" aria-label="Theme">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={look.theme === t.id}
                  className={`theme-option ${look.theme === t.id ? 'theme-option-on' : ''}`}
                  onClick={() => change({ theme: t.id })}
                >
                  <span className="theme-swatch" aria-hidden="true">
                    {THEME_SWATCH[t.id].map((color) => (
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
            <h2 className="menu-section">Mode</h2>
            <div className="menu-options" role="radiogroup" aria-label="Mode">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={look.mode === m.id}
                  className={`menu-option ${look.mode === m.id ? 'menu-option-on' : ''}`}
                  onClick={() => change({ mode: m.id })}
                >
                  {m.name}
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
            <p className="menu-hint settings-hint">How fast the bots act and the cards come. You can change it at the table too.</p>
          </section>
        </div>
      </div>
    </div>
  )
}
