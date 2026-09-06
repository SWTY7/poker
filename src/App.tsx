import './App.css'
import { useState } from 'react'
import { MenuScreen } from './ui/MenuScreen'
import { Table } from './ui/Table'
import { useHoldemGame } from './ui/useHoldemGame'
import type { GameConfigOptions } from './ui/useHoldemGame'

interface GameScreenProps {
  config: GameConfigOptions
  onExit: () => void
}

function GameScreen({ config, onExit }: GameScreenProps) {
  const game = useHoldemGame(config)

  if (!game.state) {
    return <div className="app-placeholder">Loading…</div>
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
      isSpectating={game.isSpectating}
      autoNextHand={game.autoNextHand}
      onSetAutoNextHand={game.setAutoNextHand}
      preAction={game.preAction}
      onSetPreAction={game.setPreAction}
      onAction={game.humanAct}
      onNextHand={game.startHand}
      onExit={onExit}
      showHandOdds={config.showHandOdds}
    />
  )
}

function App() {
  const [config, setConfig] = useState<GameConfigOptions | null>(null)

  if (!config) {
    return <MenuScreen onStart={setConfig} />
  }

  return <GameScreen config={config} onExit={() => setConfig(null)} />
}

export default App
