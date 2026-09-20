import './App.css'
import { useEffect, useRef, useState } from 'react'
import { MenuScreen } from './ui/MenuScreen'
import { Lobby } from './ui/Lobby'
import { TournamentSetup } from './ui/TournamentSetup'
import type { TournamentEntry } from './ui/TournamentSetup'
import { TournamentResults } from './ui/TournamentResults'
import type { TournamentOutcome } from './ui/TournamentResults'
import { Table } from './ui/Table'
import { useHoldemGame } from './ui/useHoldemGame'
import type { GameConfigOptions } from './ui/useHoldemGame'
import {
  applyBuyIn,
  canAffordBuyIn,
  claimDailyStake,
  defaultProfile,
  loadProfile,
  recordCashSession,
  recordTournamentResult,
  saveProfile,
  type Profile,
} from './game/profile'
import {
  blindLevel,
  isTournamentOver,
  prizeForPosition,
  tournamentHudInfo,
  tournamentStandings,
  type Standing,
  type TournamentStructure,
} from './game/tournament'

interface CashEntry {
  mode: 'cash'
  buyIn: number
}

interface TournamentGameEntry {
  mode: 'tournament'
  buyIn: number
  fieldSize: number
  structure: TournamentStructure
  prizePool: number
}

type GameEntry = CashEntry | TournamentGameEntry

type Screen =
  | { kind: 'lobby' }
  | { kind: 'cash-setup' }
  | { kind: 'tournament-setup' }
  | { kind: 'game'; config: GameConfigOptions; entry: GameEntry }
  | { kind: 'results'; outcome: TournamentOutcome }

interface TournamentExitPayload {
  standings: Standing[]
  names: Record<string, string>
  humanId: string
  /** True when the human quit rather than the tournament actually concluding — see LeaveDialog's note on what that does and doesn't tell you. */
  forfeited: boolean
  handsPlayed: number
  biggestPot: number
}

interface GameScreenProps {
  config: GameConfigOptions
  entry: GameEntry
  onCashExit: (finalStack: number, handsPlayed: number, biggestPot: number) => void
  onTournamentExit: (payload: TournamentExitPayload) => void
}

/**
 * Wraps the table with the one thing neither `useHoldemGame` nor `Table`
 * know anything about: what kind of session this is, and what "leaving"
 * means for it. A cash game's stack converts back to bankroll at face value;
 * a tournament's doesn't — a bust or a quit is the only outcome the profile
 * ever sees.
 */
function GameScreen({ config, entry, onCashExit, onTournamentExit }: GameScreenProps) {
  const game = useHoldemGame(config)
  const reportedRef = useRef(false)

  // A tournament ending on its own (down to one seat) has no button press to
  // hang the profile update on, so it's caught here instead: once a hand
  // finishes and only one player is left, that's the whole session.
  useEffect(() => {
    if (entry.mode !== 'tournament' || reportedRef.current) return
    if (!game.state || game.state.handInProgress) return
    if (!isTournamentOver(game.state)) return

    reportedRef.current = true
    const names = Object.fromEntries(game.state.players.map((p) => [p.id, p.name]))
    onTournamentExit({
      standings: tournamentStandings(game.state, entry.fieldSize),
      names,
      humanId: game.humanIds[0],
      forfeited: false,
      handsPlayed: game.session.handsPlayed,
      biggestPot: game.session.biggestPot,
    })
  }, [game.state, game.humanIds, game.session, entry, onTournamentExit])

  if (!game.state) {
    return <div className="app-placeholder">Loading…</div>
  }

  const tournamentHud =
    entry.mode === 'tournament' ? tournamentHudInfo(game.state, entry.structure, entry.fieldSize) : undefined

  const handleExit = () => {
    if (reportedRef.current) return
    const humanId = game.humanIds[0]
    const finalStack = game.state?.players.find((p) => p.id === humanId)?.stack ?? config.startingStack

    if (entry.mode === 'cash') {
      onCashExit(finalStack, game.session.handsPlayed, game.session.biggestPot)
      return
    }

    reportedRef.current = true
    // A voluntary quit only tells the app one thing for certain: how many
    // seats (including this one) were still alive the moment it happened.
    // That's the human's finish; the rest of the field's eventual order was
    // never played out, so this reports just the one row rather than
    // guessing at standings nobody simulated.
    const playersRemaining = game.state?.players.filter((p) => !p.isEliminated).length ?? entry.fieldSize
    const names = Object.fromEntries((game.state?.players ?? []).map((p) => [p.id, p.name]))
    onTournamentExit({
      standings: [{ playerId: humanId, position: playersRemaining }],
      names,
      humanId,
      forfeited: true,
      handsPlayed: game.session.handsPlayed,
      biggestPot: game.session.biggestPot,
    })
  }

  return (
    <Table
      state={game.state}
      humanIds={game.humanIds}
      isSolo={game.isSolo}
      activeHumanId={game.activeHumanId}
      isHumanTurn={game.isHumanTurn}
      needsReveal={game.needsReveal}
      onRevealCurrentPlayer={game.revealCurrentPlayer}
      waitingOn={game.waitingOn}
      dealingStreet={game.dealingStreet}
      session={game.session}
      speed={game.speed}
      onSpeed={game.setSpeed}
      paused={game.paused}
      onSetPaused={game.setPaused}
      onStep={game.step}
      onSkipToEnd={game.skipToEnd}
      onSkipToMyTurn={game.skipToMyTurn}
      isSpectating={game.isSpectating}
      autoNextHand={game.autoNextHand}
      onSetAutoNextHand={game.setAutoNextHand}
      onAction={game.humanAct}
      onNextHand={game.startHand}
      onExit={handleExit}
      showHandOdds={config.showHandOdds}
      startingStack={config.startingStack}
      canStartHand={game.canStartHand()}
      tournament={tournamentHud}
    />
  )
}

