# One bot: instinct, anchored to the solve

*Design and measurement record for how PsychBot and the CFR blueprint were combined (2026-09-25). Read this
before changing `psych-bot.ts`'s `anchoredChoice`, a profile's `discipline`, or anything that feeds either.*

## What changed

Tables used to seat four separate kinds of bot, drawn at random per seat: a pot-odds calculator
(`HeuristicBot`), the same calculator with personality dials (`PersonalityBot`), the psychological model
(`PsychBot`), and a "solved" seat that played the pure blueprint heads-up and PsychBot otherwise. Nothing
blended. A seat was one of them, and the solved seat *switched* between two strategies per decision.

Now every seat is a `PsychBot`. Once the blueprint downloads, each bot gets it (`useFundamentals`). Where the
blueprint has an answer (heads-up, a trained depth), the bot *blends* it with its own valuation. What makes a
table varied is the character each seat draws (`profile.ts`'s `CAST`), which now includes how much that
character has studied: `discipline`. `PersonalityBot` was deleted. `HeuristicBot` stays only as the engine
tests' cheap driver and the benchmarks' floor.

## The mechanism

A professional has a studied default and moves off it when their own read of the spot says moving pays.
The published form of exactly that is KL-regularized play ("piKL", Jacob et al. 2022). It was built to
model players who are strong *and* recognisably human:

    pi(a)  ∝  anchor(a) · exp( q(a) / temperature )

    anchor(a)    = discipline · solve(a)  +  (1 − discipline) · [a is instinct's favourite]
    q(a)         = PsychBot's own subjective value of a, in pots, relative to its best action
    temperature  = 0.25 · discipline / (1 − discipline)
    discipline   = profile.discipline · (1 − 0.8 · tiltIntensity)

- Discipline 0 is exactly the old PsychBot: argmax of its own valuation. `RATIONAL` stays at 0, so every
  bias test still compares against the unmodified model.
- Discipline 1 is exactly the solve.
- Tilt wears discipline down. The studied default is the first thing that goes when a player steams.
- Where the solve has no answer (multiway, untrained depth), nothing changes: pure instinct.

`BlueprintBot.strategyFor` / `BlueprintSetBot.strategyFor` expose the solve's whole mixed strategy as legal
table actions, instead of one sampled action, which is what the blend needs.

## What was measured, and what it changed

`npm run benchmark:pro -- [pairs] [discipline] [dealSet]`: heads-up at 20bb, duplicate-scored (every deal
played both ways). Three matchups: pure solve vs a recreational bot (`AVERAGE_HUMAN`, which also gets the
solve, at its own discipline of 0.15); the pro vs that same recreational bot; the pro vs the pure solve.
Error bars are one standard error.

### Round 1: reads also loosened discipline — rejected

The first version also divided discipline by `1 + 4 · |aggression read|`, meaning "a pro deviates when they
have a read". Deal set 0, 4,000 pairs:

| pro discipline | pro vs rec | pure solve vs rec | gain from blending | pro vs pure solve |
|---|---|---|---|---|
| 0.85 | +21.2 ± 9.6 | +38.7 ± 9.4 | −17.5 | −9.6 ± 8.4 |
| 0.95 | +22.6 ± 10.7 | +38.7 ± 9.4 | −16.1 | −14.6 ± 8.4 |
| 0.99 | +50.5 ± 10.8 | +38.7 ± 9.4 | +11.8 | −0.6 ± 8.4 |
| 0.85, read term removed | +42.9 ± 10.2 | +26.5 ± 9.5 | +16.4 | −1.5 ± 8.4 |

**What I concluded at the time, and why it was wrong.** I attributed these losses to the read term. My
explanation: the 35% baseline is a full-table number, heads-up everyone bets more, so the "read" fired
against everyone. **Measured afterwards, that's false.** Heads-up, the solve playing itself bets or raises
33% of the time, and the recreational and pro bots about 35%, so the read was ≈ 0 (|bias| ≤ 0.03) and
the term barely changed discipline. The differences between these rows are **run-to-run noise**. A tiny
change in one probability sends a whole simulated session down different decisions, so even
shared-seed comparisons at 4,000 pairs swing by roughly ±10 bb/100. Removing the term was harmless,
since it did nearly nothing, but not for the reason given. Round 3's larger sample is the one to trust.

**Where the baseline really was wrong** (found while calibrating it properly): *multiway*. At a full table
players bet or raise only about 12% of the time, so the old 35% baseline read nearly everyone as
**passive**, which lowered every bot's belief that a bet was a bluff by up to 0.21. Measured at a 6-player
table with the old model after 120 hands: reads from −0.10 to −0.35 for five of six players. Fixed by
per-setting baselines, measured rather than chosen; see "Calibrated reads" below.

### Round 2: fresh deals, read term removed

Deal set 1, 4,000 pairs:

| pro discipline | pro vs rec | pure solve vs rec | gain from blending | pro vs pure solve |
|---|---|---|---|---|
| 0.70 | +36.0 ± 10.3 | +43.6 ± 9.4 | −7.6 | −23.8 ± 8.7 |
| 0.85 | +50.8 ± 10.3 | +43.6 ± 9.4 | +7.2 | −22.1 ± 8.4 |
| 0.95 | +30.0 ± 9.8 | +43.6 ± 9.4 | −13.6 | +16.7 ± 8.0 |

These don't agree with round 1. d = 0.85 against the solve went from −1.5 to −22.1. At 4,000 pairs the error
bars are as large as the effects. There is also a structural reason to expect the blend to leak (below).

### Round 3: 12,000 pairs, shared fresh deals

Deal set 2, 12,000 pairs, both disciplines on the same deals, so their difference is less noisy than either
number alone:

| pro discipline | pro vs rec | pure solve vs rec | gain from blending | pro vs pure solve |
|---|---|---|---|---|
| 0.85 | +47.9 ± 5.9 | +39.0 ± 5.4 | **+8.9** | −2.9 ± 4.9 |
| 0.95 | +50.1 ± 5.6 | +39.0 ± 5.4 | **+11.1** | −4.2 ± 4.8 |

**Reading it:** this is the shape piKL is supposed to produce. Against a recreational player the pro wins
more than pure GTO does, and against GTO itself it's a statistical draw. At d = 0.85 the gain over pure GTO
came out positive on every deal set tried (+16.4, +7.2, +8.9). The one alarming number, −22.1 against the
solve in round 2, didn't reproduce at three times the sample, so it reads as the tail of a noisy 4,000-pair
run. It's still honest to call the gain *suggestive* (about 1.5–2 standard errors per run), not proven. 0.85
and 0.95 can't be told apart at this precision. `PRO` stays at 0.85, which leaves more room for its human
side (tilt, instinct) to show.

**What this doesn't claim:** that the blend beats GTO. It doesn't, measurably, and it isn't designed to. A
balanced opponent can't be exploited, only matched. The claim is narrower: leaning on the solve while still
listening to instinct costs nothing measurable against a strong player and earns more against a weak one.

## Why the blend can cost EV, and what would fix it

The exp term doesn't only act on the instinct share. It re-weights *every* frequency in the solve's mix
toward PsychBot's valuation. piKL assumes that valuation is a good estimate of value (in the original work
it comes from search). PsychBot's is deliberately a *human* one: prospect-theory distorted, one street
deep, "flatters aggression" by its own header. So even without a read, a moderately disciplined bot gets
nudged off balance in every spot, and a balanced opponent (the solve) can punish that.

That's fine, and intended, for recreational characters: their instinct is supposed to be flawed. For a
professional, deviations should come from information that's actually reliable. That points at the gaps doc
rather than more tuning here: calibrated reads and exploits applied directly to the solved mix (item 5),
and a valuation that stops flattering aggression (items 1–2).

## Calibrated reads, range reading, blockers (2026-09-25)

Built on top of the blend (details in `human-strategy-gaps.md` items 3–5):

- **Calibrated reads** (`opponent-model.ts`): each action is recorded with its setting (heads-up or multiway,
  facing a bet or not, preflop or postflop). Reads are measured against a *measured* normal for that
  setting (`npm run calibrate:reads`). Confidence grows with evidence. The model also tracks postflop bet,
  fold, call and raise rates per player.
- **Range reading** (`range-reading.ts`): Bayes over all 1,326 combos, action by action, on the board as
  it was. Each postflop action is cut relative to what the player can still hold, at the rate *that
  player* takes it.
- **Blockers** (`splitAgainstBet`): an opponent continues with strong hands plus the top `defence` share of
  their own range, chosen without seeing the hero's cards. Then the hero's cards are removed.
- **Targeted exploits** (`exploits.ts`): heads-up, a read adjusts the solve's mix directly before the blend.

### How it was measured

The new bot was A/B-tested against an exact copy of the previous one: duplicate-scored heads-up, and a
six-handed duplicate where every deal is played twice with new and old bots swapping seats. It was also
tested against the pure solve, the one opponent that can't be exploited, so "beats the old bot" can't
just mean "exploits the old bot's quirks".

### The first version was worse, and switching pieces off isolated why

With everything on, the recreational bot **lost 64 bb/100** heads-up to its previous self. Ablations
(recreational, heads-up 20bb, vs previous bot, 1,500 pairs):

| variant | bb/100 |
|---|---|
| everything new switched off (control) | +0.0 ± 0.3 |
| range reading off | +193.8 ± 12.1 |
| range reading only for opponents who checked or called | +195.2 ± 12.3 |
| range reading only for fold equity | +191.8 ± 13.0 |
| range reading only for opponents who **bet** | **−83.2 ± 16.0** |

So the harm is specifically in reading a *bettor's* range to decide whether to call. That needs a bluff
share, and from actions alone the only estimate is the level-k belief (about 12% for a typical level-1
player). The previous bot bets 63% of the time when checked to, heavily polarized, so its real bluff share
is far higher. Reading its bets as mostly value made the new bot fold its way to a loss. Calibrating
widths from observed rates (the second design) didn't fix it, because the width was never the issue; the
bluff share is. **Shipped:** tracked ranges everywhere except a bettor's range for the call decision, which
keeps the old value-plus-air mixture. What would fix it properly is showdown information: seeing what
bettors actually held.

### Final numbers

Head-to-head against the previous bot:

| matchup | bb/100 |
|---|---|
| heads-up 20bb, recreational (3,000 pairs) | +174.8 ± 9.3 |
| heads-up 20bb, pro | −1.5 ± 9.9 |
| heads-up 100bb, recreational | +716 ± 31 |
| heads-up 100bb, pro | +5.0 ± 37.6 |
| six-handed 40bb, whole cast (1,200 deals) | +163.7 ± 27.5 |

Against the pure solve (4,000 pairs, same deals):

| character | new | previous |
|---|---|---|
| recreational | −30.3 ± 9.3 | −26.1 ± 9.4 |
| pro | −7.3 ± 8.3 | +8.7 ± 8.4 |

**Reading it:** the new bots beat the previous ones heavily, heads-up and six-handed, and it's the
instinct-driven characters that gain; the pro mostly follows the solve either way. Against the pure solve
there's no measurable difference, which is what reads and exploits should do: they earn from flawed
opponents, and an unexploitable one offers nothing. **Retraction:** an intermediate run showed the
recreational bot losing less to GTO (−30 vs −43). That didn't reproduce; the previous bot measured −26
here. It was noise.

`npm run benchmark:pro -- 4000 0.85 2` on the final version, against round 3's numbers on the same deal set:

| matchup | now | round 3 |
|---|---|---|
| pure solve vs recreational | +23.0 ± 9.1 | +39.0 ± 5.4 |
| pro vs recreational | +14.5 ± 9.2 | +47.9 ± 5.9 |
| pro vs pure solve | +1.0 ± 8.4 | −2.9 ± 4.9 |

The recreational bot is harder to beat now, even for pure GTO. The pro still plays the solve to a draw. The
round-3 gain of the pro over pure GTO against recreational players is no longer visible (+14.5 vs +23.0,
within noise): a tougher opponent leaves less to exploit.

## Bet sizes, implied odds, showdown memory, and the multiway preflop book (2026-09-27)

Four additions (details in `human-strategy-gaps.md` items 1, 2, 4, 6 and 9, and `multiway-preflop.md`):

- **Implied odds** (`math/equity.ts`'s `multiwayShowdown`): a showdown is valued with the money later
  streets add when both hands turn out good. This replaced the old "shrink equity toward a coin flip"
  discount.
- **Five bet sizes, and size-aware reading** (`sizing.ts`): each size priced for what folds to it and what
  calls it. Opponents' bets are read by size, and how often each player bets big is learned.
- **Showdown memory** (`OpponentModel.observeShowdown`): river bets seen at showdown, scored value or bluff
  by size, move the belief about that player's bluffs.
- **The multiway preflop book**, asked before the heads-up blueprints (`firstAnswer`).

Measured the same way as before: A/B against an exact copy of the previous bot, duplicate-scored, and
against the pure solve.

### Ablations, six-handed at 100bb (new vs previous, 1,200 deals unless noted)

| variant | bb/100 |
|---|---|
| everything on (600 deals) | +156 ± 55 |
| everything on, deal set A | +210 ± 41 |
| everything on, deal set B | +197 ± 45 |
| without the preflop book | +242 ± 45 |
| without implied odds | +116 ± 69 |
| without the new sizes and size reading | +142 ± 34 |
| without showdown memory | +303 ± 52 |
| showdown memory, but never reading a bettor's range from it, set A | +215 ± 47 |
| the same, set B | +296 ± 51 |

**What it changed.** The first design also let showdown memory switch a bettor's range to the full read
range once six of their river bets had been seen ("now the bluff share is *known*"). That's the switch that
cost 83 bb/100 last round when the bluff share was guessed, and it didn't pay here either. With it off,
the two deal sets measured +215 and +296, against +210 and +197 with it on. That's not significant on its
own, but it leans the same way as the "no showdown memory at all" run. **Dropped.** Showdown memory now
feeds only the air share of the value-plus-air mixture used for bettors.

Everything else stays. None of the other removals measured better than the full bot beyond noise. The
book is also not *for* beating this particular opponent: it's the solve, and its job is to be hard to
exploit.

**One caution on reading these.** Every run is chaotic: the same deals diverge once any decision differs,
so shared seeds don't cancel the variance between two variants. A difference between two rows needs about
twice the error bar of one row to mean anything.
