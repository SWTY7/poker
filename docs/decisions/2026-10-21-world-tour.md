# World Tour replaces Career seasons (2026-10-21)

Status: accepted (sunwoo's direction: "career like Apple's Texas Hold'em").

## Decision
Career = Cash game + World Tour. The Local/Regional/National/Championship season system, its points and `poker.career` save are removed. The tour is nine casino cities (made-up rooms), each one six-handed tournament with its own buy-in. The top three are paid 50/30/20 of a purse. Model: `src/game/tour.ts`; save: `poker.tour`.

## Why the numbers are what they are
Cash scale: stacks $100 to $5,000, default $1,000 at $5/$10, bankroll starts at $1,000, and doubling $1,000 in cash is easy. A tour prize that does not beat that is not worth the trip, so:

- Buy-ins climb the cash ladder: $100, 250, 500, 1,000, 2,000, 3,500, 5,000, 7,500, 10,000.
- Purse = buy-in x 6 x overlay, rounded to $50. The overlay (the room's guarantee) falls from 1.6 to 1.35 as cities get harder.
- A seat finishing by pure chance (1/6 per place) expects purse/6 = buy-in x overlay, so ROI at chance = overlay - 1 (about), always positive.
- 1st pays 3 x overlay x buy-in, at least 4.05x everywhere (test: >= 4x). 3rd pays 1.2 x overlay (at least 1.6x; test: 3rd >= one buy-in), so the money is a real top 3, not just 1st.

| City | Buy-in | Purse | 1st / 2nd / 3rd | ROI at chance |
|---|---|---|---|---|
| Lisbon | $100 | $950 | 475 / 285 / 190 | +58.3% |
| Prague | $250 | $2,350 | 1,175 / 705 / 470 | +56.7% |
| Cape Town | $500 | $4,500 | 2,250 / 1,350 / 900 | +50.0% |
| Buenos Aires | $1,000 | $9,000 | 4,500 / 2,700 / 1,800 | +50.0% |
| Macau | $2,000 | $17,400 | 8,700 / 5,220 / 3,480 | +45.0% |
| Monte Carlo | $3,500 | $29,400 | 14,700 / 8,820 / 5,880 | +40.0% |
| Singapore | $5,000 | $42,000 | 21,000 / 12,600 / 8,400 | +40.0% |
| Las Vegas | $7,500 | $60,750 | 30,375 / 18,225 / 12,150 | +35.0% |
| Sydney | $10,000 | $81,000 | 40,500 / 24,300 / 16,200 | +35.0% |

ROI at chance is pinned per city in `tests/game/tour.test.ts`.

The overlay falls with the city because the rivals get stronger (discipline +0 to +0.4, reasoning level +0 to +2 on top of each rival's own profile), so a real player's chance of a top 3 falls from the top of the ladder down; the premium for sitting down shrinks, but never below +35% at chance.

## Tour versus cash
Reasoned, not simulated (unverified: no bot-vs-bot tool in the repo was run for this). A tour table is roughly 60 to 120 hands (Sit & Go to Deep Stack, unverified). A cash player with a strong win rate of about 10 big blinds per 100 hands makes about +10 bb in that time, or +10% of a 100 bb buy-in. The tour's ROI at chance is +35% to +58% per table before any skill, so it beats even strong cash play per hour, at the cost of variance: finishing 4th to 6th loses the whole buy-in (50% of finishes at chance). Expected value is generous on purpose; the bankroll swing is the price. A skilled player's top-3 rate is higher than 1/2, so skill adds to the margin. If it later proves too generous, lower the overlay constants in `CITIES`; nothing else depends on them. A test (`beat a break-even cash session`) asserts only the +10% arithmetic floor.

## Unlock rule
A city opens when you have finished top 3 in the city before it (once earned it stays open). You can sit down when it is open and the bankroll covers the buy-in. Chosen over "bankroll alone" (a lucky cash run would skip the ladder) and "top 3 alone" (you could sit down broke, and the buy-in would fail). `tourStatus` returns a reason string for each state.

## Payout shape
`tournament.ts` pays a six-player field 50/30/20 (3 places); fields of 3 to 5 stay at 65/35, 7 to 9 at 50/30/20 and 10+ unchanged. This changes the bubble too (4 left of 6). Any other six-player tournament gets the new shape as well (unverified whether home games use one).

## Saved data
`poker.tour` v1: per city `plays`, `best`, `wins`, `top3`; `winnings` (gross prizes), `net` (prizes minus buy-ins), `last` result. `migrateTour` validates everything and drops unknown cities; `loadTour` deletes `poker.career` (not converted).
