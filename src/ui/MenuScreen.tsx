import { useState } from 'react'
import type { GameConfigOptions } from './useHoldemGame'
import { readJSON, writeJSON } from '../utils/storage'
import { SUIT_PATH } from './suit-icons'
import { CoinIcon, DealIcon, PeopleIcon, PercentIcon, PersonIcon } from './icons'

interface MenuScreenProps {
  onStart: (options: GameConfigOptions) => void
}

const MIN_PLAYERS = 2
const MAX_PLAYERS = 10

const STACK_OPTIONS = [500, 1000, 2500, 5000]

const BLIND_OPTIONS: { label: string; smallBlind: number; bigBlind: number }[] = [
  { label: '$1/$2', smallBlind: 1, bigBlind: 2 },
  { label: '$5/$10', smallBlind: 5, bigBlind: 10 },
  { label: '$25/$50', smallBlind: 25, bigBlind: 50 },
  { label: '$100/$200', smallBlind: 100, bigBlind: 200 },
]

const ANTE_OPTIONS = [0, 1, 5, 25]

const DEFAULT_CONFIG: GameConfigOptions = {
  playerCount: 6,
  humanCount: 1,
  startingStack: 1000,
  smallBlind: 5,
  bigBlind: 10,
  ante: 0,
  showHandOdds: false,
}

const STORAGE_KEY = 'poker.lastConfig'

/**
 * The table's front door. Configures a fresh session and remembers the last
 * setup picked, so returning here to change the blinds doesn't mean
 * re-entering everything from scratch.
 */
