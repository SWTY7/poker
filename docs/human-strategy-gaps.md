# What human players do that these bots can't — and how each could be built

*Reference doc, not a plan. Nothing here is scoped or committed to. `docs/PROGRESS.md` says what's actually
built; `docs/combined-bot.md` covers how the table's one bot kind combines instinct with the solved strategy;
`docs/cfr-distillation-plan.md` covers the one gap (blockers) that already has measured investigation behind
it. Each suggestion below names the files it would touch and how to tell whether it worked, because a
change to a bot that isn't measured against `npm run benchmark:pro` is a guess.*

Every bot seat is a `PsychBot` (`src/ai/psychology/psych-bot.ts`), anchored to the CFR blueprint
(`src/gto/holdem/`) wherever a hand is heads-up at a trained depth. That's the baseline these gaps are measured
against.

## Already covered

Pot odds, position (per-seat opening widths via `math/realization.ts`), fold equity and bluff frequency
(level-k), multiway equity against several opponent ranges at once, board-texture-aware ranges, tilt, loss
aversion, a learned per-opponent aggression read, and — heads-up — the solved strategy as a studied default.

## The gaps, with suggestions

### 1. Implied odds (and reverse implied odds) — *basic, missing*

**What's wrong:** `psych-bot.ts` prices a call as if the hand checks down from here. A flush draw is worth
more than its current equity because it wins extra bets when it hits; a non-nut draw is worth *less* because
it sometimes hits and still loses a big pot.

