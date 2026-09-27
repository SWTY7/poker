# Multiway preflop: a solved book for three to six players

*Design and verification record (2026-09-27). Code: `src/gto/holdem/preflop-multiway.ts` (game, trainer,
checks), `src/gto/holdem/preflop-multiway-bot.ts` (lookup at a real table), `scripts/train-preflop-multiway.ts`
(`npm run train:preflop`). Trained files: `src/gto/holdem/preflop-{3..6}max-{8,20,40,100}.json`.*

## Why only preflop, and why it's allowed at all

The heads-up blueprint is a real equilibrium: two players, zero-sum, and CFR provably converges to it.
With three or more players neither holds. There can be many equilibria, and CFR has no convergence proof.
It is still what the strongest multiway programs do. Pluribus, which beat professionals at six-handed
no-limit, trained its whole blueprint with the same algorithm used here (Monte Carlo CFR, external
sampling). In practice it converges to strategies nobody could exploit. Preflop is where this works best:
the game is small enough to cover every seat, every action and all 169 hand classes, and we can *measure*
how far the result is from equilibrium (below) instead of trusting it.

Postflop multiway is not attempted. That tree is vastly larger, and there the measurement stops being
affordable.

## The game

Per table size (3–6) and stack depth (8, 20, 40, 100 big blinds; everyone equally deep):

- Seats act in the real preflop order with the blinds posted.
- **First in:** fold, raise (2.5bb; 3bb from the small blind), or all in. No limping, the same convention
  preflop charts use.
- **Facing a raise:** fold, call, re-raise, or all in. A 3-bet goes to 3× (4× from the blinds, out of
  position) plus one raise per caller. A 4-bet goes to 2.3×. After that, all in is the only raise. Any raise
  that would commit more than 45% of the stack is played as all in.
- **Cold calls are capped:** only one player may flat-call a raise with nothing but a blind in, plus the big
  blind closing the action. Without the cap, a six-handed 100bb tree has ~35,000 decisions, almost all of
  them lines like "open, three cold calls, squeeze". With it: 10,345, and every common multiway pot (open,
  one caller, big blind defends) is still there.

**How a hand ends decides what it's worth:**

- Everyone else folds: the pot.
- All in and called: the pot split by all-in equity. With two players, that's the exact precomputed
  class-vs-class equity. With more, it's the actual cards on a board dealt for that iteration (an unbiased
  sample of the same thing).
- Called with chips behind, so a flop gets played: **realized equity**, the one modelled part. Each player
  keeps their showdown share scaled by `math/realization.ts`'s factor for their seat and hand type (capped
  at 1). What out-of-position hands fail to keep goes to the players behind them, weighted toward the
  button. This is where the solve is only as good as those factors. Two consequences follow. Position is
  worth something. But implied odds after the flop are mostly invisible (the cap), so small pairs and
  suited connectors come out tighter than in charts built from full postflop solves.

## Training

External-sampling MCCFR for N players, with linear averaging. Each iteration deals real cards and a board.
Every seat takes a turn as the traverser: at the traverser's own decisions every action is explored; at
everyone else's, one action is sampled from their current strategy. Regrets and the average strategy live
in one flat array per decision (169 classes × actions). 10 million iterations take between 23 seconds
(3-handed, 8bb) and 106 seconds (6-handed, 100bb) on one core.

**Shipping:** only decisions reached at least once in 2,000 hands are kept. Within them, a class's row is
kept only if that class got there often enough to trust (about 100+ visits). Everything else is `.`, and a
bot meeting it decides without the book. Each probability is one base-62 character (under 2% resolution).
Together the sixteen files are about 1 MB.

## Verification

1. **It reproduces a known solution.** With two players at 6bb, no raise but all in fits, so the game *is*
   heads-up push/fold, which `pushfold-solver.ts` solves exactly by a different method. The multiway trainer
   matches it: shove and call widths within 2 points; hand-by-hand disagreements only on hands within
   0.15bb of indifferent (test: `tests/gto/preflop-multiway.test.ts`).
2. **Distance from equilibrium, measured.** For each seat, a sampled best response against everyone else's
   average strategy. The sum over seats (NashConv) is zero exactly at an equilibrium. The estimate can only
   read high: it takes a max over noisy values, and it shrinks as samples grow.

   | table | NashConv upper bound (bb/hand) |
   |---|---|
   | 3-handed 8bb | ≤ 0.021 |
   | 4-handed 8bb | ≤ 0.052 |
   | 3-handed 20bb | ≤ 0.052 |
   | 3-handed 40bb | ≤ 0.093 |
   | 3-handed 100bb | ≤ 0.181 |
   | 4-handed 20bb | ≤ 0.110 |
   | 4-handed 40bb | ≤ 0.249 |
   | 4-handed 100bb | ≤ 0.551 at 200k samples, **≤ 0.194 at 800k** |

   For scale: random play gives away ~5 bb/hand. At 4-handed 100bb, training **four times longer** (40M
   iterations) left the 200k-sample estimate where it was (0.51 vs 0.55), while quadrupling the samples cut
   it to 0.19. What remains is mostly the estimator's own noise, not unconverged play. Five- and
   six-handed tables are too big to check this way in reasonable time. They get the same iteration count,
   which by then has settled the smaller tables.
3. **It looks like a chart.** Six-handed at 100bb, the open width rises from under the gun to the button.
   Aces always open, seven-deuce never does (tests check both for every file).

## At the table

`MultiwayPreflopBook.strategyFor` replays the hand so far through the tree. A fold is `f`; a call is `c`; a
raise is the tree's raise whatever its exact size, or all in if it put in 60%+ of the stack. The spot is
found only if every step exists in the tree. A limp, a check, or an unshipped line means no answer, and the
bot decides on instinct. Depth picks the nearest trained stack within a factor of two, so 100bb covers
50–200bb and 8bb covers the short-stack end down to 4bb. At 8bb only one raise fits before all in, so
that file is close to a push/fold chart. Answers come back as real actions: a raise sized by the tree's rule applied to the real pot, and
all in as a raise to everything.

In the app, bots are handed `firstAnswer(book, headsUpBlueprints)`: the book before the flop with three or
more dealt in, the heads-up blueprints once it's down to two, and nothing (pure instinct) anywhere else. How
much each bot leans on the answer is its `discipline`, exactly as with the heads-up blueprint
(`docs/combined-bot.md`).

## Known limits

- **Equal stacks.** The tree assumes everyone is equally deep. At a real table the effective depth (hero
  against the deepest opponent still in) picks the file, which is the standard approximation.
- **No limping, and one cold caller.** Real pots that leave the tree get no book.
- **Realization, not postflop play.** See above. Speculative hands are undervalued because of it.
- **Antes are ignored.** Tournament levels with antes play the no-ante solve.
