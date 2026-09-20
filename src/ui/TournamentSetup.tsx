import { useState } from 'react'
import { STRUCTURES, type TournamentStructure } from '../game/tournament'
import { canAffordBuyIn } from '../game/profile'
import { CoinIcon, PeopleIcon, TrophyIcon } from './icons'
import { SUIT_PATH } from './suit-icons'

const BUY_IN_TIERS = [20, 50, 100, 500]
const MIN_FIELD = 2
const MAX_FIELD = 10
const DEFAULT_FIELD = 6

export interface TournamentEntry {
  buyIn: number
  fieldSize: number
  structure: TournamentStructure
}

interface TournamentSetupProps {
  bankroll: number
  onBack: () => void
  onRegister: (entry: TournamentEntry) => void
}

/**
 * Registering, not configuring. A cash game is a private choice — you can
 * set the stakes to whatever you like, because you're the only one at risk.
 * A tournament has a field and a prize pool, both of which only make sense
 * if everyone at the table bought in for the same amount and is playing the
 * same clock — so this offers a buy-in and a structure to pick from rather
 * than free-form numbers.
 */
export function TournamentSetup({ bankroll, onBack, onRegister }: TournamentSetupProps) {
  const [buyIn, setBuyIn] = useState(() => BUY_IN_TIERS.find((tier) => canAffordBuyIn(bankroll, tier)) ?? BUY_IN_TIERS[0])
  const [structureId, setStructureId] = useState<TournamentStructure['id']>('sit-and-go')
  const [fieldSize, setFieldSize] = useState(DEFAULT_FIELD)

  const structure = STRUCTURES[structureId]
  const canAfford = buyIn <= bankroll
  const prizePool = buyIn * fieldSize

  return (
    <div className="menu-scene">
      <svg className="menu-watermark menu-watermark-a" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={SUIT_PATH.spades} />
      </svg>
      <svg className="menu-watermark menu-watermark-b" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={SUIT_PATH.clubs} />
      </svg>

      <div className="menu-content">
        <div className="menu-wordmark-row">
          <div className="menu-wordmark">
            <TrophyIcon className="menu-wordmark-glyph" />
            <span className="menu-wordmark-text">Tournament</span>
          </div>
          <div className="menu-subtitle">One buy-in. Rising blinds. A prize for the places that pay.</div>
        </div>

        <div className="menu-card">
          <section className="menu-group">
            <h2 className="menu-section">Buy-in</h2>
            <div className="menu-field-heading">
              <span className="menu-field-icon menu-field-icon-gold">
                <CoinIcon />
              </span>
              <span className="menu-field-label">From your ${bankroll.toLocaleString()} bankroll</span>
            </div>
            <div className="menu-options">
              {BUY_IN_TIERS.map((tier) => (
                <button
                  key={tier}
                  type="button"
                  className={`menu-option ${buyIn === tier ? 'menu-option-on' : ''}`}
                  disabled={tier > bankroll}
                  onClick={() => setBuyIn(tier)}
                >
                  ${tier.toLocaleString()}
                </button>
              ))}
            </div>
            {!canAfford && <p className="menu-hint">Not enough in the bankroll for this buy-in.</p>}
          </section>

          <div className="menu-divider" />

          <section className="menu-group">
            <h2 className="menu-section">Structure</h2>
            <div className="tournament-structures">
              {Object.values(STRUCTURES).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`tournament-structure-card ${structureId === s.id ? 'menu-option-on' : ''}`}
                  onClick={() => setStructureId(s.id)}
                >
                  <span className="tournament-structure-name">{s.name}</span>
                  <span className="tournament-structure-copy">{s.description}</span>
                  <span className="tournament-structure-meta">
                    {s.startingStack.toLocaleString()} chips · {s.handsPerLevel} hands/level
                  </span>
                </button>
              ))}
            </div>
          </section>

          <div className="menu-divider" />

          <section className="menu-group">
            <h2 className="menu-section">Field</h2>
            <div className="menu-field-row">
              <div className="menu-field-heading" style={{ marginBottom: 0 }}>
                <span className="menu-field-icon menu-field-icon-accent">
                  <PeopleIcon />
                </span>
                <span className="menu-field-label">Players</span>
              </div>
              <div className="stepper">
                <button
                  type="button"
                  className="stepper-btn"
                  onClick={() => setFieldSize((n) => Math.max(MIN_FIELD, n - 1))}
                  disabled={fieldSize <= MIN_FIELD}
                  aria-label="Fewer players"
                >
                  −
                </button>
                <span className="stepper-value">{fieldSize}</span>
                <button
                  type="button"
                  className="stepper-btn"
                  onClick={() => setFieldSize((n) => Math.min(MAX_FIELD, n + 1))}
                  disabled={fieldSize >= MAX_FIELD}
                  aria-label="More players"
                >
                  +
                </button>
              </div>
            </div>
            <p className="menu-hint">
              Prize pool ${prizePool.toLocaleString()} — {placesPaidHint(fieldSize)}.
            </p>
          </section>

          <div className="tournament-actions">
            <button type="button" className="btn btn-secondary" onClick={onBack}>
              Back
            </button>
            <button
              type="button"
              className="btn menu-start"
              disabled={!canAfford}
              onClick={() => onRegister({ buyIn, fieldSize, structure })}
            >
              <TrophyIcon className="menu-start-icon" />
              Register for ${buyIn.toLocaleString()}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function placesPaidHint(fieldSize: number): string {
  // Mirrors game/tournament.ts's payoutSplits brackets, in words rather than
  // numbers, so a player picking a field size can see what it buys them
  // before committing — this is copy, not logic, and has no effect on the
  // actual payout, which the tournament module computes independently.
  if (fieldSize <= 2) return 'winner takes it all'
  if (fieldSize <= 6) return 'pays the top 2'
  if (fieldSize <= 9) return 'pays the top 3'
  return 'pays the top 6'
}
