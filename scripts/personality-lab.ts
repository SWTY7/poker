import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { firstAnswer, type Fundamentals } from '../src/ai/psychology/psych-bot'
import { MultiwayPreflopBook } from '../src/gto/holdem/preflop-multiway-bot'
import type { MultiwayStrategyFile } from '../src/gto/holdem/preflop-multiway'
import { BlueprintSetBot } from '../src/gto/holdem/blueprint-set'
import type { BlueprintFile } from '../src/gto/holdem/blueprint'
import { createRng } from '../src/utils/random'
import { runSession } from '../src/lab/session'
import { featuresOf } from '../src/lab/features'
import { PARAMS } from '../src/lab/draw'
import { fitNearestNeighbours, fitRidge, score, splitByTable, type Row } from '../src/lab/recover'

/**
 * Phase 3a of docs/plans/psychology-lab.md: can a bot's drawn character be
 * recovered from its play alone?
 *
 *   npm run lab -- generate <firstTable> <tables> [hands=500] [dir=lab-data]
 *   npm run lab -- analyze [dir=lab-data]
 *
 * `generate` is the slow part (about a minute a table at 500 hands), so run
 * several in parallel on different table ranges. Each table is seeded by its
 * number, so the same range always gives the same seats. It writes one file
 * per table holding every seat's answer key and its statistics at 50, 100,
 * 200 and 500 hands. `analyze` reads them all.
 */

/** Hands each seat has played when its statistics are taken. */
const CHECKPOINTS = [50, 100, 200, 500]

/** What the app's bots play with: the preflop book first, then the heads-up blueprints. */
function loadFundamentals(): Fundamentals {
  const files = [10, 20, 40, 75].map(
    (depth) => JSON.parse(readFileSync(`src/gto/holdem/blueprint-${depth}.json`, 'utf-8')) as BlueprintFile,
  )
  const solve = new BlueprintSetBot(files, { rng: createRng(1) })
  const preflop = readdirSync('src/gto/holdem')
    .filter((name) => /^preflop-\dmax-\d+\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(`src/gto/holdem/${name}`, 'utf-8')) as MultiwayStrategyFile)
  return firstAnswer(new MultiwayPreflopBook(preflop), solve)
}

interface TableFile {
  table: number
  seats: Array<{ truth: Row['truth']; at: Record<string, Row['features']> }>
}

function generate(args: string[]): void {
  const first = Number(args[0] ?? 0)
  const tables = Number(args[1] ?? 1)
  const hands = Number(args[2] ?? 500)
  const dir = args[3] ?? 'lab-data'
  mkdirSync(dir, { recursive: true })
  const fundamentals = loadFundamentals()
  for (let table = first; table < first + tables; table++) {
    const started = Date.now()
    const runs = runSession({ hands, seed: 1000 + table, fundamentals })
    const file: TableFile = {
      table,
      seats: runs.map((run) => ({
        truth: run.truth,
        at: Object.fromEntries(
          CHECKPOINTS.filter((n) => n <= hands).map((n) => [String(n), featuresOf(run.hands.slice(0, n))]),
        ),
      })),
    }
    writeFileSync(`${dir}/table-${String(table).padStart(4, '0')}.json`, JSON.stringify(file))
    console.log(`table ${table}: ${hands} hands in ${((Date.now() - started) / 1000).toFixed(0)}s`)
  }
}

function analyze(args: string[]): void {
  const dir = args[0] ?? 'lab-data'
  const files = readdirSync(dir)
    .filter((name) => /^table-\d+\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(`${dir}/${name}`, 'utf-8')) as TableFile)
  console.log(`${files.length} tables, ${files.length * (files[0]?.seats.length ?? 0)} seats`)

  const methods = [
    { name: 'ridge', fit: fitRidge },
    { name: 'nearest-neighbour', fit: (rows: Row[]) => fitNearestNeighbours(rows) },
  ]
  for (const method of methods) {
    console.log(`\n${method.name}: held-out correlation r (and R², the share of variance explained) by hands played`)
    const header = ['parameter'.padEnd(36), ...CHECKPOINTS.map((n) => String(n).padStart(14))].join('')
    console.log(header)
    const byN = CHECKPOINTS.map((n) => {
      const rows: Row[] = files.flatMap((f) => f.seats.map((seat) => ({ table: f.table, truth: seat.truth, features: seat.at[String(n)] })))
        .filter((row) => row.features)
      if (rows.length < 40) return null
      const { train, test } = splitByTable(rows)
      return score(method.fit(train), test)
    })
    for (const [i, spec] of PARAMS.entries()) {
      const cells = byN.map((scores) => (scores ? `${scores[i].r.toFixed(2)} (${scores[i].r2.toFixed(2)})` : 'n/a').padStart(14))
      console.log(`${spec.key.padEnd(20)}${spec.label.slice(0, 15).padEnd(16)}${cells.join('')}`)
    }
  }
}

export default function main(args: string[]): void {
  const [command, ...rest] = args
  if (command === 'generate') return generate(rest)
  if (command === 'analyze') return analyze(rest)
  console.error('usage: npm run lab -- generate <firstTable> <tables> [hands] [dir] | analyze [dir]')
  process.exit(1)
}