export function MenuScreen({ onStart }: MenuScreenProps) {
  const [config, setConfig] = useState<GameConfigOptions>(() => {
    // Merge over the defaults rather than trusting the stored shape outright —
    // a config saved before `humanCount` existed would otherwise come back
    // with that field `undefined` and break every clamp below it.
    const stored = readJSON<Partial<GameConfigOptions>>(STORAGE_KEY, {})
    return { ...DEFAULT_CONFIG, ...stored }
  })

  const setPlayerCount = (next: number) => {
    setConfig((c) => {
      const playerCount = Math.min(Math.max(next, MIN_PLAYERS), MAX_PLAYERS)
      return { ...c, playerCount, humanCount: Math.min(c.humanCount, playerCount) }
    })
  }

  const setHumanCount = (next: number) => {
    setConfig((c) => ({ ...c, humanCount: Math.min(Math.max(next, 1), c.playerCount) }))
  }

  const handleStart = () => {
    writeJSON(STORAGE_KEY, config)
    onStart(config)
  }

  return (
    <div className="menu-scene">
      <svg className="menu-watermark menu-watermark-a" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={SUIT_PATH.spades} />
      </svg>
      <svg className="menu-watermark menu-watermark-b" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={SUIT_PATH.hearts} />
      </svg>

      <div className="menu-content">
        <div className="menu-wordmark-row">
          <div className="menu-wordmark">
            <svg className="menu-wordmark-glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d={SUIT_PATH.clubs} />
            </svg>
            <span className="menu-wordmark-text">
              Texas <span className="menu-wordmark-accent">Hold&rsquo;em</span>
            </span>
            <svg className="menu-wordmark-glyph" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d={SUIT_PATH.diamonds} />
            </svg>
          </div>
          <div className="menu-subtitle">Set up the table, then deal yourself in.</div>
        </div>

        <div className="menu-card">
          <div className="menu-field-row">
            <div className="menu-field-heading" style={{ marginBottom: 0 }}>
              <span className="menu-field-icon menu-field-icon-violet">
                <PeopleIcon />
              </span>
              <span className="menu-field-label">Players</span>
            </div>
            <div className="stepper">
              <button
                type="button"
                className="stepper-btn"
                onClick={() => setPlayerCount(config.playerCount - 1)}
                disabled={config.playerCount <= MIN_PLAYERS}
                aria-label="Fewer players"
              >
                −
              </button>
              <span className="stepper-value">{config.playerCount}</span>
              <button
                type="button"
                className="stepper-btn"
                onClick={() => setPlayerCount(config.playerCount + 1)}
                disabled={config.playerCount >= MAX_PLAYERS}
                aria-label="More players"
              >
                +
              </button>
            </div>
          </div>

          <div className="menu-divider" />

          <div>
            <div className="menu-field-row">
              <div className="menu-field-heading" style={{ marginBottom: 0 }}>
                <span className="menu-field-icon menu-field-icon-violet">
                  <PersonIcon />
                </span>
                <span className="menu-field-label">Human players</span>
              </div>
              <div className="stepper">
                <button
                  type="button"
                  className="stepper-btn"
                  onClick={() => setHumanCount(config.humanCount - 1)}
                  disabled={config.humanCount <= 1}
                  aria-label="Fewer human players"
                >
                  −
                </button>
                <span className="stepper-value">{config.humanCount}</span>
                <button
                  type="button"
                  className="stepper-btn"
                  onClick={() => setHumanCount(config.humanCount + 1)}
                  disabled={config.humanCount >= config.playerCount}
                  aria-label="More human players"
                >
                  +
                </button>
              </div>
            </div>
            <div className="menu-hint">
              {config.humanCount > 1
                ? "Pass-and-play — everyone shares this device. Hands stay hidden until it's your turn."
                : 'Just you, against the rest at the table.'}
            </div>
          </div>

          <div className="menu-divider" />

          <div>
            <div className="menu-field-heading">
              <span className="menu-field-icon menu-field-icon-gold">
                <CoinIcon />
              </span>
              <span className="menu-field-label">Starting stack</span>
            </div>
            <div className="menu-options">
              {STACK_OPTIONS.map((stack) => (
                <button
                  key={stack}
                  type="button"
                  className={`menu-option ${config.startingStack === stack ? 'menu-option-on' : ''}`}
                  onClick={() => setConfig((c) => ({ ...c, startingStack: stack }))}
                >
                  ${stack.toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="menu-field-heading">
              <span className="menu-field-icon menu-field-icon-gold">
                <CoinIcon />
              </span>
              <span className="menu-field-label">Blinds</span>
            </div>
            <div className="menu-options">
              {BLIND_OPTIONS.map((b) => (
                <button
                  key={b.label}
                  type="button"
                  className={`menu-option ${config.smallBlind === b.smallBlind && config.bigBlind === b.bigBlind ? 'menu-option-on' : ''}`}
                  onClick={() => setConfig((c) => ({ ...c, smallBlind: b.smallBlind, bigBlind: b.bigBlind }))}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="menu-field-heading">
              <span className="menu-field-icon menu-field-icon-gold">
                <CoinIcon />
              </span>
              <span className="menu-field-label">Ante</span>
            </div>
            <div className="menu-options">
              {ANTE_OPTIONS.map((ante) => (
                <button
                  key={ante}
                  type="button"
                  className={`menu-option ${config.ante === ante ? 'menu-option-on' : ''}`}
                  onClick={() => setConfig((c) => ({ ...c, ante }))}
                >
                  {ante === 0 ? 'None' : `$${ante}`}
                </button>
              ))}
            </div>
          </div>

          <div className="menu-divider" />

          <div className="menu-field-row">
            <div className="menu-field-heading" style={{ marginBottom: 0 }}>
              <span className="menu-field-icon menu-field-icon-violet">
                <PercentIcon />
              </span>
              <div>
                <span className="menu-field-label">Hand odds</span>
                <div className="menu-hint" style={{ marginLeft: 0, marginTop: '0.15rem' }}>
                  Show the exact odds of ending up with each hand type as the board comes out.
                </div>
              </div>
            </div>
            <button
              type="button"
              className={`menu-option menu-toggle ${config.showHandOdds ? 'menu-option-on' : ''}`}
              onClick={() => setConfig((c) => ({ ...c, showHandOdds: !c.showHandOdds }))}
              aria-pressed={config.showHandOdds}
            >
              {config.showHandOdds ? 'On' : 'Off'}
            </button>
          </div>

          <button type="button" className="btn menu-start" onClick={handleStart}>
            <DealIcon className="menu-start-icon" />
            {config.humanCount > 1 ? 'Start pass-and-play' : 'Deal me in'}
          </button>
        </div>
      </div>
    </div>
  )
}
