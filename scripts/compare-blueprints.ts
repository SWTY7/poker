import { readFileSync } from 'node:fs'
import { HoldemEngine } from '../src/poker/game-engine'
import { buildObservation } from '../src/ai/observation'
import type { Agent } from '../src/ai/agent'
import { HeuristicBot } from '../src/ai/heuristic-bot'
import { PsychBot } from '../src/ai/psychology/psych-bot'
import { AVERAGE_HUMAN } from '../src/ai/psychology/profile'
import { BlueprintBot } from '../src/gto/holdem/blueprint-bot'
import type { BlueprintFile } from '../src/gto/holdem/blueprint'
import { createRng } from '../src/utils/random'

/**
 * Phase 1, last step: does the texture blueprint actually play better than
 * the bucket blueprint already shipping, or did all that extra information-
 * set space buy nothing at the table? Same duplicate-scoring harness
 * tests/gto/blueprint-bot.test.ts uses to benchmark the shipped blueprint,
 * run here directly (not as a vitest test) so it can compare two blueprint
 * files by path instead of one fixed import.
 *
 *   npm run compare:blueprints -- <bucketFile> <textureFile> [pairs]
 */

const BIG_BLIND = 10

function playHand(a: Agent, b: Agent, stack: number, seed: number): number {
  const players = [
    { id: 'p0', name: 'P0', stack },
    { id: 'p1', name: 'P1', stack },
  ]
  const engine = new HoldemEngine(players, { smallBlind: BIG_BLIND / 2, bigBlind: BIG_BLIND, ante: 0 }, createRng(seed))
  const agents: Record<string, Agent> = { p0: a, p1: b }
  engine.startHand()
  let guard = 0
  while (engine.state.handInProgress) {
    if (guard++ > 400) throw new Error('hand never finished')
    const actor = engine.state.players[engine.state.currentPlayerIndex]
    engine.act(agents[actor.id].decideAction(buildObservation(engine, actor.id)))
  }
  return (engine.state.players[0].stack - stack) / BIG_BLIND
}

function duplicate(a: Agent, b: Agent, stack: number, pairs: number, base: number): { rate: number; error: number } {
  const results: number[] = []
  for (let i = 0; i < pairs; i++) {
    const seed = base * 1_000_003 + i
    results.push(playHand(a, b, stack, seed) - playHand(b, a, stack, seed))
  }
  const mean = results.reduce((sum, value) => sum + value, 0) / results.length
  const variance = results.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (results.length - 1)
  return { rate: (mean / 2) * 100, error: (Math.sqrt(variance / results.length) / 2) * 100 }
}

function report(label: string, result: { rate: number; error: number }): void {
  const sigma2 = result.rate - 2 * result.error
  const verdict = sigma2 > 0 ? 'ahead' : result.rate + 2 * result.error < 0 ? 'behind' : 'no clear edge'
  console.log(
    `  ${label}: ${result.rate >= 0 ? '+' : ''}${result.rate.toFixed(1)} +/- ${result.error.toFixed(1)} bb/100 (${verdict})`,
  )
}

export default function main(args: string[]): void {
  const bucketPath = args[0] ?? 'src/gto/holdem/blueprint-20.json'
  const texturePath = args[1] ?? 'src/gto/holdem/blueprint-texture-20.json'
  const pairs = Number(args[2] ?? 2_000)

  const bucketFile = JSON.parse(readFileSync(bucketPath, 'utf-8')) as BlueprintFile
  const textureFile = JSON.parse(readFileSync(texturePath, 'utf-8')) as BlueprintFile
  if (bucketFile.options.stack !== textureFile.options.stack) {
    throw new Error(`stack depths differ: bucket ${bucketFile.options.stack}bb vs texture ${textureFile.options.stack}bb`)
  }
  const stack = bucketFile.options.stack * BIG_BLIND

  const bucketBot = () => new BlueprintBot(bucketFile, { fallback: new HeuristicBot(createRng(9)), rng: createRng(9) })
  const textureBot = () => new BlueprintBot(textureFile, { fallback: new HeuristicBot(createRng(9)), rng: createRng(9) })

  console.log(`comparing ${bucketPath} (${Object.keys(bucketFile.strategy).length} keys) vs ` +
    `${texturePath} (${Object.keys(textureFile.strategy).length} keys), ${pairs} pairs at ${bucketFile.options.stack}bb\n`)

  const texture = textureBot()
  const versusBucket = duplicate(texture, bucketBot(), stack, pairs, 1)
  const versusHeuristic = duplicate(textureBot(), new HeuristicBot(createRng(2)), stack, pairs, 2)
  const versusPsych = duplicate(textureBot(), new PsychBot(AVERAGE_HUMAN, stack, createRng(3)), stack, pairs, 3)

  console.log('texture blueprint:')
  report('vs. bucket blueprint (head to head)', versusBucket)
  report('vs. heuristic bot', versusHeuristic)
  report('vs. psych bot (average human)', versusPsych)
  console.log(`  key lookups answered: ${texture.answered}/${texture.asked} (${((texture.answered / texture.asked) * 100).toFixed(1)}%)`)
}
