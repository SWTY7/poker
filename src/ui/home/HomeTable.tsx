import { useEffect, useState } from 'react'
import type { ActionType } from '../../poker/game-state'
import type { TableView } from '../../home/room'
import { betweenHands, canStartHand, currentBlinds, DEFAULT_LEVEL_MINUTES, levelEndsAt, LEVEL_MINUTE_OPTIONS, options, potTotal, type Command } from '../../home/table'
import { risingBlinds } from '../../game/blinds'
import type { RoomStatus } from '../../home/socket'
import { avatarInitial, avatarStyle } from '../avatar'
import { CardView } from '../CardView'

interface HomeTableProps {
  view: TableView | null
  status: RoomStatus
  detail: string | null
  error: string | null
  onClearError: () => void
  /** This phone's own seat, if it has one. */
  myId: string | null
  /** The host's device: the game's flow (dealing, and with real cards the streets and showdown). */
  isHost: boolean
  code: string | null
  send: (command: Command) => void
  onLeave: () => void
}

const STREET_NAME: Record<string, string> = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' }
const NEXT_DEAL: Record<string, string> = { preflop: 'Deal the flop', flop: 'Deal the turn', turn: 'Deal the river', river: 'Showdown' }

function money(amount: number): string {
  return amount.toLocaleString()
}

/**
 * The blinds now, and with a blind clock, the level and the time left in it.
 * Counted by the server's clock (each view carries it), not this phone's,
 * so every phone at the table shows the same countdown.
 */
function BlindsLine({ view }: { view: TableView }) {
  const endsAt = levelEndsAt(view)
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    if (endsAt === null) return
    const skew = view.now - Date.now()
    const update = () => setLeft(endsAt - (Date.now() + skew))
    const first = window.setTimeout(update, 0)
    const timer = window.setInterval(update, 1000)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [endsAt, view.now])

  const blinds = currentBlinds(view)
  const text = `Blinds ${money(blinds.smallBlind)}/${money(blinds.bigBlind)}${blinds.ante > 0 ? `, ante ${money(blinds.ante)}` : ''}`
  if (!view.config.levelMinutes) return <span className="home-blinds-line">{text}</span>
  if (endsAt === null || !view.clock) return <span className="home-blinds-line">{text} · up every {view.config.levelMinutes} min, from the first deal</span>
  const next = risingBlinds(view.config, view.clock.level + 1)
  return (
    <span className="home-blinds-line">
      Level {view.clock.level} · {text} ·{' '}
      {left === null ? '' : left > 0 ? `${clock(left)} to ${money(next.smallBlind)}/${money(next.bigBlind)}` : `${money(next.smallBlind)}/${money(next.bigBlind)} from the next hand`}
    </span>
  )
}

