import { useEffect, useMemo, useState } from 'react'
import type { ActionType, GameState, HandLogEntry } from '../poker/game-state'
import { getLegalActions, minRaiseTargetAmount, maxRaiseTargetAmount } from '../poker/betting'
import { committedPot, streetBetTotal, totalPot } from '../poker/pot'
import { positionLabels } from '../poker/position'
import { cardToString } from '../poker/card'
import { estimateHandOdds } from '../poker/equity'
import { Seat } from './Seat'
import { HeroBar } from './HeroBar'
import { PotDisplay } from './PotDisplay'
import { HandOddsPanel } from './HandOddsPanel'
import { Controls, PreActionBar, SpectatingBar, WaitingBar, RevealGate } from './Controls'
import { HandFeed } from './HandFeed'
import { TableHud } from './TableHud'
import type { PreAction, Speed } from './useHoldemGame'

interface TableProps {
  state: GameState
  humanIds: string[]
  isSolo: boolean
  activeHumanId: string | null
  isHumanTurn: boolean
  needsReveal: boolean
  onRevealCurrentPlayer: () => void
  waitingOn: string | null
  dealingStreet: string | null
  session: { handsPlayed: number; netByPlayer: Record<string, number> }
  speed: Speed
  onSpeed: (speed: Speed) => void
  paused: boolean
  onSetPaused: (paused: boolean) => void
  onStep: () => void
  onSkipToEnd: () => void
  isSpectating: boolean
  autoNextHand: boolean
  onSetAutoNextHand: (value: boolean) => void
  preAction: PreAction | null
  onSetPreAction: (value: PreAction | null) => void
  onAction: (type: ActionType, amount?: number) => void
  onNextHand: () => void
  onExit: () => void
  showHandOdds: boolean
}

const STREET_BANNER: Record<string, string> = {
  flop: 'Flop',
  turn: 'Turn',
  river: 'River',
}

/**
 * What this player did on the CURRENT street. Scanning the whole hand instead
 * — as this used to — leaves a preflop "Raise $30" pinned to a seat while the
 * turn is being bet, which is worse than showing nothing.
 */
function lastActionThisStreet(log: HandLogEntry[], playerId: string, street: string): string | undefined {
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i]
    if (entry.street !== street) break
    if (entry.kind !== 'action' || entry.playerId !== playerId) continue
    switch (entry.actionType) {
      case 'fold':
        return 'Folded'
      case 'check':
        return 'Check'
      case 'call':
        return `Call $${entry.amount?.toLocaleString()}`
      case 'bet':
        return `Bet $${entry.toAmount?.toLocaleString()}`
      case 'raise':
        return `Raise $${entry.toAmount?.toLocaleString()}`
      case 'all-in':
        return 'All-in'
    }
  }
  return undefined
}

