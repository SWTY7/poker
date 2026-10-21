import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CityRow, TourHub } from '../../src/ui/TourHub'
import { TournamentResults } from '../../src/ui/TournamentResults'
import { CITIES, newTour, prizesFor, recordTourResult, tourStatus } from '../../src/game/tour'

const noop = () => undefined
const money = (n: number) => `$${n.toLocaleString('en-US')}`

function hub(bankroll: number, tour = newTour(), onPlay: (id: string) => void = noop): string {
  return renderToString(<TourHub tour={tour} bankroll={bankroll} onPlay={onPlay} onBack={noop} />)
}

/** The markup of one city's row. */
function row(html: string, id: string): string {
  const start = html.lastIndexOf('<li', html.indexOf(`data-city="${id}"`))
  const end = html.indexOf('</li>', start)
  return html.slice(start, end)
}

describe('TourHub', () => {
  it('lists every city with its room, country, buy-in and top-3 prizes', () => {
    const html = hub(1_000)
    for (const city of CITIES) {
      const r = row(html, city.id)
      expect(r).toContain(city.city)
      expect(r).toContain(city.room)
      expect(r).toContain(city.country)
      expect(r).toContain(money(city.buyIn))
      const [a, b, c] = prizesFor(city)
      expect(r).toContain(money(a))
      expect(r).toContain(money(b))
      expect(r).toContain(money(c))
    }
  })

  it('shows the bankroll and the total tour winnings', () => {
    const tour = recordTourResult(newTour(), 'lisbon', 1)
    const html = hub(1_234, tour)
    expect(html).toContain('Bankroll $1,234')
    expect(html).toContain(`Won on tour ${money(tour.winnings)}`)
  })

  it('opens only the first city on a new tour and says what unlocks the rest', () => {
    const html = hub(50_000)
    expect(row(html, 'lisbon')).toContain('tour-play')
    expect(row(html, 'lisbon')).not.toContain('tour-reason')
    const prague = row(html, 'prague')
    expect(prague).not.toContain('tour-play')
    expect(prague).toContain('Finish in the top 3 in Lisbon to unlock')
    expect(prague).toContain('tour-row-locked')
  })

  it('opens the next city after a top-3 finish, but not after 4th', () => {
    expect(row(hub(50_000, recordTourResult(newTour(), 'lisbon', 3)), 'prague')).toContain('tour-play')
    expect(row(hub(50_000, recordTourResult(newTour(), 'lisbon', 4)), 'prague')).not.toContain('tour-play')
  })

  it('says how short the bankroll is when a city is open but too dear', () => {
    const tour = recordTourResult(newTour(), 'lisbon', 2)
    const prague = row(hub(100, tour), 'prague')
    expect(prague).not.toContain('tour-play')
    expect(prague).toContain('Needs a $250 bankroll ($150 short)')
    expect(prague).toContain('tour-row-short')
  })

  it('shows your best finish and wins per city', () => {
    let tour = recordTourResult(newTour(), 'lisbon', 1)
    tour = recordTourResult(tour, 'lisbon', 3)
    expect(row(hub(1_000, tour), 'lisbon')).toContain('Best 1st · 1 win')
    expect(row(hub(1_000), 'lisbon')).toContain('Not played yet')
  })

  it('wires Play to the city id (and only for playable rows)', () => {
    const onPlay = vi.fn()
    const statuses = tourStatus(newTour(), 50_000)
    const find = (node: unknown, out: { onClick?: () => void }[] = []) => {
      if (!node || typeof node !== 'object') return out
      const n = node as { type?: unknown; props?: { children?: unknown; onClick?: () => void } }
      if (n.type === 'button') out.push(n.props ?? {})
      for (const child of [n.props?.children].flat()) find(child, out)
      return out
    }
    const playable = statuses[0]
    const buttons = find(CityRow({ status: playable, tour: newTour(), onPlay }))
    expect(buttons).toHaveLength(1)
    buttons[0].onClick?.()
    expect(onPlay).toHaveBeenCalledWith('lisbon')
    expect(find(CityRow({ status: statuses[1], tour: newTour(), onPlay }))).toHaveLength(0)
  })
})

describe('TournamentResults (tour)', () => {
  it('prints the top-3 payout line and the city', () => {
    const city = CITIES[0]
    const purse = prizesFor(city).reduce((a, b) => a + b, 0)
    const html = renderToString(
      <TournamentResults
        outcome={{
          standings: [{ playerId: 'p0', position: 2 }],
          names: { p0: 'You' },
          humanId: 'p0',
          fieldSize: 6,
          prizePool: purse,
          buyIn: city.buyIn,
          city: city.city,
          forfeited: true,
        }}
        onBackToLobby={noop}
        backLabel="Back to the World Tour"
      />,
    )
    const [a, b, c] = prizesFor(city)
    expect(html).toContain('Top 3 paid')
    expect(html).toContain(`1st ${money(a)}`)
    expect(html).toContain(`2nd ${money(b)}`)
    expect(html).toContain(`3rd ${money(c)}`)
    expect(html).toContain('Back to the World Tour')
  })
})