/** 12:04 */
function clock(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * The home game table, the same on every phone: the pot, the street, every
 * seat's stack and bet, and whose turn it is. The player to act gets their
 * buttons. The host's phone also deals (turns the streets), pays out the
 * showdown. Nobody, the host included, can act for anyone else's seat.
 */
export function HomeTable({ view, status, detail, error, onClearError, myId, isHost, code, send, onLeave }: HomeTableProps) {
  const [confirmLeave, setConfirmLeave] = useState(false)
  const shareLink = code ? `${location.origin}${location.pathname}?room=${code}` : null

  return (
    <div className="menu-scene home-scene">
      <div className="menu-content home-content">
        <header className="home-header">
          <div>
            <div className="home-room-label">Room</div>
            <div className="home-room-code">{code ?? '····'}</div>
          </div>
          <div className="home-header-right">
            <StatusPill status={status} detail={detail} />
            {confirmLeave ? (
              <span className="home-leave-confirm">
                {isHost ? 'Leave? The room stays open; reopen it from the lobby.' : 'Leave the table?'}
                <button type="button" className="lobby-reset-link" onClick={onLeave}>
                  Yes
                </button>
                <button type="button" className="lobby-reset-link" onClick={() => setConfirmLeave(false)}>
                  No
                </button>
              </span>
            ) : (
              <button type="button" className="menu-back-link" onClick={() => setConfirmLeave(true)}>
                Leave
              </button>
            )}
          </div>
        </header>

        {isHost && shareLink && view?.phase === 'lobby' && (
          <p className="menu-hint home-share">
            Friends open <strong>{shareLink}</strong>, or the app’s Home Game → Join with room <strong>{code}</strong>.
            {view.cards === 'online'
              ? ' The app deals: everyone sees their own two cards on their phone, and nobody else’s.'
              : ' Deal the real cards; the phones keep the chips.'}
          </p>
        )}

        {error && (
          <button type="button" className="home-error" onClick={onClearError}>
            {error}
          </button>
        )}

        {!view ? (
          <div className="menu-card lobby-card home-waiting">{status === 'open' ? 'Waiting for the table…' : 'Connecting to the room…'}</div>
        ) : (
          <>
            <PotBar view={view} />
            {view.cards === 'online' && <OnlineCards view={view} myId={myId} />}
            <Seats view={view} myId={myId} isHost={isHost} send={send} />
            <ActionPanel key={`${view.handNumber}-${view.actionHistory.length}-${view.street}`} view={view} myId={myId} send={send} />
            <SelfControls view={view} myId={myId} send={send} />
            {isHost && <DealerControls view={view} send={send} />}
            {!isHost && betweenHands(view) && (
              <p className="menu-hint home-center">
                {view.phase === 'lobby' ? 'Waiting for the host to deal the first hand.' : 'Waiting for the host to deal the next hand.'}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function StatusPill({ status, detail }: { status: RoomStatus; detail: string | null }) {
  const label = status === 'open' ? 'Connected' : status === 'closed' ? 'Closed' : (detail ?? 'Connecting…')
  return <span className={`home-status home-status-${status}`}>{label}</span>
}

function PotBar({ view }: { view: TableView }) {
  const last = view.phase === 'hand-over' ? view.lastResults : []
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? id
  return (
    <section className="menu-card home-pot">
      <div className="home-pot-row">
        <span className="home-street">{view.handNumber === 0 ? 'No hand yet' : `Hand ${view.handNumber} · ${STREET_NAME[view.street]}`}</span>
        <span className="home-pot-amount">Pot {money(potTotal(view))}</span>
      </div>
      <BlindsLine view={view} />
      {last.length > 0 && (
        <ul className="home-results">
          {last.map((r, i) => (
            <li key={i}>
              {r.winnerIds.map(name).join(' & ')} {r.winnerIds.length > 1 ? 'split' : 'won'} {money(r.potAmount)}
              {r.hand ? ` · ${r.hand}` : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Online cards: the board, and this phone's own two cards. */
function OnlineCards({ view, myId }: { view: TableView; myId: string | null }) {
  const mine = view.players.find((p) => p.id === myId)?.holeCards ?? []
  if (view.handNumber === 0) return null
  return (
    <section className="menu-card home-cards">
      <div className="home-board" aria-label="Board">
        {Array.from({ length: 5 }, (_, i) =>
          view.board[i] ? (
            <CardView key={`${view.handNumber}-b${i}`} card={view.board[i]} size="md" index={i} />
          ) : (
            <CardView key={`slot-${i}`} size="md" slot />
          ),
        )}
      </div>
      {mine.length === 2 && (
        <div className="home-hand" aria-label="Your cards">
          {mine.map((card, i) => (
            <CardView key={`${view.handNumber}-h${i}`} card={card} size="lg" index={i} />
          ))}
        </div>
      )}
    </section>
  )
}

function Seats({ view, myId, isHost, send }: { view: TableView; myId: string | null; isHost: boolean; send: (c: Command) => void }) {
  const editing = isHost && betweenHands(view)
  const toAct = view.phase === 'betting' ? view.players[view.currentPlayerIndex]?.id : undefined
  const inHand = !betweenHands(view)

  return (
    <ul className="menu-card home-seats">
      {view.players.map((p, i) => {
        const markers = [
          inHand || view.handNumber > 0 ? (i === view.dealerIndex ? 'D' : null) : null,
          inHand && i === view.smallBlindIndex ? 'SB' : null,
          inHand && i === view.bigBlindIndex ? 'BB' : null,
        ].filter(Boolean)
        const connected = view.connected.includes(p.id)
        const state = p.isEliminated ? 'out' : !inHand ? null : p.folded ? 'folded' : p.isAllIn ? 'all-in' : null
        return (
          <li key={p.id} className={`home-seat ${p.id === toAct ? 'home-seat-turn' : ''} ${state === 'folded' || state === 'out' ? 'home-seat-dim' : ''}`}>
            <span className="seating-avatar" style={avatarStyle(p.name)} aria-hidden="true">
              {avatarInitial(p.name)}
            </span>
            <span className="home-seat-main">
              <span className="home-seat-name">
                {p.name}
                {p.id === myId && <span className="home-you"> (you)</span>}
                {!connected && p.id !== myId && <span className="home-offline" title="No phone connected"> · offline</span>}
              </span>
              <span className="home-seat-sub">
                {markers.map((m) => (
                  <span key={m} className="home-marker">
                    {m}
                  </span>
                ))}
                {state && <span className="home-state">{state}</span>}
                {p.betThisStreet > 0 && <span className="home-bet">bet {money(p.betThisStreet)}</span>}
                {p.id !== myId && view.revealed.includes(p.id) && p.holeCards.length === 2 && (
                  <span className="home-shown" aria-label={`${p.name} showed`}>
                    {p.holeCards.map((card, c) => (
                      <CardView key={c} card={card} size="sm" animate={false} />
                    ))}
                  </span>
                )}
              </span>
            </span>
            <span className="home-stack">{money(p.stack)}</span>
            {editing && (
              <span className="home-seat-edit">
                <button type="button" className="home-icon-btn" aria-label={`Move ${p.name} up`} disabled={i === 0} onClick={() => send({ type: 'move', id: p.id, toIndex: i - 1 })}>
                  ▲
                </button>
                <button
                  type="button"
                  className="home-icon-btn"
                  aria-label={`Move ${p.name} down`}
                  disabled={i === view.players.length - 1}
                  onClick={() => send({ type: 'move', id: p.id, toIndex: i + 1 })}
                >
                  ▼
                </button>
                <button type="button" className="home-icon-btn" aria-label={`Remove ${p.name}`} onClick={() => send({ type: 'remove', id: p.id })}>
                  ✕
                </button>
              </span>
            )}
          </li>
        )
      })}
      {view.players.length === 0 && <li className="menu-hint home-center">Nobody has joined yet.</li>}
    </ul>
  )
}

/** The betting buttons, only ever for this phone's own seat. */
function ActionPanel({ view, myId, send }: { view: TableView; myId: string | null; send: (c: Command) => void }) {
  const actor = view.phase === 'betting' ? view.players[view.currentPlayerIndex] : undefined
  const mine = actor !== undefined && actor.id === myId
  const choices = actor && mine ? options(view, actor.id) : null
  const [amount, setAmount] = useState('')

  if (!actor) return null
  if (!choices) {
    return <p className="menu-hint home-center">Waiting for {actor.name}…</p>
  }

  const pot = potTotal(view)
  const clamp = (to: number) => Math.min(Math.max(Math.round(to), choices.minTo), choices.maxTo)
  const potRaise = (fraction: number) => clamp(view.currentBet + (pot + choices.toCall) * fraction)
  const raiseKind: ActionType | undefined = choices.actions.find((a) => a === 'bet' || a === 'raise')
  const typed = Number(amount)
  const valid = amount !== '' && typed >= choices.minTo && typed <= choices.maxTo
  const act = (action: ActionType, to?: number) => {
    send({ type: 'act', playerId: actor.id, action, amount: to })
    setAmount('')
  }

  return (
    <section className="menu-card home-actions home-actions-mine">
      <h2 className="menu-section">Your turn</h2>
      <div className="home-action-row">
        {choices.actions.includes('fold') && (
          <button type="button" className="btn btn-secondary" onClick={() => act('fold')}>
            Fold
          </button>
        )}
        {choices.actions.includes('check') && (
          <button type="button" className="btn btn-secondary" onClick={() => act('check')}>
            Check
          </button>
        )}
        {choices.actions.includes('call') && (
          <button type="button" className="btn btn-primary" onClick={() => act('call')}>
            Call {money(choices.toCall)}
          </button>
        )}
        {choices.actions.includes('all-in') && (
          <button type="button" className="btn btn-secondary" onClick={() => act('all-in')}>
            All-in {money(actor.stack + actor.betThisStreet)}
          </button>
        )}
      </div>
      {raiseKind && (
        <div className="home-raise">
          <div className="home-action-row">
            {(
              [
                ['Min', choices.minTo],
                ['½ pot', potRaise(0.5)],
                ['Pot', potRaise(1)],
              ] as const
            ).map(([label, to]) => (
              <button key={label} type="button" className="menu-option" onClick={() => setAmount(String(to))}>
                {label}
              </button>
            ))}
          </div>
          <div className="home-action-row">
            <input
              className="home-amount"
              inputMode="numeric"
              placeholder={`${money(choices.minTo)}–${money(choices.maxTo)}`}
              aria-label={raiseKind === 'bet' ? 'Bet amount' : 'Raise to'}
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
            />
            <button type="button" className="btn btn-primary" disabled={!valid} onClick={() => act(raiseKind, typed)}>
              {raiseKind === 'bet' ? 'Bet' : 'Raise to'} {valid ? money(typed) : ''}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

function DealerControls({ view, send }: { view: TableView; send: (c: Command) => void }) {
  return (
    <section className="menu-card home-dealer">
      <h2 className="menu-section">Dealer</h2>
      {view.phase === 'street-done' && (
        <button type="button" className="btn menu-start" onClick={() => send({ type: 'advanceStreet' })}>
          {NEXT_DEAL[view.street]}
        </button>
      )}
      {view.phase === 'showdown' && <ShowdownPicker view={view} send={send} />}
      {betweenHands(view) && (
        <>
          <button type="button" className="btn menu-start" disabled={!canStartHand(view)} onClick={() => send({ type: 'startHand' })}>
            {view.handNumber === 0 ? 'Deal the first hand' : 'Deal the next hand'}
          </button>
          {!canStartHand(view) && <p className="menu-hint">Needs two players with chips.</p>}
          <BlindsEditor view={view} send={send} />
        </>
      )}
    </section>
  )
}

/**
 * What a phone may do for itself beyond betting: take back its own last move
 * (the server only offers it to whoever made it), and buy back in when busted.
 */
function SelfControls({ view, myId, send }: { view: TableView; myId: string | null; send: (c: Command) => void }) {
  const me = view.players.find((p) => p.id === myId)
  const busted = me !== undefined && betweenHands(view) && (me.isEliminated || me.stack === 0)
  if (!view.canUndo && !busted) return null
  return (
    <div className="home-self">
      {busted && (
        <button type="button" className="btn btn-primary" onClick={() => send({ type: 'rebuy', id: me.id })}>
          Rebuy for {money(view.config.startingStack)}
        </button>
      )}
      {view.canUndo && (
        <button type="button" className="lobby-reset-link" onClick={() => send({ type: 'undo' })}>
          {view.canUndo === 'dealer' ? 'Undo the last deal' : 'Undo my last move'}
        </button>
      )}
    </div>
  )
}

function ShowdownPicker({ view, send }: { view: TableView; send: (c: Command) => void }) {
  const [picked, setPicked] = useState<string[][]>(() => view.pots.map((pot) => (pot.eligiblePlayerIds.length === 1 ? [...pot.eligiblePlayerIds] : [])))
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? id
  const toggle = (potIndex: number, id: string) =>
    setPicked((all) => all.map((ids, i) => (i !== potIndex ? ids : ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])))
  const ready = picked.length === view.pots.length && picked.every((ids) => ids.length > 0)

  return (
    <div className="home-showdown">
      <p className="menu-hint">Turn the cards over, then tap who won each pot. Tap two or more to split it.</p>
      {view.pots.map((pot, i) => (
        <div key={i} className="home-pot-pick">
          <div className="home-pot-pick-title">
            {view.pots.length > 1 ? (i === 0 ? 'Main pot' : `Side pot ${i}`) : 'Pot'} · {money(pot.amount)}
          </div>
          <div className="home-action-row">
            {pot.eligiblePlayerIds.map((id) => (
              <button
                key={id}
                type="button"
                className={`menu-option ${picked[i]?.includes(id) ? 'menu-option-on' : ''}`}
                aria-pressed={picked[i]?.includes(id)}
                onClick={() => toggle(i, id)}
              >
                {name(id)}
              </button>
            ))}
          </div>
        </div>
      ))}
      <button type="button" className="btn menu-start" disabled={!ready} onClick={() => send({ type: 'award', winnersByPot: picked })}>
        Pay out
      </button>
    </div>
  )
}

function BlindsEditor({ view, send }: { view: TableView; send: (c: Command) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(() => ({ ...view.config, levelMinutes: view.config.levelMinutes ?? 0 }))
  if (!open) {
    return (
      <button type="button" className="lobby-reset-link" onClick={() => setOpen(true)}>
        Change the blinds
      </button>
    )
  }
  const field = (key: keyof typeof draft, label: string) => (
    <label className="home-field">
      <span>{label}</span>
      <input
        inputMode="numeric"
        value={draft[key]}
        onChange={(e) => setDraft((d) => ({ ...d, [key]: Number(e.target.value.replace(/\D/g, '')) || 0 }))}
      />
    </label>
  )
  return (
    <div className="home-blinds">
      {field('smallBlind', 'Small blind')}
      {field('bigBlind', 'Big blind')}
      {field('ante', 'Ante')}
      {field('startingStack', 'New players start with')}
<div className="menu-field-row">
          <span className="menu-field-label">Rising blinds</span>
          <button
            type="button"
            className={`menu-option menu-toggle ${draft.levelMinutes ? 'menu-option-on' : ''}`}
            aria-pressed={!!draft.levelMinutes}
            onClick={() => setDraft((c) => ({ ...c, levelMinutes: c.levelMinutes ? 0 : DEFAULT_LEVEL_MINUTES }))}
          >
            {draft.levelMinutes ? 'On' : 'Off'}
          </button>
        </div>
        {!!draft.levelMinutes && (
          <div className="menu-options">
            {LEVEL_MINUTE_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                className={`menu-option ${draft.levelMinutes === m ? 'menu-option-on' : ''}`}
                aria-pressed={draft.levelMinutes === m}
                onClick={() => setDraft((c) => ({ ...c, levelMinutes: m }))}
              >
                Every {m} min
              </button>
            ))}
          </div>
        )}
      {view.clock && <p className="menu-hint">The blinds above are level 1; the clock stays on level {view.clock.level}.</p>}
      <div className="home-action-row">
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            send({ type: 'configure', config: draft })
            setOpen(false)
          }}
        >
          Save
        </button>
      </div>
    </div>
  )
}