function App() {
  const [profile, setProfile] = useState<Profile>(() => loadProfile())
  const [screen, setScreen] = useState<Screen>({ kind: 'lobby' })

  // The bankroll is the one thing in this app that has to survive a closed
  // tab, so every change to it is written straight through rather than only
  // on the way out — a crash mid-session should lose at most the hand in
  // progress, not the last several buy-ins.
  useEffect(() => {
    saveProfile(profile)
  }, [profile])

  const goLobby = () => setScreen({ kind: 'lobby' })

  const handleStartCash = (config: GameConfigOptions) => {
    if (!canAffordBuyIn(profile.bankroll, config.startingStack)) return
    setProfile((p) => applyBuyIn(p, config.startingStack))
    setScreen({ kind: 'game', config, entry: { mode: 'cash', buyIn: config.startingStack } })
  }

  const handleRegisterTournament = (registration: TournamentEntry) => {
    if (!canAffordBuyIn(profile.bankroll, registration.buyIn)) return
    setProfile((p) => applyBuyIn(p, registration.buyIn))

    const opening = blindLevel(registration.structure, 1)
    const config: GameConfigOptions = {
      playerCount: registration.fieldSize,
      humanCount: 1,
      startingStack: registration.structure.startingStack,
      smallBlind: opening.smallBlind,
      bigBlind: opening.bigBlind,
      ante: opening.ante,
      showHandOdds: false,
      tournament: { structure: registration.structure },
    }
    setScreen({
      kind: 'game',
      config,
      entry: {
        mode: 'tournament',
        buyIn: registration.buyIn,
        fieldSize: registration.fieldSize,
        structure: registration.structure,
        prizePool: registration.buyIn * registration.fieldSize,
      },
    })
  }

  const handleCashExit = (finalStack: number, handsPlayed: number, biggestPot: number) => {
    if (screen.kind === 'game' && screen.entry.mode === 'cash') {
      const buyIn = screen.entry.buyIn
      setProfile((p) => recordCashSession(p, { buyIn, finalStack, handsPlayed, biggestPot }))
    }
    goLobby()
  }

  const handleTournamentExit = (payload: TournamentExitPayload) => {
    if (screen.kind !== 'game' || screen.entry.mode !== 'tournament') {
      goLobby()
      return
    }
    const entry = screen.entry
    const finish = payload.standings.find((s) => s.playerId === payload.humanId)?.position ?? entry.fieldSize
    // A quit pays exactly what that finish is worth, same as busting there
    // naturally would — real tournaments don't confiscate money you'd
    // already locked up just because you stopped playing it out. `forfeited`
    // only changes what the results screen says about the rest of the field.
    const prize = prizeForPosition(entry.prizePool, entry.fieldSize, finish)

    setProfile((p) =>
      recordTournamentResult(p, {
        buyIn: entry.buyIn,
        finish,
        field: entry.fieldSize,
        prize,
        handsPlayed: payload.handsPlayed,
        biggestPot: payload.biggestPot,
      }),
    )
    setScreen({
      kind: 'results',
      outcome: {
        standings: payload.standings,
        names: payload.names,
        humanId: payload.humanId,
        fieldSize: entry.fieldSize,
        prizePool: entry.prizePool,
        buyIn: entry.buyIn,
        forfeited: payload.forfeited,
      },
    })
  }

  switch (screen.kind) {
    case 'lobby':
      return (
        <Lobby
          profile={profile}
          onClaimDailyStake={() => setProfile((p) => claimDailyStake(p))}
          onResetProfile={() => setProfile(defaultProfile())}
          onChooseCash={() => setScreen({ kind: 'cash-setup' })}
          onChooseTournament={() => setScreen({ kind: 'tournament-setup' })}
        />
      )
    case 'cash-setup':
      return <MenuScreen bankroll={profile.bankroll} onBack={goLobby} onStart={handleStartCash} />
    case 'tournament-setup':
      return <TournamentSetup bankroll={profile.bankroll} onBack={goLobby} onRegister={handleRegisterTournament} />
    case 'game':
      return (
        <GameScreen config={screen.config} entry={screen.entry} onCashExit={handleCashExit} onTournamentExit={handleTournamentExit} />
      )
    case 'results':
      return <TournamentResults outcome={screen.outcome} onBackToLobby={goLobby} />
  }
}

export default App