export function Table({
  state,
  humanIds,
  isSolo,
  activeHumanId,
  isHumanTurn,
  needsReveal,
  onRevealCurrentPlayer,
  waitingOn,
  dealingStreet,
  session,
  speed,
  onSpeed,
  paused,
  onSetPaused,
  onStep,
  onSkipToEnd,
  isSpectating,
  autoNextHand,
  onSetAutoNextHand,
  preAction,
  onSetPreAction,
  onAction,
  onNextHand,
  onExit,
  showHandOdds,
}: TableProps) {
  const activePlayer = state.players.find((p) => p.id === activeHumanId)
  const currentPlayer = state.handInProgress ? state.players[state.currentPlayerIndex] : undefined
  const positions = positionLabels(state)
  const dealerId = state.players[state.dealerIndex]?.id
  // Every seat renders in the opponent strip except whichever human is
  // currently revealed — that one gets the fixed hero zone at the bottom,
  // large cards and all, regardless of where they'd sit around a real table.
  // In pass-and-play, between two humans' turns nobody is revealed, so
  // everyone (humans included) shows up as a plain opponent tile.
  const opponents = state.players.filter((p) => p.id !== activeHumanId)

  // The hand log is opt-in — most players only want the table itself in
  // front of them, not a running transcript, so it starts closed.
  const [showLog, setShowLog] = useState(false)

  // Keyed by the actual cards rather than object identity — the GameState
  // reference changes on every action (including opponents' actions that
  // don't touch the hero's cards or the board at all), which would
  // otherwise re-run the flop/turn enumeration far more than the cards
  // it depends on actually change.
  const holeKey = activePlayer?.holeCards.map(cardToString).join('') ?? ''
  const boardKey = state.communityCards.map(cardToString).join('')
  const handOdds = useMemo(() => {
    if (!showHandOdds || !activePlayer || activePlayer.holeCards.length < 2) return null
    return estimateHandOdds(activePlayer.holeCards, state.communityCards)
    // Deliberately keyed on the derived card strings, not on activePlayer/
    // state.communityCards themselves — see the comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHandOdds, holeKey, boardKey])

  // At showdown the engine has already swept the bets into `pots`; before that
  // the middle holds only what earlier streets contributed.
  const settled = state.pots.length > 0
  const middlePot = settled ? state.pots.reduce((s, p) => s + p.amount, 0) : committedPot(state.players)
  const inPlay = settled ? 0 : streetBetTotal(state.players)
  const potForSizing = totalPot(state.players)

  const heroLegalActions =
    activePlayer && isHumanTurn ? getLegalActions(state, activePlayer.id) : []
  const revealAll = state.street === 'showdown'
  const lastResult = !state.handInProgress && state.lastResults.length > 0 ? state.lastResults : null
  const winnerIds = new Set(lastResult?.flatMap((r) => r.winnerIds) ?? [])

  const soleNet = isSolo && humanIds[0] !== undefined ? (session.netByPlayer[humanIds[0]] ?? 0) : null

  const handleExit = () => {
    if (state.handInProgress && !window.confirm('Leave the table? The hand in progress will be forfeited.')) {
      return
    }
    onExit()
  }

  // Space deals the next hand; P pauses; S single-steps.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return

      if (event.key === ' ' && lastResult) {
        event.preventDefault()
        onNextHand()
      } else if (event.key.toLowerCase() === 'p') {
        onSetPaused(!paused)
      } else if (event.key.toLowerCase() === 's' && paused) {
        onStep()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lastResult, onNextHand, onSetPaused, onStep, paused])

  return (
    <div className="table-scene">
      <TableHud
        handNumber={state.handNumber}
        smallBlind={state.config.smallBlind}
        bigBlind={state.config.bigBlind}
        street={state.street}
        handsPlayed={session.handsPlayed}
        net={soleNet}
        speed={speed}
        onSpeed={onSpeed}
        paused={paused}
        onTogglePause={() => onSetPaused(!paused)}
        onStep={onStep}
        autoNextHand={autoNextHand}
        onToggleAutoNextHand={() => onSetAutoNextHand(!autoNextHand)}
        showLog={showLog}
        onToggleLog={() => setShowLog((v) => !v)}
        onExit={handleExit}
      />

      <div className="table-body">
        <div className="table-main">
          <div className="board-scene">
            <div className="opponent-strip">
              {opponents.map((player) => (
                <Seat
                  key={player.id}
                  name={player.name}
                  stack={player.stack}
                  betThisStreet={player.betThisStreet}
                  folded={player.folded}
                  isAllIn={player.isAllIn}
                  isEliminated={player.isEliminated}
                  isDealer={player.id === dealerId}
                  isCurrentTurn={state.handInProgress && player.id === currentPlayer?.id && !paused}
                  isWinner={winnerIds.has(player.id)}
                  position={positions.get(player.id)}
                  lastAction={lastActionThisStreet(state.handLog, player.id, state.street)}
                  cards={revealAll ? player.holeCards : []}
                  revealCards={revealAll && !player.folded}
                />
              ))}
            </div>

            <PotDisplay potSize={middlePot} inPlay={inPlay} communityCards={state.communityCards} />

            {handOdds && <HandOddsPanel odds={handOdds} />}

            {dealingStreet && STREET_BANNER[dealingStreet] && (
              <div className="street-banner" key={dealingStreet}>
                {STREET_BANNER[dealingStreet]}
              </div>
            )}

            {paused && <div className="paused-badge">Paused — S to step, P to resume</div>}
          </div>

          {activePlayer &&
            (() => {
              const heroToCall = Math.max(state.currentBet - activePlayer.betThisStreet, 0)
              return (
                <HeroBar
                  name={activePlayer.name}
                  stack={activePlayer.stack}
                  cards={activePlayer.holeCards}
                  position={positions.get(activePlayer.id)}
                  isDealer={activePlayer.id === dealerId}
                  toCall={heroToCall}
                  potOdds={heroToCall > 0 ? heroToCall / (potForSizing + heroToCall) : null}
                  folded={activePlayer.folded}
                  isAllIn={activePlayer.isAllIn}
                />
              )
            })()}

          {lastResult && (
            <div className="hand-result-banner">
              {lastResult.map((r, i) => (
                <div key={i} className="hand-result-line">
                  {r.winnerIds.map((id) => state.players.find((p) => p.id === id)?.name).join(' & ')} won $
                  {r.potAmount.toLocaleString()}
                  {r.category ? ` with ${r.category.replace(/-/g, ' ')}` : ''}
                </div>
              ))}
              <button className="btn btn-next-hand" onClick={onNextHand}>
                Next hand <kbd>Space</kbd>
              </button>
            </div>
          )}

          {isHumanTurn && activePlayer ? (
            <Controls
              legalActions={heroLegalActions}
              toCall={state.currentBet - activePlayer.betThisStreet}
              minRaiseTo={minRaiseTargetAmount(state)}
              maxRaiseTo={maxRaiseTargetAmount(state, activePlayer.id)}
              potSize={potForSizing}
              onAction={onAction}
            />
          ) : needsReveal && currentPlayer ? (
            <RevealGate playerName={currentPlayer.name} onReveal={onRevealCurrentPlayer} />
          ) : isSpectating ? (
            <SpectatingBar
              message={
                isSolo
                  ? `You${activePlayer?.isAllIn ? "'re all-in" : ' folded'} — the hand plays on…`
                  : 'No more decisions for your table — the hand plays on…'
              }
              onSkip={onSkipToEnd}
            />
          ) : isSolo && state.handInProgress ? (
            <PreActionBar
              toCall={activePlayer ? state.currentBet - activePlayer.betThisStreet : 0}
              value={preAction}
              onChange={onSetPreAction}
              waitingOn={waitingOn}
              dealing={dealingStreet !== null}
            />
          ) : state.handInProgress ? (
            <WaitingBar label={currentPlayer ? `${currentPlayer.name} is deciding…` : 'Waiting…'} />
          ) : null}
        </div>

        {showLog && <HandFeed log={state.handLog} activeId={activeHumanId} />}
      </div>
    </div>
  )
}
