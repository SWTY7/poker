import { useState } from 'react'
import { isRoomCode } from '../../home/room'
import type { HomeConfig } from '../../home/table'
import { DealIcon } from '../icons'
import { SUIT_PATH } from '../suit-icons'

export interface HostSetup {
  config: HomeConfig
  /** The host's own name, if the host plays too; null to only deal. */
  hostName: string | null
}

interface HostEntryProps {
  initialName: string
  onOpen: (setup: HostSetup) => void
  onBack: () => void
}

interface JoinEntryProps {
  initialName: string
  initialCode: string
  onJoin: (code: string, name: string) => void
  onBack: () => void
}

const DEFAULT: HomeConfig = { startingStack: 1000, smallBlind: 5, bigBlind: 10, ante: 0 }

function Frame({ title, subtitle, onBack, children }: { title: string; subtitle: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="menu-scene">
      <svg className="menu-watermark menu-watermark-a" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d={SUIT_PATH.clubs} />
      </svg>
      <div className="menu-content">
        <div className="menu-wordmark-row">
          <div className="menu-wordmark">
            <span className="menu-wordmark-text">{title}</span>
          </div>
          <div className="menu-subtitle">{subtitle}</div>
          <div className="menu-bankroll-row">
            <button type="button" className="menu-back-link" onClick={onBack}>
              ← Lobby
            </button>
          </div>
        </div>
        <div className="menu-card lobby-card">{children}</div>
      </div>
    </div>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="home-field">
      <span>{label}</span>
      <input inputMode="numeric" value={value || ''} onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)} />
    </label>
  )
}

/** Setting up a room: the stakes, and whether the host sits in or only deals. */
export function HostEntry({ initialName, onOpen, onBack }: HostEntryProps) {
  const [config, setConfig] = useState<HomeConfig>(DEFAULT)
  const [plays, setPlays] = useState(true)
  const [name, setName] = useState(initialName)
  const valid = config.smallBlind > 0 && config.bigBlind >= config.smallBlind && config.startingStack > config.bigBlind && (!plays || name.trim() !== '')

  return (
    <Frame title="Host a game" subtitle="Real cards, real table. The phones keep the chips." onBack={onBack}>
      <section>
        <h2 className="menu-section">Stakes</h2>
        <div className="home-fields">
          <NumberField label="Everyone starts with" value={config.startingStack} onChange={(startingStack) => setConfig((c) => ({ ...c, startingStack }))} />
          <NumberField label="Small blind" value={config.smallBlind} onChange={(smallBlind) => setConfig((c) => ({ ...c, smallBlind }))} />
          <NumberField label="Big blind" value={config.bigBlind} onChange={(bigBlind) => setConfig((c) => ({ ...c, bigBlind }))} />
          <NumberField label="Ante" value={config.ante} onChange={(ante) => setConfig((c) => ({ ...c, ante }))} />
        </div>
      </section>

      <div className="menu-divider" />

      <section>
        <div className="menu-field-row">
          <span className="menu-field-label">I’m playing too</span>
          <button
            type="button"
            className={`menu-option menu-toggle ${plays ? 'menu-option-on' : ''}`}
            aria-pressed={plays}
            onClick={() => setPlays((p) => !p)}
          >
            {plays ? 'Yes' : 'Just dealing'}
          </button>
        </div>
        {plays && (
          <label className="home-field">
            <span>Your name</span>
            <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} placeholder="Name at the table" />
          </label>
        )}
      </section>

      <p className="menu-hint">
        The room lives on this phone: keep this screen open while you play. Everyone should be on the same Wi-Fi; some mobile
        networks block the direct connection.
      </p>

      <button
        type="button"
        className="btn menu-start"
        disabled={!valid}
        onClick={() => onOpen({ config, hostName: plays ? name.trim() : null })}
      >
        <DealIcon className="menu-start-icon" />
        Open the room
      </button>
    </Frame>
  )
}

/** Joining a room: its number, and your name at the table. */
export function JoinEntry({ initialName, initialCode, onJoin, onBack }: JoinEntryProps) {
  const [code, setCode] = useState(initialCode)
  const [name, setName] = useState(initialName)
  const valid = isRoomCode(code) && name.trim() !== ''

  return (
    <Frame title="Join a game" subtitle="Ask the host for the room number." onBack={onBack}>
      <label className="home-field">
        <span>Room number</span>
        <input
          className="home-code-input"
          inputMode="numeric"
          maxLength={4}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="1234"
        />
      </label>
      <label className="home-field">
        <span>Your name</span>
        <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} placeholder="Name at the table" />
      </label>
      <button type="button" className="btn menu-start" disabled={!valid} onClick={() => onJoin(code, name.trim())}>
        <DealIcon className="menu-start-icon" />
        Join
      </button>
    </Frame>
  )
}
