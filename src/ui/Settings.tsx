import { useState } from 'react'
import {
  BUTTONS,
  COLORS,
  CORNERS,
  FONTS,
  LAYOUTS,
  PRESETS,
  loadLook,
  sameLook,
  setLook,
  type CornersId,
  type Look,
} from '../game/settings'
import { readEnum, writeString } from '../utils/storage'
import { SUIT_PATH } from './suit-icons'

const SPEEDS = ['slow', 'normal', 'fast'] as const

/** How round each corner choice is drawn in its preview. */
const CORNER_PREVIEW: Record<CornersId, string> = { soft: '0.6rem', sharp: '0.25rem', square: '0.1rem', round: '1rem' }

/** A tiny plan of each layout. */
function LayoutThumb({ id }: { id: 'standard' | 'round' }) {
  return (
    <svg viewBox="0 0 80 46" className="layout-thumb" aria-hidden="true">
      {id === 'standard' ? (
        <>
          <rect x="3" y="3" width="74" height="30" rx="5" fill="currentColor" opacity="0.18" />
          {[14, 27, 40, 53, 66].map((x) => (
            <circle key={x} cx={x} cy="11" r="3.2" fill="currentColor" />
          ))}
          <rect x="24" y="20" width="32" height="7" rx="1.5" fill="currentColor" opacity="0.45" />
          <rect x="30" y="37" width="20" height="6" rx="1.5" fill="currentColor" opacity="0.7" />
        </>
      ) : (
        <>
          <ellipse cx="40" cy="20" rx="35" ry="17" fill="currentColor" opacity="0.18" />
          {[
            [9, 24],
            [14, 9],
            [28, 4],
            [52, 4],
            [66, 9],
            [71, 24],
          ].map(([x, y]) => (
            <circle key={`${x}${y}`} cx={x} cy={y} r="3.2" fill="currentColor" />
          ))}
          <rect x="26" y="17" width="28" height="7" rx="1.5" fill="currentColor" opacity="0.45" />
          <rect x="31" y="35" width="18" height="8" rx="1.5" fill="currentColor" opacity="0.7" transform="rotate(-3 40 39)" />
        </>
      )}
    </svg>
  )
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

        <div className="menu-card lobby-card">
          <section>
            <h2 className="menu-section">Looks</h2>
            <p className="menu-hint">A ready-made set of the five choices below. Change any of them after.</p>
            <div className="theme-grid" role="radiogroup" aria-label="Looks">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={sameLook(look, p.look)}
                  className={`theme-option ${sameLook(look, p.look) ? 'theme-option-on' : ''}`}
                  onClick={() => change(p.look)}
                >
                  <span className="theme-name">{p.name}</span>
                  <span className="theme-desc">{p.description}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="menu-divider" />

          <section>
            <h2 className="menu-section">Colours</h2>
            <div className="theme-grid" role="radiogroup" aria-label="Colours">
              {COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={look.color === c.id}
                  className={`theme-option ${look.color === c.id ? 'theme-option-on' : ''}`}
                  onClick={() => change({ color: c.id })}
                >
                  <span className="theme-swatch" aria-hidden="true">
                    {c.swatch.map((color) => (
                      <span key={color} style={{ background: color }} />
                    ))}
                  </span>
                  <span className="theme-name">{c.name}</span>
                  <span className="theme-desc">{c.description}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="menu-divider" />

          <section>
            <h2 className="menu-section">Layout</h2>
            <div className="theme-grid" role="radiogroup" aria-label="Layout">
              {LAYOUTS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  role="radio"
                  aria-checked={look.layout === l.id}
                  className={`theme-option ${look.layout === l.id ? 'theme-option-on' : ''}`}
                  onClick={() => change({ layout: l.id })}
                >
                  <LayoutThumb id={l.id} />
                  <span className="theme-name">{l.name}</span>
                  <span className="theme-desc">{l.description}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="menu-divider" />

          <section>
            <h2 className="menu-section">Fonts</h2>
            <div className="theme-grid" role="radiogroup" aria-label="Fonts">
              {FONTS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={look.font === f.id}
                  className={`theme-option ${look.font === f.id ? 'theme-option-on' : ''}`}
                  onClick={() => change({ font: f.id })}
                >
                  <span className="theme-sample" style={{ fontFamily: f.family }} aria-hidden="true">
                    Aa $1,250
                  </span>
                  <span className="theme-name">{f.name}</span>
                  <span className="theme-desc">{f.description}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="menu-divider" />

          <section>
            <h2 className="menu-section">Buttons</h2>
            <div className="theme-grid" role="radiogroup" aria-label="Buttons">
              {BUTTONS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={look.buttons === b.id}
                  className={`theme-option ${look.buttons === b.id ? 'theme-option-on' : ''}`}
                  onClick={() => change({ buttons: b.id })}
                >
                  <span className="theme-buttons" data-buttons={b.id} aria-hidden="true">
                    <span className="btn btn-sm btn-danger">Fold</span>
                    <span className="btn btn-sm btn-primary">Call</span>
                    <span className="btn btn-sm btn-accent">Raise</span>
                  </span>
                  <span className="theme-name">{b.name}</span>
                  <span className="theme-desc">{b.description}</span>
                </button>
              ))}
            </div>
          </section>

          <div className="menu-divider" />

          <section>
            <h2 className="menu-section">Corners</h2>
            <div className="theme-grid" role="radiogroup" aria-label="Corners">
              {CORNERS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={look.corners === c.id}
                  className={`theme-option ${look.corners === c.id ? 'theme-option-on' : ''}`}
                  onClick={() => change({ corners: c.id })}
                >
                  <span className="theme-corner" style={{ borderRadius: CORNER_PREVIEW[c.id] }} aria-hidden="true" />
                  <span className="theme-name">{c.name}</span>
                  <span className="theme-desc">{c.description}</span>
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