**Suggestion:** give the `call` candidate a future-street branch instead of the current two outcomes.
`buckets.ts`'s `strengthOf` already separates E[HS] (average strength) from E[HS²] (how "swingy" the hand is)
— their gap is exactly how drawy a hand is. Estimate the chance the hand improves to the top of the range
from that gap, and the extra chips won when it does as *remaining stack × the opponent's believed calling
frequency × a typical bet size*. Reverse implied odds is the same branch with a loss: the share of "hits"
that are still beaten (a non-nut flush draw's hits against the nut flush). This can replace the
`shrinkTowardCoinFlip` discount, which is a stand-in for exactly this.

**Effort:** small. **Check:** multiway play (where no solve applies) should call draws wider at deep
stacks than shallow ones, and `benchmark:pro` shouldn't regress.

### 2. Multi-street plans — *basic, missing*

**What's wrong:** every decision is one street deep. No bot plans "call the flop, bluff the turn if a
scare card comes", or keeps firing because the line so far tells a strong story.

**Suggestion:** two steps, cheapest first.
- **One extra ply** (scoped in an earlier plan, never built): when pricing a bet, split "called" into
  "called and it goes to showdown" and "called, then raised back", with the raise-back probability from the
  same level-k defence numbers already computed. This is the fix `psych-bot.ts`'s own header asks for — it
  says the current shape "flatters aggression".
- **A per-hand plan:** a small `HandPlan` object on the bot, made when it first puts money in ("value",
  "semi-bluff with a flush draw", "float"), and consulted on later streets: a semi-bluff that picked up
  equity keeps betting, a float bets when checked to, a bluff gives up when the scare card doesn't come.
  Reset on `observeResult`. Heads-up, the solve already plays multi-street lines — this matters for
  multiway pots, where nothing else does.

**Effort:** small (ply), medium (plans). **Check:** the existing "neither a maniac nor a calling station"
aggression-ratio test, plus `benchmark:pro`.

### 3. Card removal / blockers — *advanced, missing where it counts*

**What's there already:** `multiwayEquity` deals opponent hands that can't use the hero's own cards, so
*showdown equity* already accounts for card removal.

**What's missing:** *fold equity* is one number from level-k, not a function of which hands the opponent
actually holds. So the bot can't know that holding the A♥ on a three-heart board makes the opponent's
nut-flush calls less likely, which is what makes it a good bluff.

**Suggestion:** compute fold equity from ranges instead of a constant. Take the opponent's believed range
(already a 1,326-combo `Range`), remove every combo that uses one of the hero's cards, and read fold
equity as *1 − (weight of the part that would continue) / (weight of the whole)*. Blocker bluffs then fall
out on their own, the same way the rest of PsychBot's behavior does. This is the practical version of what
the CFR route couldn't afford — `cfr-distillation-plan.md` measured why the solver can't do it.

**Effort:** small to medium. **Check:** a hand-built spot (like the river spots in `psych-bot.test.ts`) —
the same bluff with and without the blocking card should bet more often with it.

### 4. Range reading across a whole hand — *advanced, missing*

**What's wrong:** the opponent's range is rebuilt from scratch every decision from generic shapes (value
slice + air, or a continuing slice). Nothing remembers that they limped preflop, called the flop and
check-raised the turn.

**Suggestion:** a `HandRangeTracker` per opponent per hand. Start from their preflop range (position-based,
`OPEN_PERCENT`), and after every action they take, reweight each combo by how likely that action was with
that combo — Bayes' rule on 1,326 weights. For the likelihood of an action given a combo, use the blueprint
heads-up (its strategy row is literally P(action | bucket)), and a strength-based rule multiway (bets come
from the top of the range plus a bluff share; calls from the middle). Feed it from the same place that
feeds `OpponentModel` (`useHoldemGame.ts`'s `applyAndPace`), and let PsychBot use the tracked range
wherever it now calls `bettingRange`/`continuingRange`.

**Effort:** medium to large. The biggest single step toward "reads like a person". **Check:** construct a
hand where the line rules out a strong holding and confirm the tracked range reflects it; then
`benchmark:pro`.

### 5. Exploitative deviation from equilibrium — *advanced, partly built*

**What's there now:** the combined bot. Studied players stay near the solved strategy, and their own
valuation (which includes their reads) pulls them off it in proportion to 1 − discipline.

**What was learned building it:** a read is only worth acting on if it is *calibrated*. `OpponentModel`'s
"balanced" aggression baseline (35%) is a full-table number. Heads-up nearly everyone is above it, and
letting that "read" loosen discipline made the bot lose to plain GTO (`docs/combined-bot.md` has the
numbers).

**Suggestion:**
- Calibrate `OpponentModel` baselines by players in the hand. The heads-up baseline could be read straight
  off the blueprint's own aggression frequency.
- Track more than aggression: fold-to-a-bet, preflop participation (VPIP), aggression per street. All of
  it is visible in the action stream.
- Apply exploits to the solved mix directly ("node-locking lite"). If the opponent folds to bets well above
  the solve's expectation, scale up the solve's bet frequencies. If they bluff too much, move weight from
  fold to call. This is more targeted than letting the whole instinct valuation back in.

**Effort:** medium. **Check:** `benchmark:pro`, plus new matchups against specific archetypes (a calling
station, an over-folder) where the right exploit is known.

### 6. Bet sizing as a signal — *advanced, missing*

**Using it:** PsychBot only prices half-pot and pot. Its `raiseCandidate` already values any size, so adding
33% and 75% pot and a 150% overbet is a few lines. The solve can't follow cheaply: every extra size
multiplies the CFR tree, and (lesson from the pilots) that should be measured with the pilot script before
anyone trains on it.

**Reading it:** facing a bet, the believed range ignores the size. Make `bettingRange` take the bet-to-pot
ratio. Small bets come from a wider, merged range (medium hands and some air); big bets and overbets are
*polarized* — mostly very strong or nothing. Concretely: shrink the value slice's width and raise the air
share as size grows.

**Effort:** small (sizes), small (reading). **Check:** spot tests — the same hand should call a small bet
more readily than an overbet with an equal price.

### 7. Table image / meta-game across hands — *advanced, missing*

**Suggestion:** the shared `OpponentModel` already watches every seat, *including each bot*, so a bot can
ask how it looks to the table: `aggressionBias(myOwnId)`. A loose, aggressive image means opponents call
wider, so value-bet thinner and bluff less. A tight image means bluffs get more respect. That's one term on
the believed defence frequency. Deliberately showing a bluff to shape image would need engine support for
voluntarily showing cards, so that part would come later.

**Effort:** small (image-aware defence). **Check:** a bot with an artificially loose record should bluff
less in the same spot.

### 8. ICM (tournament equity) — *advanced, missing*

**What's wrong:** in a tournament, chips aren't money. Losing your stack near the bubble costs more than
doubling it gains. `game/tournament.ts` has payouts, but no bot ever uses them.

**Suggestion:** add an ICM function (the standard Malmuth–Harville model) to `game/`: given every stack
and the payout table, each player's expected prize money. Then, in tournaments, have PsychBot convert
every outcome's chip stack into ICM money *before* prospect theory values it. Nothing else changes.
Bubble tightening, short-stack desperation and big-stack bullying all come out of the currency change,
the same way house money and chasing already come out of the reference point. Harville is exponential in
players but fine for ≤ 9 with memoization.

**Effort:** medium. **Check:** near the bubble, the same hand at the same price should call less often in
a tournament than in a cash game.

### 9. Short-stack push/fold beyond heads-up — *advanced, missing*

**Suggestion:** the heads-up push/fold solver (`pushfold.ts`, 338 information sets) extends to three- and
four-handed shove/call/overcall with a few thousand information sets, still tiny. Honest caveat: CFR has no
convergence *guarantee* past two players, so validate against the widely published 3-max push/fold Nash
charts rather than trusting convergence. With ICM payouts (item 8) this becomes the tournament endgame
chart. It plugs into the combined bot through the same `Fundamentals` interface the blueprint uses, as the
anchor for short-stack spots at any table size.

**Effort:** medium. **Check:** agreement with published 3-max charts; short-stack tournament benchmarks.

### 10. Timing / physical tells — *mostly out of scope*

Physical tells don't exist in a browser. **Timing does**, one way. `useHoldemGame.ts`'s `THINK_TIME` already
makes bots pause by action type. Scale that pause by *how close the decision was*: the gap between the best
and second-best action's value, which PsychBot already computes. Close decisions then take longer and
obvious ones snap, which is a real, learnable tell for the human to pick up. Reading the human's timing is
technically possible (time from prompt to click) but a questionable thing to feed a bot, so give it low
priority.

**Effort:** small. **Check:** it's a feel thing — play it.

## Suggested order

1. **Blockers in fold equity (3)** and **bet-size reading (6)**: small, self-contained, and the most
   noticeable at the table.
2. **Implied odds (1)** and **one extra ply (2)**: fix the lookahead flaws PsychBot's own header names.
3. **Calibrated reads and direct exploits (5)**: builds on the combined bot and today's finding.
4. **Range tracking (4)**: the largest, and what makes the bots read hands like people.
5. **ICM (8) → multiway push/fold (9)**: together, only when tournaments are the focus.
6. **Image (7)** and **timing (10)**: flavor, cheap.
