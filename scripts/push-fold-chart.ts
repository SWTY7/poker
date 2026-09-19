import { classFromLabel } from '../src/math/combos'
import { rangeWidth } from '../src/gto/holdem/preflop'
import { solvePushFold } from '../src/gto/holdem/pushfold-solver'

/**
 * Prints the solved heads-up push/fold chart for a stack depth, in the 13x13
 * grid every chart uses: pairs down the diagonal, suited above it, offsuit
 * below.
 *
 *   node scripts/run.mjs scripts/push-fold-chart.ts 10
 */

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']

export default function main(args: string[]): void {
  const stack = Number(args[0] ?? 10)
  const solution = solvePushFold(stack)

  console.log(`\nHeads-up push/fold at ${stack}bb`)
  console.log(`  small blind shoves ${(rangeWidth(solution.shove) * 100).toFixed(1)}% of hands`)
  console.log(`  big blind calls    ${(rangeWidth(solution.call) * 100).toFixed(1)}%`)
  console.log(`  worth ${solution.value >= 0 ? '+' : ''}${solution.value.toFixed(3)} bb/hand to the small blind\n`)

  grid('SMALL BLIND — shove', solution.shove)
  grid('BIG BLIND — call a shove', solution.call)
  console.log('  # always   + usually   . sometimes   · rarely   (blank) never\n')
}

function grid(title: string, frequencies: number[]): void {
  console.log(`  ${title}`)
  console.log('     ' + RANKS.map((rank) => rank.padStart(2)).join(''))
  for (let high = 0; high < RANKS.length; high++) {
    let row = '   ' + RANKS[high] + ' '
    for (let low = 0; low < RANKS.length; low++) {
      row += symbol(frequencies[classFromLabel(label(high, low))]).padStart(2)
    }
    console.log(row)
  }
  console.log('')
}

function label(row: number, column: number): string {
  if (row === column) return RANKS[row] + RANKS[row]
  // Above the diagonal is suited, below it offsuit — the usual convention.
  return row < column ? RANKS[row] + RANKS[column] + 's' : RANKS[column] + RANKS[row] + 'o'
}

function symbol(frequency: number): string {
  if (frequency >= 0.95) return '#'
  if (frequency >= 0.7) return '+'
  if (frequency >= 0.3) return '.'
  if (frequency > 0.02) return '·'
  return ' '
}
